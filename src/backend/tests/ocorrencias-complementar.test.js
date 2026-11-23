// QA (Issue #45): testes complementares de POST /ocorrencias — somente dados
// fictícios (RN05). Sem banco: src/lib/prisma.js é substituído por um "banco"
// em memória com semântica de transação mais próxima do PostgreSQL do que a
// do arquivo do dev: dentro de $transaction as gravações vão para uma CÓPIA
// de trabalho, que só é efetivada (commit) se a operação terminar sem erro.
// Qualquer gravação feita FORA da transação (pelo client global) iria direto
// para o banco "efetivado" e sobreviveria ao rollback — e todo acesso ao
// client global é registrado, para provar que o service não o usa.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';

const mocks = vi.hoisted(() => ({ falharEm: null, acessosForaTx: [], transacoes: 0 }));

let banco;

function selecionar(registro, select) {
  if (!select) return { ...registro };
  return Object.fromEntries(
    Object.entries(select)
      .filter(([, incluir]) => incluir === true)
      .map(([campo]) => [campo, registro[campo]]),
  );
}

function talvezFalhar(operacao) {
  if (mocks.falharEm === operacao) throw new Error(`falha fictícia em ${operacao}`);
}

/** Client em memória ligado a um "armazenamento" (efetivado ou cópia da transação). */
function clientSobre(db) {
  const turma = (id) => db.turmas.find((t) => t.id === id);
  const usuario = (id) => db.usuarios.find((u) => u.id === id);
  const completa = (id) => {
    const o = db.ocorrencias.find((x) => x.id === id);
    if (!o) return null;
    return {
      ...o,
      turma: turma(o.turma_id),
      categoria: db.categorias.find((c) => c.id === o.categoria_id),
      profissional_responsavel: { id: o.profissional_responsavel_id, nome: usuario(o.profissional_responsavel_id).nome },
      responsavel_acompanhamento: null,
    };
  };
  return {
    usuario: {
      findUnique: async ({ where, select }) => {
        const u = usuario(where.id);
        return u ? selecionar(u, select) : null;
      },
      findMany: async ({ where, select }) =>
        db.usuarios.filter((u) => where.id.in.includes(u.id)).map((u) => selecionar(u, select)),
    },
    turma: {
      findUnique: async ({ where, select }) => {
        const t = turma(where.id);
        return t ? selecionar(t, select) : null;
      },
    },
    categoria: {
      findUnique: async ({ where, select }) => {
        const c = db.categorias.find((x) => x.id === where.id);
        return c ? selecionar(c, select) : null;
      },
    },
    estudante: {
      findMany: async ({ where, select }) =>
        db.estudantes.filter((e) => where.id.in.includes(e.id)).map((e) => selecionar(e, select)),
    },
    ocorrencia: {
      create: async ({ data, select }) => {
        talvezFalhar('ocorrencia.create');
        const registro = { id: db.proximo.ocorrencia++, responsavel_acompanhamento_id: null, data_encerramento: null, ...data };
        db.ocorrencias.push(registro);
        return selecionar(registro, select);
      },
      findUnique: async ({ where, select }) => {
        talvezFalhar('ocorrencia.findUnique');
        const o = completa(where.id);
        return o ? Object.fromEntries(Object.keys(select).map((k) => [k, o[k]])) : null;
      },
    },
    ocorrenciaEstudante: {
      createMany: async ({ data }) => {
        talvezFalhar('ocorrenciaEstudante.createMany');
        for (const linha of data) {
          if (db.ocorrenciasEstudantes.some((x) => x.ocorrencia_id === linha.ocorrencia_id && x.estudante_id === linha.estudante_id)) {
            const erro = new Error('PK composta fictícia');
            erro.code = 'P2002';
            throw erro;
          }
          db.ocorrenciasEstudantes.push({ ...linha });
        }
        return { count: data.length };
      },
      findMany: async ({ where }) =>
        db.ocorrenciasEstudantes
          .filter((x) => x.ocorrencia_id === where.ocorrencia_id)
          .map((x) => db.estudantes.find((e) => e.id === x.estudante_id))
          .sort((a, b) => a.nome_completo.localeCompare(b.nome_completo) || a.id - b.id)
          .map((e) => ({ estudante: { id: e.id, nome_completo: e.nome_completo, turma: turma(e.turma_id) } })),
    },
    encaminhamento: {
      create: async ({ data, select }) => {
        talvezFalhar('encaminhamento.create');
        const registro = { id: db.proximo.encaminhamento++, data_hora: new Date(), ...data };
        db.encaminhamentos.push(registro);
        return selecionar(registro, select);
      },
      findMany: async ({ where }) => {
        talvezFalhar('encaminhamento.findMany');
        return db.encaminhamentos
          .filter((e) => e.ocorrencia_id === where.ocorrencia_id)
          .sort((a, b) => a.id - b.id)
          .map((e) => {
            const dest = e.destinatario_usuario_id ? usuario(e.destinatario_usuario_id) : null;
            return {
              id: e.id,
              destinatario_perfil: e.destinatario_perfil,
              destinatario_usuario: dest ? { id: dest.id, nome: dest.nome, perfil: dest.perfil } : null,
              registrado_por: { id: e.registrado_por_id, nome: usuario(e.registrado_por_id).nome },
              data_hora: e.data_hora,
              observacao: e.observacao,
            };
          });
      },
    },
    historicoOcorrencia: {
      createMany: async ({ data }) => {
        talvezFalhar('historicoOcorrencia.createMany');
        for (const linha of data) db.historicos.push({ descricao: null, ...linha });
        return { count: data.length };
      },
    },
    logAuditoria: {
      create: async ({ data }) => {
        talvezFalhar('logAuditoria.create');
        db.logs.push(data);
        return { id: db.logs.length };
      },
    },
  };
}

vi.mock('../src/lib/prisma.js', () => ({
  default: new Proxy(
    {},
    {
      get(_alvo, prop) {
        if (prop === '$transaction') {
          return async (operacao) => {
            mocks.transacoes += 1;
            const trabalho = structuredClone(banco); // cópia de trabalho da transação
            const resultado = await operacao(clientSobre(trabalho));
            banco = trabalho; // commit só se não houve erro
            return resultado;
          };
        }
        // Acesso ao client global (fora da transação): registra e grava direto no banco efetivado.
        const modelo = clientSobre(banco)[prop];
        if (!modelo) return undefined;
        return new Proxy(modelo, {
          get(m, metodo) {
            mocks.acessosForaTx.push(`${String(prop)}.${String(metodo)}`);
            return m[metodo];
          },
        });
      },
    },
  ),
}));

const { default: app } = await import('../src/app.js');
const servico = await import('../src/services/ocorrencias.js');
const {
  ACOES_HISTORICO,
  MENSAGEM_DATA_HORA_INVALIDA,
  MENSAGEM_DATA_HORA_FUTURA,
  MENSAGEM_LOCAL_LONGO,
  MENSAGEM_ESTUDANTE_ID_INVALIDO,
  MENSAGEM_TURMA_INEXISTENTE,
  MENSAGEM_ESTUDANTE_INEXISTENTE,
  TAMANHO_MAXIMO_LOCAL,
  TOLERANCIA_FUTURO_MS,
  MENSAGEM_ESTUDANTES_EXCEDIDOS,
  MENSAGEM_ENCAMINHAMENTOS_EXCEDIDOS,
  converterDataHora,
  mensagemDestinatarioInvalido,
  mensagemEncaminhamentoRepetido,
} = servico;

const SEGREDO_TESTE = 'segredo-ficticio-de-teste-com-mais-de-32-caracteres';
const ID_PROFESSOR = 1;
const ID_TUTOR = 2;
const ID_GESTAO = 3;
const ID_PEDAGOGICO = 4;
const ID_TECNICO = 5;
const ID_PROFESSOR_BLOQUEADO = 6;
const ID_PROFESSOR_DESATIVADO = 7;
const ID_TUTOR_2 = 8;
const ID_INEXISTENTE = 999;

beforeEach(() => {
  process.env.JWT_SECRET = SEGREDO_TESTE;
  mocks.falharEm = null;
  mocks.acessosForaTx = [];
  mocks.transacoes = 0;
  const usuario = (id, perfil, extra = {}) => ({
    id,
    nome: `Pessoa Fictícia ${id}`,
    email: `pessoa${id}@sisto.exemplo`,
    perfil,
    status: 'ATIVO',
    troca_senha_obrigatoria: false,
    senha_alterada_em: null,
    ...extra,
  });
  banco = {
    usuarios: [
      usuario(ID_PROFESSOR, 'PROFESSOR'),
      usuario(ID_TUTOR, 'TUTOR'),
      usuario(ID_GESTAO, 'GESTAO'),
      usuario(ID_PEDAGOGICO, 'PEDAGOGICO'),
      usuario(ID_TECNICO, 'TECNICO_ADMINISTRATIVO'),
      usuario(ID_PROFESSOR_BLOQUEADO, 'PROFESSOR', { status: 'BLOQUEADO' }),
      usuario(ID_PROFESSOR_DESATIVADO, 'PROFESSOR', { status: 'DESATIVADO' }),
      usuario(ID_TUTOR_2, 'TUTOR'),
    ],
    turmas: [
      { id: 1, nome: '7º B', etapa: 'Ensino Fundamental', ano_letivo: 2026 },
      { id: 2, nome: '2º C', etapa: 'Ensino Médio', ano_letivo: 2026 },
    ],
    categorias: [{ id: 1, nome: 'Indisciplina', descricao: null }],
    estudantes: Array.from({ length: 60 }, (_, i) => ({
      id: i + 1,
      nome_completo: `Aluno Fictício ${String(i + 1).padStart(2, '0')}`,
      codigo_escolar: `FICT-${i + 1}`,
      turma_id: i % 2 === 0 ? 1 : 2,
      tutor_id: i === 0 ? ID_TUTOR : null,
    })),
    ocorrencias: [],
    ocorrenciasEstudantes: [],
    encaminhamentos: [],
    historicos: [],
    logs: [],
    proximo: { ocorrencia: 1, encaminhamento: 1 },
  };
});

afterEach(() => {
  vi.useRealTimers();
  delete process.env.JWT_SECRET;
});

const token = (id, perfil) =>
  jwt.sign({ id, perfil: perfil ?? banco.usuarios.find((u) => u.id === id).perfil }, SEGREDO_TESTE, {
    algorithm: 'HS256',
    expiresIn: '8h',
  });

const post = (corpo, usuarioId = ID_PROFESSOR) =>
  request(app).post('/ocorrencias').set('Authorization', `Bearer ${token(usuarioId)}`).send(corpo);

const corpoValido = (extra = {}) => ({
  dataHora: new Date(Date.now() - 60_000).toISOString(),
  local: 'Quadra',
  turmaId: 1,
  categoriaId: 1,
  descricao: 'Relato objetivo fictício.',
  estudanteIds: [1],
  encaminhamentos: [{ destinatarioPerfil: 'TUTOR', destinatarioUsuarioId: ID_TUTOR }],
  ...extra,
});

function esperarNadaGravado() {
  expect(banco.ocorrencias).toHaveLength(0);
  expect(banco.ocorrenciasEstudantes).toHaveLength(0);
  expect(banco.encaminhamentos).toHaveLength(0);
  expect(banco.historicos).toHaveLength(0);
  expect(banco.logs).toHaveLength(0);
}

/** Fora da transação, só a leitura do usuário logado (autenticação) é permitida. */
function esperarSemAcessoForaDaTransacao() {
  expect(mocks.acessosForaTx.filter((a) => a !== 'usuario.findUnique')).toEqual([]);
}

// ---------------------------------------------------------------------------
describe('QA #45 — atomicidade com commit só no fim (RN03, transação única)', () => {
  it('no sucesso, tudo é gravado numa única transação e nada é gravado fora dela', async () => {
    const res = await post(corpoValido({ estudanteIds: [1, 2], encaminhamentos: [{ destinatarioPerfil: 'GESTAO' }, { destinatarioPerfil: 'EQUIPE_PEDAGOGICA' }] }));
    expect(res.status).toBe(201);
    expect(mocks.transacoes).toBe(1);
    esperarSemAcessoForaDaTransacao();
    expect(banco.ocorrencias).toHaveLength(1);
    expect(banco.ocorrenciasEstudantes).toHaveLength(2);
    expect(banco.encaminhamentos).toHaveLength(2);
    expect(banco.historicos).toHaveLength(3);
    expect(banco.logs).toHaveLength(1);
  });

  it.each([
    'ocorrencia.create',
    'ocorrenciaEstudante.createMany',
    'encaminhamento.create',
    'historicoOcorrencia.createMany',
    'logAuditoria.create',
    'ocorrencia.findUnique', // leitura da resposta, depois de todas as gravações
    'encaminhamento.findMany',
  ])('falha em %s: 500 genérico e nenhum registro parcial', async (operacao) => {
    mocks.falharEm = operacao;
    const res = await post(corpoValido({ estudanteIds: [1, 2], encaminhamentos: [{ destinatarioPerfil: 'GESTAO' }, { destinatarioPerfil: 'TUTOR', destinatarioUsuarioId: ID_TUTOR }] }));
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ erro: 'Erro interno do servidor' });
    expect(JSON.stringify(res.body)).not.toMatch(/fictícia|Fictício/);
    esperarNadaGravado();
    esperarSemAcessoForaDaTransacao();
  });

  it('erro de validação de referência (400) dentro da transação não grava nada', async () => {
    const res = await post(corpoValido({ estudanteIds: [1, ID_INEXISTENTE] }));
    expect(res.status).toBe(400);
    esperarNadaGravado();
    esperarSemAcessoForaDaTransacao();
  });

  it('duas ocorrências seguidas recebem ids distintos e não se misturam', async () => {
    await post(corpoValido({ estudanteIds: [1] }));
    await post(corpoValido({ estudanteIds: [2, 3] }), ID_GESTAO);
    expect(banco.ocorrencias.map((o) => [o.id, o.profissional_responsavel_id])).toEqual([[1, ID_PROFESSOR], [2, ID_GESTAO]]);
    expect(banco.ocorrenciasEstudantes.filter((x) => x.ocorrencia_id === 2).map((x) => x.estudante_id)).toEqual([2, 3]);
    expect(banco.logs.map((l) => l.recurso)).toEqual(['ocorrencias/1', 'ocorrencias/2']);
  });
});

// ---------------------------------------------------------------------------
describe('QA #45 — autenticação e usuário logado', () => {
  it.each([
    [ID_PROFESSOR_BLOQUEADO, 'bloqueado'],
    [ID_PROFESSOR_DESATIVADO, 'desativado'],
  ])('usuário logado %i (%s) responde 401 e não grava', async (id) => {
    const res = await post(corpoValido(), id);
    expect(res.status).toBe(401);
    esperarNadaGravado();
  });

  it('token assinado com outro segredo responde 401', async () => {
    const falso = jwt.sign({ id: ID_GESTAO, perfil: 'GESTAO' }, 'outro-segredo-ficticio-com-mais-de-32-caracteres');
    const res = await request(app).post('/ocorrencias').set('Authorization', `Bearer ${falso}`).send(corpoValido());
    expect(res.status).toBe(401);
    esperarNadaGravado();
  });

  it('perfil do token é ignorado: vale o perfil do banco e o id do token vira responsável (RN02)', async () => {
    const res = await request(app)
      .post('/ocorrencias')
      .set('Authorization', `Bearer ${token(ID_TECNICO, 'GESTAO')}`)
      .send(corpoValido({ profissionalResponsavelId: ID_GESTAO }));
    expect(res.status).toBe(201);
    expect(banco.ocorrencias[0].profissional_responsavel_id).toBe(ID_TECNICO);
    expect(banco.encaminhamentos[0].registrado_por_id).toBe(ID_TECNICO);
    expect(banco.historicos.every((h) => h.usuario_id === ID_TECNICO)).toBe(true);
    expect(banco.logs[0].usuario_id).toBe(ID_TECNICO);
  });

  // Issue #47 implementou GET /ocorrencias; PUT /ocorrencias/{id} segue fora do escopo.
  it('PUT /ocorrencias/{id} ainda não existe (404, não 500)', async () => {
    const res = await request(app).put('/ocorrencias/1').set('Authorization', `Bearer ${token(ID_GESTAO)}`).send({});
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
describe('QA #45 — RN17 pela API, com relógio fixo', () => {
  const AGORA = new Date('2026-10-26T15:00:00.000Z');
  const comRelogioFixo = () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(AGORA);
  };

  it('exatamente agora + 5 min responde 201', async () => {
    comRelogioFixo();
    const res = await post(corpoValido({ dataHora: new Date(AGORA.getTime() + TOLERANCIA_FUTURO_MS).toISOString() }));
    expect(res.status).toBe(201);
    expect(res.body.dataHora).toBe('2026-10-26T15:05:00.000Z');
  });

  it('agora + 5 min + 1 ms responde 400 e não grava', async () => {
    comRelogioFixo();
    const res = await post(corpoValido({ dataHora: '2026-10-26T15:05:00.001Z' }));
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ erro: MENSAGEM_DATA_HORA_FUTURA });
    esperarNadaGravado();
  });

  it('mesmo instante em São Paulo (-03:00): 12:05 aceita, 12:05:01 recusa', async () => {
    comRelogioFixo();
    expect((await post(corpoValido({ dataHora: '2026-10-26T12:05:00-03:00' }))).status).toBe(201);
    expect((await post(corpoValido({ dataHora: '2026-10-26T12:05:01-03:00' }))).status).toBe(400);
  });

  it('um dia à frente em fuso +14:00 que ainda é passado em UTC é aceito', async () => {
    comRelogioFixo();
    // 2026-10-27T04:00+14:00 = 2026-10-26T14:00Z (1 h antes de AGORA)
    const res = await post(corpoValido({ dataHora: '2026-10-27T04:00:00+14:00' }));
    expect(res.status).toBe(201);
    expect(res.body.dataHora).toBe('2026-10-26T14:00:00.000Z');
  });

  it('data no passado distante é aceita (sem data mínima de negócio — decisão do Rafael)', async () => {
    comRelogioFixo();
    expect((await post(corpoValido({ dataHora: '2000-01-01T00:00:00Z' }))).status).toBe(201);
  });
});

// ---------------------------------------------------------------------------
describe('QA #45 — conversão de dataHora (RN17, fusos e datas inválidas)', () => {
  it.each([
    // antigo início do horário de verão (00:00 -> 01:00): hoje o Brasil não tem
    // horário de verão; com offset explícito, 00:30-03:00 é um instante válido
    ['2018-11-04T00:30:00-03:00', '2018-11-04T03:30:00.000Z'],
    // antigo fim do horário de verão: 23:30 com offset -02:00 (antigo) também é válido
    ['2019-02-16T23:30:00-02:00', '2019-02-17T01:30:00.000Z'],
    ['2026-10-26T00:00:00-00:00', '2026-10-26T00:00:00.000Z'],
    ['2026-10-26T00:00:00+00:00', '2026-10-26T00:00:00.000Z'],
    ['2026-10-26T10:00:00-12:00', '2026-10-26T22:00:00.000Z'],
    ['2026-12-31T23:59:59.999Z', '2026-12-31T23:59:59.999Z'],
    ['2026-10-26T10:00:00.123456789Z', '2026-10-26T10:00:00.123Z'],
    ['2000-02-29T12:00:00Z', '2000-02-29T12:00:00.000Z'],
  ])('%s -> %s', (entrada, utc) => {
    expect(converterDataHora(entrada).toISOString()).toBe(utc);
  });

  it.each([
    ['2026-10-26T10:00:00z'], // z minúsculo
    ['2026-10-26t10:00:00Z'], // t minúsculo
    ['2026-10-26T10:00:00-03'], // fuso sem minutos
    ['2026-10-26T10:00:00-0300'], // fuso sem dois-pontos
    ['2026-10-26T10:00:00+24:00'],
    ['2026-10-26T10:00:00+03:60'],
    ['2026-10-26T23:59:60Z'], // segundo bissexto
    ['2026-10-26T10:00:00.1234567891Z'], // 10 casas de fração
    ['2100-02-29T00:00:00Z'], // 2100 não é bissexto
    ['2026-04-31T00:00:00Z'],
    ['2026-00-10T00:00:00Z'],
    ['2026-10-00T00:00:00Z'],
    [' 2026-10-26T10:00:00Z'],
    ['2026-10-26T10:00:00Z '],
    ['+002026-10-26T10:00:00Z'],
    ['2026-10-26T10:00:00Z\n'],
    ['0000-01-01T00:00:00Z'], // ano 0: fora do TIMESTAMP(3) gravável (antes virava 500)
    ['0001-01-01T00:00:00+14:00'], // vira ano 0 em UTC
    [{}],
    [['2026-10-26T10:00:00Z']],
  ])('%j é recusada com 400', async (dataHora) => {
    expect(() => converterDataHora(dataHora)).toThrow(MENSAGEM_DATA_HORA_INVALIDA);
    const res = await post(corpoValido({ dataHora }));
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ erro: MENSAGEM_DATA_HORA_INVALIDA });
  });
});

// ---------------------------------------------------------------------------
describe('QA #45 — LGPD: erros, histórico, auditoria e resposta', () => {
  it('erros de referência não ecoam ids, nomes nem códigos', async () => {
    for (const corpo of [
      corpoValido({ turmaId: 777 }),
      corpoValido({ estudanteIds: [1, 888] }),
      corpoValido({ encaminhamentos: [{ destinatarioPerfil: 'TUTOR', destinatarioUsuarioId: ID_PEDAGOGICO }] }),
      corpoValido({ encaminhamentos: [{ destinatarioPerfil: 'GESTAO', destinatarioUsuarioId: 666 }] }),
    ]) {
      const res = await post(corpo);
      expect(res.status).toBe(400);
      expect(res.body.erro).not.toMatch(/777|888|666|Fictíci|FICT-|@/);
      expect(res.body.erro).not.toContain(String(ID_PEDAGOGICO) + ' ');
    }
    esperarNadaGravado();
  });

  it('histórico usa só textos fixos, mesmo com observação/descrição contendo nomes', async () => {
    await post(
      corpoValido({
        estudanteIds: [1, 2, 3],
        descricao: 'Aluno Fictício 01 discutiu com Aluno Fictício 02',
        encaminhamentos: [
          { destinatarioPerfil: 'TUTOR', destinatarioUsuarioId: ID_TUTOR, observacao: 'Falar com Aluno Fictício 03' },
          { destinatarioPerfil: 'GESTAO', destinatarioUsuarioId: ID_GESTAO },
        ],
      }),
    );
    const acoesFixas = Object.values(ACOES_HISTORICO);
    const descricoesFixas = [null, 'Destinatário: tutor', 'Destinatário: equipe pedagógica', 'Destinatário: gestão'];
    for (const h of banco.historicos) {
      expect(acoesFixas).toContain(h.acao);
      expect(descricoesFixas).toContain(h.descricao);
    }
    expect(JSON.stringify([banco.historicos, banco.logs])).not.toMatch(/Fictíci|FICT-|@|Quadra|Pessoa/);
    expect(Object.keys(banco.logs[0]).sort()).toEqual(['acao', 'recurso', 'usuario_id']);
  });

  it('resposta 201 não traz e-mail, código escolar, tutor_id nem status/senha de usuários', async () => {
    const res = await post(
      corpoValido({
        estudanteIds: [1, 2],
        encaminhamentos: [
          { destinatarioPerfil: 'TUTOR', destinatarioUsuarioId: ID_TUTOR },
          { destinatarioPerfil: 'EQUIPE_PEDAGOGICA', destinatarioUsuarioId: ID_PEDAGOGICO },
        ],
      }),
    );
    expect(res.status).toBe(201);
    const texto = JSON.stringify(res.body);
    expect(texto).not.toMatch(/email|@|codigo|FICT-|tutor_id|tutorId|senha|troca_senha|"ATIVO"/);
  });
});

// ---------------------------------------------------------------------------
describe('QA #45 — validações de borda e decisões do Rafael', () => {
  it('local com 150 caracteres decompostos (NFD, 300 unidades) é aceito após NFC; 151 compostos recusa', async () => {
    const decomposto = 'é'.repeat(TAMANHO_MAXIMO_LOCAL); // 'é' em NFD
    expect(decomposto.length).toBe(300);
    let res = await post(corpoValido({ local: decomposto }));
    expect(res.status).toBe(201);
    expect(banco.ocorrencias[0].local).toBe('é'.repeat(TAMANHO_MAXIMO_LOCAL));
    res = await post(corpoValido({ local: 'é'.repeat(TAMANHO_MAXIMO_LOCAL + 1) }));
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ erro: MENSAGEM_LOCAL_LONGO });
  });

  it('estudanteId acima do maior Int do PostgreSQL responde 400', async () => {
    const res = await post(corpoValido({ estudanteIds: [1, 2_147_483_648] }));
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ erro: MENSAGEM_ESTUDANTE_ID_INVALIDO });
  });

  it('turma de referência diferente da turma de TODOS os estudantes é aceita (RN14)', async () => {
    // estudantes 1 e 3 são da turma 1; turma de referência = 2
    const res = await post(corpoValido({ turmaId: 2, estudanteIds: [1, 3] }));
    expect(res.status).toBe(201);
    expect(res.body.turma.id).toBe(2);
    expect(res.body.estudantes.map((e) => e.turma.id)).toEqual([1, 1]);
  });

  it('turma inexistente tem prioridade e não consulta destinatários inválidos', async () => {
    const res = await post(corpoValido({ turmaId: 777, encaminhamentos: [{ destinatarioPerfil: 'TUTOR', destinatarioUsuarioId: 666 }] }));
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ erro: MENSAGEM_TURMA_INEXISTENTE });
  });

  it('50 estudantes distintos (metade de cada turma) são gravados (limite de 50 — decisão do Rafael)', async () => {
    const ids = Array.from({ length: 50 }, (_, i) => i + 1);
    const res = await post(corpoValido({ estudanteIds: ids }));
    expect(res.status).toBe(201);
    expect(banco.ocorrenciasEstudantes).toHaveLength(50);
    expect(new Set(res.body.estudantes.map((e) => e.turma.id))).toEqual(new Set([1, 2]));
  });

  it('51 estudantes distintos respondem 400 (limite de 50) sem abrir transação', async () => {
    const res = await post(corpoValido({ estudanteIds: Array.from({ length: 51 }, (_, i) => i + 1) }));
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ erro: MENSAGEM_ESTUDANTES_EXCEDIDOS });
    expect(mocks.transacoes).toBe(0);
    esperarNadaGravado();
  });

  it('estudante inexistente entre 49 válidos (50 distintos) continua 400 sem gravar', async () => {
    const ids = [...Array.from({ length: 49 }, (_, i) => i + 1), ID_INEXISTENTE];
    const res = await post(corpoValido({ estudanteIds: ids }));
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ erro: MENSAGEM_ESTUDANTE_INEXISTENTE });
    esperarNadaGravado();
  });

  it('encaminhamentos repetidos (mesmo tutor) respondem 400 sem gravar (decisão do Rafael)', async () => {
    const enc = { destinatarioPerfil: 'TUTOR', destinatarioUsuarioId: ID_TUTOR };
    const res = await post(corpoValido({ encaminhamentos: [enc, { destinatarioPerfil: 'GESTAO' }, enc] }));
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ erro: mensagemEncaminhamentoRepetido(1, 3) });
    expect(res.body.erro).toBe('Os encaminhamentos 1 e 3 têm o mesmo destinatário. Remova o repetido.');
    expect(mocks.transacoes).toBe(0);
    esperarNadaGravado();
  });

  it('dois GESTAO sem usuário são repetidos (null conta como valor): 400', async () => {
    const res = await post(corpoValido({ encaminhamentos: [{ destinatarioPerfil: 'GESTAO' }, { destinatarioPerfil: 'GESTAO', destinatarioUsuarioId: null }] }));
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ erro: mensagemEncaminhamentoRepetido(1, 2) });
    esperarNadaGravado();
  });

  it('TUTOR com usuários diferentes não é repetido: 201 e um histórico por encaminhamento', async () => {
    const res = await post(
      corpoValido({
        encaminhamentos: [
          { destinatarioPerfil: 'TUTOR', destinatarioUsuarioId: ID_TUTOR },
          { destinatarioPerfil: 'TUTOR', destinatarioUsuarioId: ID_TUTOR_2 },
        ],
      }),
    );
    expect(res.status).toBe(201);
    expect(banco.historicos.filter((h) => h.acao === ACOES_HISTORICO.ENCAMINHAMENTO_REGISTRADO)).toHaveLength(2);
  });

  /** 10 encaminhamentos distintos (cria tutores fictícios extras 30..35). */
  function dezEncaminhamentosDistintos() {
    for (let id = 30; id <= 35; id += 1) {
      banco.usuarios.push({ id, nome: `Pessoa Fictícia ${id}`, email: `pessoa${id}@sisto.exemplo`, perfil: 'TUTOR', status: 'ATIVO', troca_senha_obrigatoria: false, senha_alterada_em: null });
    }
    return [
      { destinatarioPerfil: 'GESTAO' },
      { destinatarioPerfil: 'GESTAO', destinatarioUsuarioId: ID_GESTAO },
      { destinatarioPerfil: 'EQUIPE_PEDAGOGICA' },
      { destinatarioPerfil: 'EQUIPE_PEDAGOGICA', destinatarioUsuarioId: ID_PEDAGOGICO },
      { destinatarioPerfil: 'TUTOR', destinatarioUsuarioId: ID_TUTOR },
      { destinatarioPerfil: 'TUTOR', destinatarioUsuarioId: ID_TUTOR_2 },
      ...[30, 31, 32, 33].map((id) => ({ destinatarioPerfil: 'TUTOR', destinatarioUsuarioId: id })),
    ];
  }

  it('10 encaminhamentos distintos: 201 (limite — decisão do Rafael)', async () => {
    const res = await post(corpoValido({ encaminhamentos: dezEncaminhamentosDistintos() }));
    expect(res.status).toBe(201);
    expect(banco.encaminhamentos).toHaveLength(10);
  });

  it('11 encaminhamentos: 400 sem abrir transação', async () => {
    const lista = [...dezEncaminhamentosDistintos(), { destinatarioPerfil: 'TUTOR', destinatarioUsuarioId: 34 }];
    const res = await post(corpoValido({ encaminhamentos: lista }));
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ erro: MENSAGEM_ENCAMINHAMENTOS_EXCEDIDOS });
    expect(mocks.transacoes).toBe(0);
    esperarNadaGravado();
  });

  it('tutor destinatário que não é tutor dos estudantes é aceito (decisão do Rafael)', async () => {
    const res = await post(corpoValido({ estudanteIds: [1], encaminhamentos: [{ destinatarioPerfil: 'TUTOR', destinatarioUsuarioId: ID_TUTOR_2 }] }));
    expect(res.status).toBe(201);
  });

  it('o próprio usuário logado (Tutor) pode ser o destinatário', async () => {
    const res = await post(corpoValido(), ID_TUTOR);
    expect(res.status).toBe(201);
    expect(res.body.encaminhamentos[0].destinatarioUsuario.id).toBe(ID_TUTOR);
  });

  it('erro do destinatário aponta a posição correta mesmo com o mesmo usuário em perfis diferentes', async () => {
    const res = await post(
      corpoValido({
        encaminhamentos: [
          { destinatarioPerfil: 'GESTAO', destinatarioUsuarioId: ID_GESTAO },
          { destinatarioPerfil: 'EQUIPE_PEDAGOGICA', destinatarioUsuarioId: ID_GESTAO },
        ],
      }),
    );
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ erro: mensagemDestinatarioInvalido(2, 'EQUIPE_PEDAGOGICA') });
    esperarNadaGravado();
  });

  it('textos com marcação/termos ofensivos fictícios são gravados sem filtro (RN06)', async () => {
    const texto = '<b>texto</b> com palavra-ofensiva-ficticia & "aspas"';
    const res = await post(corpoValido({ descricao: texto }));
    expect(res.status).toBe(201);
    expect(res.body.descricao).toBe(texto);
  });

  it('corpo acima do limite do express.json (512 kB — Issue #128) responde 413 em JSON, sem gravar', async () => {
    const res = await post(corpoValido({ encaminhamentos: Array.from({ length: 30 }, () => ({ destinatarioPerfil: 'GESTAO', observacao: 'x'.repeat(20000) })) }));
    expect(res.status).toBe(413);
    expect(res.body).toEqual({ erro: 'O corpo da requisição passa do tamanho máximo permitido.' });
    esperarNadaGravado();
  });
});
