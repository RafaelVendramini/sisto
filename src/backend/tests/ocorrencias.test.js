// Testes de POST /ocorrencias (Issue #45, UC01) — somente dados fictícios (RN05).
// Não dependem do banco: src/lib/prisma.js é substituído por um "banco" em
// memória (usuários, turmas, categorias e estudantes fictícios). A transação
// em memória tira uma cópia do estado e a restaura se a operação falhar,
// imitando o rollback do PostgreSQL (tudo ou nada — RN03).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const mocks = vi.hoisted(() => ({
  $transaction: vi.fn(),
  falharEm: null,
}));

let banco;

function erroPrisma(code) {
  const erro = new Error(`Erro fictício do Prisma (${code})`);
  erro.code = code;
  return erro;
}

function selecionar(registro, select) {
  if (!select) return { ...registro };
  return Object.fromEntries(
    Object.entries(select)
      .filter(([, incluir]) => incluir === true)
      .map(([campo]) => [campo, registro[campo]]),
  );
}

/** Lança um erro fictício se o teste pediu falha nesta operação. */
function talvezFalhar(operacao) {
  if (mocks.falharEm === operacao) throw new Error(`falha fictícia em ${operacao}`);
}

const turmaPorId = (id) => banco.turmas.find((t) => t.id === id);
const usuarioPorId = (id) => banco.usuarios.find((u) => u.id === id);
const resumoUsuario = (id) => {
  const u = usuarioPorId(id);
  return u ? { id: u.id, nome: u.nome, perfil: u.perfil } : null;
};

/** Monta a ocorrência no formato do select usado pelo service. */
function ocorrenciaCompleta(id) {
  const o = banco.ocorrencias.find((x) => x.id === id);
  if (!o) return null;
  const estudantes = banco.ocorrenciasEstudantes
    .filter((oe) => oe.ocorrencia_id === id)
    .map((oe) => banco.estudantes.find((e) => e.id === oe.estudante_id))
    .sort((a, b) => a.nome_completo.localeCompare(b.nome_completo) || a.id - b.id)
    .map((e) => ({ estudante: { id: e.id, nome_completo: e.nome_completo, turma: turmaPorId(e.turma_id) } }));
  const encaminhamentos = banco.encaminhamentos
    .filter((e) => e.ocorrencia_id === id)
    .sort((a, b) => a.id - b.id)
    .map((e) => ({
      id: e.id,
      destinatario_perfil: e.destinatario_perfil,
      destinatario_usuario: e.destinatario_usuario_id ? resumoUsuario(e.destinatario_usuario_id) : null,
      registrado_por: { id: e.registrado_por_id, nome: usuarioPorId(e.registrado_por_id).nome },
      data_hora: e.data_hora,
      observacao: e.observacao,
    }));
  return {
    ...o,
    turma: turmaPorId(o.turma_id),
    categoria: banco.categorias.find((c) => c.id === o.categoria_id),
    profissional_responsavel: { id: o.profissional_responsavel_id, nome: usuarioPorId(o.profissional_responsavel_id).nome },
    responsavel_acompanhamento: null,
    estudantes,
    encaminhamentos,
  };
}

function clientMock() {
  return {
    usuario: {
      findUnique: async ({ where, select }) => {
        const u = usuarioPorId(where.id);
        return u ? selecionar(u, select) : null;
      },
      findMany: async ({ where, select }) =>
        banco.usuarios.filter((u) => where.id.in.includes(u.id)).map((u) => selecionar(u, select)),
    },
    turma: {
      findUnique: async ({ where, select }) => {
        const t = turmaPorId(where.id);
        return t ? selecionar(t, select) : null;
      },
    },
    categoria: {
      findUnique: async ({ where, select }) => {
        const c = banco.categorias.find((x) => x.id === where.id);
        return c ? selecionar(c, select) : null;
      },
    },
    estudante: {
      findMany: async ({ where, select }) =>
        banco.estudantes.filter((e) => where.id.in.includes(e.id)).map((e) => selecionar(e, select)),
    },
    ocorrencia: {
      create: async ({ data, select }) => {
        talvezFalhar('ocorrencia.create');
        const registro = {
          id: banco.proximo.ocorrencia++,
          responsavel_acompanhamento_id: null,
          data_encerramento: null,
          ...data,
        };
        banco.ocorrencias.push(registro);
        return selecionar(registro, select);
      },
      // Devolve só as chaves do select (o service lê em consultas separadas).
      findUnique: async ({ where, select }) => {
        const completa = ocorrenciaCompleta(where.id);
        if (!completa) return null;
        return Object.fromEntries(Object.keys(select).map((campo) => [campo, completa[campo]]));
      },
    },
    ocorrenciaEstudante: {
      createMany: async ({ data }) => {
        talvezFalhar('ocorrenciaEstudante.createMany');
        for (const linha of data) {
          const repetida = banco.ocorrenciasEstudantes.some(
            (oe) => oe.ocorrencia_id === linha.ocorrencia_id && oe.estudante_id === linha.estudante_id,
          );
          if (repetida) throw erroPrisma('P2002'); // PK composta
          banco.ocorrenciasEstudantes.push({ ...linha });
        }
        return { count: data.length };
      },
      findMany: async ({ where }) => ocorrenciaCompleta(where.ocorrencia_id).estudantes,
    },
    encaminhamento: {
      findMany: async ({ where }) => ocorrenciaCompleta(where.ocorrencia_id).encaminhamentos,
      create: async ({ data, select }) => {
        talvezFalhar('encaminhamento.create');
        // data_hora: @default(now()) no banco (RN17).
        const registro = { id: banco.proximo.encaminhamento++, data_hora: new Date(), ...data };
        banco.encaminhamentos.push(registro);
        return selecionar(registro, select);
      },
    },
    historicoOcorrencia: {
      createMany: async ({ data }) => {
        talvezFalhar('historicoOcorrencia.createMany');
        for (const linha of data) {
          banco.historicos.push({ id: banco.proximo.historico++, descricao: null, data_hora: new Date(), ...linha });
        }
        return { count: data.length };
      },
    },
    logAuditoria: {
      create: async ({ data }) => {
        talvezFalhar('logAuditoria.create');
        banco.logs.push(data);
        return { id: banco.logs.length };
      },
    },
  };
}

vi.mock('../src/lib/prisma.js', () => ({
  default: new Proxy(
    {},
    {
      get(_alvo, prop) {
        if (prop === '$transaction') return (...a) => mocks.$transaction(...a);
        return clientMock()[prop];
      },
    },
  ),
}));

const { default: app } = await import('../src/app.js');
const { MENSAGEM_PERFIL_SEM_PERMISSAO, MENSAGEM_TROCA_SENHA_OBRIGATORIA } = await import(
  '../src/middlewares/autenticacao.js'
);
const { MENSAGEM_NAO_AUTENTICADO } = await import('../src/services/sessao.js');
const { ACOES_AUDITORIA } = await import('../src/services/auditoria.js');
const servico = await import('../src/services/ocorrencias.js');
const {
  ACOES_HISTORICO,
  MENSAGEM_CORPO_OCORRENCIA_INVALIDO,
  MENSAGEM_DATA_HORA_INVALIDA,
  MENSAGEM_DATA_HORA_FUTURA,
  MENSAGEM_LOCAL_OBRIGATORIO,
  MENSAGEM_LOCAL_LONGO,
  MENSAGEM_TURMA_ID_INVALIDO,
  MENSAGEM_CATEGORIA_ID_INVALIDO,
  MENSAGEM_DESCRICAO_OBRIGATORIA,
  MENSAGEM_ESTUDANTES_OBRIGATORIOS,
  MENSAGEM_ESTUDANTE_ID_INVALIDO,
  MENSAGEM_ENCAMINHAMENTOS_OBRIGATORIOS,
  MENSAGEM_TURMA_INEXISTENTE,
  MENSAGEM_CATEGORIA_INEXISTENTE,
  MENSAGEM_ESTUDANTE_INEXISTENTE,
  MENSAGEM_CONFLITO_CONCORRENTE_OCORRENCIA,
  TAMANHO_MAXIMO_LOCAL,
  TAMANHO_MAXIMO_TEXTO_LONGO,
  TOLERANCIA_FUTURO_MS,
  mensagemTextoLongo,
  mensagemTextoInvalido,
  mensagemEncaminhamentoInvalido,
  mensagemDestinatarioPerfilInvalido,
  mensagemDestinatarioUsuarioIdInvalido,
  mensagemTutorObrigatorio,
  mensagemDestinatarioInvalido,
  mensagemEncaminhamentoRepetido,
  MAXIMO_ESTUDANTES,
  MAXIMO_ENCAMINHAMENTOS,
  MENSAGEM_ESTUDANTES_EXCEDIDOS,
  MENSAGEM_ENCAMINHAMENTOS_EXCEDIDOS,
  converterDataHora,
  validarOcorrencia,
  registrarOcorrencia,
} = servico;

const SEGREDO_TESTE = 'segredo-ficticio-de-teste-com-mais-de-32-caracteres';
const PERFIS = ['PROFESSOR', 'TUTOR', 'GESTAO', 'PEDAGOGICO', 'TECNICO_ADMINISTRATIVO'];
// ids 1..5 = um usuário ativo por perfil, na ordem de PERFIS
const ID_PROFESSOR = 1;
const ID_TUTOR = 2;
const ID_GESTAO = 3;
const ID_PEDAGOGICO = 4;
const ID_TECNICO = 5;
const ID_TROCA_PENDENTE = 6;
const ID_TUTOR_BLOQUEADO = 7;
const ID_TUTOR_DESATIVADO = 8;
const ID_PEDAGOGICO_BLOQUEADO = 9;
const ID_GESTAO_DESATIVADA = 10;
const ID_INEXISTENTE = 999;

beforeEach(() => {
  process.env.JWT_SECRET = SEGREDO_TESTE;
  mocks.falharEm = null;

  const usuario = (id, perfil, extra = {}) => ({
    id,
    nome: `Usuário Fictício ${id}`,
    email: `usuario${id}@sisto.exemplo`,
    perfil,
    status: 'ATIVO',
    troca_senha_obrigatoria: false,
    senha_alterada_em: null,
    ...extra,
  });

  banco = {
    usuarios: [
      ...PERFIS.map((perfil, i) => usuario(i + 1, perfil)),
      usuario(ID_TROCA_PENDENTE, 'PROFESSOR', { troca_senha_obrigatoria: true }),
      usuario(ID_TUTOR_BLOQUEADO, 'TUTOR', { status: 'BLOQUEADO' }),
      usuario(ID_TUTOR_DESATIVADO, 'TUTOR', { status: 'DESATIVADO' }),
      usuario(ID_PEDAGOGICO_BLOQUEADO, 'PEDAGOGICO', { status: 'BLOQUEADO' }),
      usuario(ID_GESTAO_DESATIVADA, 'GESTAO', { status: 'DESATIVADO' }),
    ],
    turmas: [
      { id: 1, nome: '6º A', etapa: 'Ensino Fundamental', ano_letivo: 2026 },
      { id: 2, nome: '1º A', etapa: 'Ensino Médio', ano_letivo: 2026 },
    ],
    categorias: [
      { id: 1, nome: 'Indisciplina', descricao: null },
      { id: 2, nome: 'Conflitos', descricao: null },
    ],
    estudantes: [
      { id: 1, nome_completo: 'Estudante Fictício B', codigo_escolar: 'TESTE-0001', turma_id: 1, tutor_id: ID_TUTOR },
      { id: 2, nome_completo: 'Estudante Fictício A', codigo_escolar: 'TESTE-0002', turma_id: 1, tutor_id: null },
      { id: 3, nome_completo: 'Estudante Fictício C', codigo_escolar: null, turma_id: 2, tutor_id: null },
    ],
    ocorrencias: [],
    ocorrenciasEstudantes: [],
    encaminhamentos: [],
    historicos: [],
    logs: [],
    proximo: { ocorrencia: 1, encaminhamento: 1, historico: 1 },
  };

  mocks.$transaction.mockReset();
  mocks.$transaction.mockImplementation(async (operacao) => {
    const copia = structuredClone(banco);
    try {
      return await operacao(clientMock());
    } catch (erro) {
      banco = copia; // rollback
      throw erro;
    }
  });
});

afterEach(() => {
  delete process.env.JWT_SECRET;
});

function token(id) {
  return jwt.sign({ id, perfil: usuarioPorId(id).perfil }, SEGREDO_TESTE, {
    algorithm: 'HS256',
    expiresIn: '8h',
  });
}

const postOcorrencia = (corpo, usuarioId = ID_PROFESSOR) => {
  const req = request(app).post('/ocorrencias');
  if (usuarioId) req.set('Authorization', `Bearer ${token(usuarioId)}`);
  return req.send(corpo);
};

const umMinutoAtras = () => new Date(Date.now() - 60_000).toISOString();

function corpoValido(extra = {}) {
  return {
    dataHora: umMinutoAtras(),
    local: 'Pátio',
    turmaId: 1,
    categoriaId: 1,
    descricao: 'Descrição objetiva fictícia do fato.',
    estudanteIds: [1],
    encaminhamentos: [{ destinatarioPerfil: 'TUTOR', destinatarioUsuarioId: ID_TUTOR }],
    ...extra,
  };
}

/** Garante que nada foi gravado. */
function esperarBancoVazio() {
  expect(banco.ocorrencias).toHaveLength(0);
  expect(banco.ocorrenciasEstudantes).toHaveLength(0);
  expect(banco.encaminhamentos).toHaveLength(0);
  expect(banco.historicos).toHaveLength(0);
  expect(banco.logs).toHaveLength(0);
}

// ---------------------------------------------------------------------------
// Caminho feliz
// ---------------------------------------------------------------------------
describe('POST /ocorrencias — registro', () => {
  it.each(PERFIS.map((perfil, i) => [perfil, i + 1]))(
    'perfil %s registra a ocorrência (201)',
    async (_perfil, id) => {
      const res = await postOcorrencia(corpoValido(), id);
      expect(res.status).toBe(201);
      expect(res.body.status).toBe('ABERTO');
      expect(res.body.profissionalResponsavel).toEqual({ id, nome: `Usuário Fictício ${id}` });
    },
  );

  it('responde 201 com a ocorrência criada, estudantes e encaminhamentos', async () => {
    const dataHora = '2026-10-20T14:30:00-03:00';
    const res = await postOcorrencia(
      corpoValido({
        dataHora,
        estudanteIds: [1, 2],
        demaisEnvolvidos: 'Funcionário fictício da cantina',
        testemunhas: '  Professor fictício de Artes  ',
        providenciasImediatas: 'Conversa com os estudantes',
        observacoes: '',
        encaminhamentos: [
          { destinatarioPerfil: 'TUTOR', destinatarioUsuarioId: ID_TUTOR, observacao: 'Acompanhar' },
          { destinatarioPerfil: 'GESTAO' },
        ],
      }),
    );
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      id: 1,
      dataHora: '2026-10-20T17:30:00.000Z',
      local: 'Pátio',
      turma: { id: 1, nome: '6º A', etapa: 'Ensino Fundamental', anoLetivo: 2026 },
      categoria: { id: 1, nome: 'Indisciplina' },
      descricao: 'Descrição objetiva fictícia do fato.',
      demaisEnvolvidos: 'Funcionário fictício da cantina',
      testemunhas: 'Professor fictício de Artes',
      providenciasImediatas: 'Conversa com os estudantes',
      observacoes: null,
      status: 'ABERTO',
      dataEncerramento: null,
      profissionalResponsavel: { id: ID_PROFESSOR, nome: 'Usuário Fictício 1' },
      responsavelAcompanhamento: null,
      estudantes: [
        { id: 2, nomeCompleto: 'Estudante Fictício A', turma: { id: 1, nome: '6º A', etapa: 'Ensino Fundamental', anoLetivo: 2026 } },
        { id: 1, nomeCompleto: 'Estudante Fictício B', turma: { id: 1, nome: '6º A', etapa: 'Ensino Fundamental', anoLetivo: 2026 } },
      ],
      encaminhamentos: [
        {
          id: 1,
          destinatarioPerfil: 'TUTOR',
          destinatarioUsuario: { id: ID_TUTOR, nome: 'Usuário Fictício 2', perfil: 'TUTOR' },
          registradoPor: { id: ID_PROFESSOR, nome: 'Usuário Fictício 1' },
          observacao: 'Acompanhar',
        },
        {
          id: 2,
          destinatarioPerfil: 'GESTAO',
          destinatarioUsuario: null,
          registradoPor: { id: ID_PROFESSOR, nome: 'Usuário Fictício 1' },
          observacao: null,
        },
      ],
    });
    for (const e of res.body.encaminhamentos) {
      expect(typeof e.dataHora).toBe('string');
    }
  });

  it('a resposta não traz código escolar nem e-mail (RN20)', async () => {
    const res = await postOcorrencia(corpoValido({ estudanteIds: [1, 2, 3] }), ID_GESTAO);
    expect(res.status).toBe(201);
    expect(JSON.stringify(res.body)).not.toMatch(/codigoEscolar|codigo_escolar|TESTE-|email|@/);
  });

  it('grava o status ABERTO e o profissional logado; o encaminhamento não muda o status (RN02/RN03)', async () => {
    await postOcorrencia(corpoValido(), ID_TECNICO);
    expect(banco.ocorrencias[0]).toMatchObject({
      status: 'ABERTO',
      profissional_responsavel_id: ID_TECNICO,
      responsavel_acompanhamento_id: null,
    });
  });

  it('ignora profissionalResponsavelId, status e outros campos do corpo (RN02)', async () => {
    const res = await postOcorrencia(
      corpoValido({
        profissionalResponsavelId: ID_GESTAO,
        profissional_responsavel_id: ID_GESTAO,
        status: 'ENCERRADO',
        responsavelAcompanhamentoId: ID_GESTAO,
      }),
      ID_PROFESSOR,
    );
    expect(res.status).toBe(201);
    expect(res.body.profissionalResponsavel.id).toBe(ID_PROFESSOR);
    expect(res.body.status).toBe('ABERTO');
    expect(res.body.responsavelAcompanhamento).toBeNull();
    expect(banco.ocorrencias[0].profissional_responsavel_id).toBe(ID_PROFESSOR);
  });

  it('o encaminhamento registra quem registrou e ignora registradoPorId/dataHora do corpo (RN17)', async () => {
    const res = await postOcorrencia(
      corpoValido({
        encaminhamentos: [
          { destinatarioPerfil: 'GESTAO', registradoPorId: ID_GESTAO, dataHora: '2020-01-01T00:00:00Z' },
        ],
      }),
      ID_PEDAGOGICO,
    );
    expect(res.status).toBe(201);
    const [enc] = banco.encaminhamentos;
    expect(enc.registrado_por_id).toBe(ID_PEDAGOGICO);
    expect(enc.data_hora.getFullYear()).not.toBe(2020);
    // O service não envia data_hora: fica com o @default(now()) do banco.
    expect(Object.keys(enc)).not.toContain('dataHora');
  });

  it('grava 2+ estudantes, inclusive de turmas diferentes da turma de referência (RF06/RN14)', async () => {
    const res = await postOcorrencia(corpoValido({ turmaId: 1, estudanteIds: [1, 3] }));
    expect(res.status).toBe(201);
    expect(banco.ocorrenciasEstudantes).toEqual([
      { ocorrencia_id: 1, estudante_id: 1 },
      { ocorrencia_id: 1, estudante_id: 3 },
    ]);
    expect(banco.ocorrencias[0].turma_id).toBe(1);
    expect(res.body.estudantes.map((e) => e.turma.id)).toEqual([1, 2]);
  });

  it('ids de estudantes repetidos contam uma vez (RF06)', async () => {
    const res = await postOcorrencia(corpoValido({ estudanteIds: [3, 1, 3, 1, 3] }));
    expect(res.status).toBe(201);
    expect(banco.ocorrenciasEstudantes.map((oe) => oe.estudante_id)).toEqual([3, 1]);
    expect(res.body.estudantes).toHaveLength(2);
  });

  it('EQUIPE_PEDAGOGICA e GESTAO aceitam usuário ativo do perfil correspondente', async () => {
    const res = await postOcorrencia(
      corpoValido({
        encaminhamentos: [
          { destinatarioPerfil: 'EQUIPE_PEDAGOGICA', destinatarioUsuarioId: ID_PEDAGOGICO },
          { destinatarioPerfil: 'GESTAO', destinatarioUsuarioId: ID_GESTAO },
          { destinatarioPerfil: 'EQUIPE_PEDAGOGICA', destinatarioUsuarioId: null },
        ],
      }),
    );
    expect(res.status).toBe(201);
    expect(banco.encaminhamentos.map((e) => [e.destinatario_perfil, e.destinatario_usuario_id])).toEqual([
      ['EQUIPE_PEDAGOGICA', ID_PEDAGOGICO],
      ['GESTAO', ID_GESTAO],
      ['EQUIPE_PEDAGOGICA', null],
    ]);
  });

  it('textos são aceitos sem filtro de conteúdo (RN06), com espaços nas pontas removidos', async () => {
    const res = await postOcorrencia(corpoValido({ local: '  Sala 12  ', descricao: '  Texto livre fictício  ' }));
    expect(res.status).toBe(201);
    expect(banco.ocorrencias[0]).toMatchObject({ local: 'Sala 12', descricao: 'Texto livre fictício' });
  });

  it('aceita textos no limite de tamanho', async () => {
    const res = await postOcorrencia(
      corpoValido({
        local: 'L'.repeat(TAMANHO_MAXIMO_LOCAL),
        descricao: 'D'.repeat(TAMANHO_MAXIMO_TEXTO_LONGO),
        observacoes: 'O'.repeat(TAMANHO_MAXIMO_TEXTO_LONGO),
      }),
    );
    expect(res.status).toBe(201);
  });
});

// ---------------------------------------------------------------------------
// Histórico e auditoria
// ---------------------------------------------------------------------------
describe('POST /ocorrencias — histórico (RN08) e auditoria (RNF04)', () => {
  it('grava "ocorrência registrada" e um histórico por encaminhamento, com o usuário logado', async () => {
    await postOcorrencia(
      corpoValido({
        encaminhamentos: [
          { destinatarioPerfil: 'TUTOR', destinatarioUsuarioId: ID_TUTOR, observacao: 'Texto fictício' },
          { destinatarioPerfil: 'EQUIPE_PEDAGOGICA' },
          { destinatarioPerfil: 'GESTAO' },
        ],
      }),
      ID_TUTOR,
    );
    expect(banco.historicos.map(({ ocorrencia_id, usuario_id, acao, descricao }) => ({ ocorrencia_id, usuario_id, acao, descricao }))).toEqual([
      { ocorrencia_id: 1, usuario_id: ID_TUTOR, acao: ACOES_HISTORICO.OCORRENCIA_REGISTRADA, descricao: null },
      { ocorrencia_id: 1, usuario_id: ID_TUTOR, acao: ACOES_HISTORICO.ENCAMINHAMENTO_REGISTRADO, descricao: 'Destinatário: tutor' },
      { ocorrencia_id: 1, usuario_id: ID_TUTOR, acao: ACOES_HISTORICO.ENCAMINHAMENTO_REGISTRADO, descricao: 'Destinatário: equipe pedagógica' },
      { ocorrencia_id: 1, usuario_id: ID_TUTOR, acao: ACOES_HISTORICO.ENCAMINHAMENTO_REGISTRADO, descricao: 'Destinatário: gestão' },
    ]);
  });

  it('histórico e auditoria não contêm dados pessoais nem o texto do registro', async () => {
    await postOcorrencia(
      corpoValido({
        estudanteIds: [1, 2],
        descricao: 'Descrição sigilosa fictícia',
        encaminhamentos: [{ destinatarioPerfil: 'TUTOR', destinatarioUsuarioId: ID_TUTOR, observacao: 'Observação sigilosa fictícia' }],
      }),
    );
    const texto = JSON.stringify([banco.historicos, banco.logs]);
    expect(texto).not.toMatch(/Fictício|sigilosa|TESTE-|@|Pátio/);
  });

  it('grava LogAuditoria "ocorrência criada" com recurso ocorrencias/<id>', async () => {
    await postOcorrencia(corpoValido(), ID_GESTAO);
    expect(banco.logs).toEqual([
      { usuario_id: ID_GESTAO, acao: ACOES_AUDITORIA.OCORRENCIA_CRIADA, recurso: 'ocorrencias/1' },
    ]);
    expect(ACOES_AUDITORIA.OCORRENCIA_CRIADA).toBe('ocorrência criada');
  });
});

// ---------------------------------------------------------------------------
// Autenticação e permissões
// ---------------------------------------------------------------------------
describe('POST /ocorrencias — autenticação', () => {
  it('sem token responde 401', async () => {
    const res = await postOcorrencia(corpoValido(), null);
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ erro: MENSAGEM_NAO_AUTENTICADO });
    esperarBancoVazio();
  });

  it('com troca de senha pendente responde 403 (RN10)', async () => {
    const res = await postOcorrencia(corpoValido(), ID_TROCA_PENDENTE);
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ erro: MENSAGEM_TROCA_SENHA_OBRIGATORIA });
    esperarBancoVazio();
  });

  it('a rota POST / vem primeiro e o middleware de perfil libera exatamente os 5 perfis', async () => {
    const { default: rotas } = await import('../src/routes/ocorrencias.js');
    const { Perfil } = await import('@prisma/client');
    // Issue #47 acrescentou GET / e GET /:id (testados em ocorrencias-consulta.test.js).
    expect(rotas.stack.map((c) => [c.route.path, Object.keys(c.route.methods)])).toEqual([
      ['/', ['post']],
      ['/', ['get']],
      ['/:id', ['get']],
    ]);

    // Os 5 perfis da matriz (Seção 4) são todos os valores do enum Perfil.
    expect([...Object.values(Perfil)].sort()).toEqual([...PERFIS].sort());

    const camadas = rotas.stack[0].route.stack.map((c) => c.handle);
    const verificarPerfil = camadas.find((h) => h.name === 'verificarPerfil');
    expect(verificarPerfil).toBeTypeOf('function');
    expect(camadas.indexOf(verificarPerfil)).toBeLessThan(camadas.length - 1); // vem antes do controller

    const liberados = [];
    for (const perfil of [...PERFIS, 'PERFIL_INEXISTENTE', undefined]) {
      const next = vi.fn();
      try {
        verificarPerfil({ usuario: { id: 1, perfil } }, {}, next);
        if (next.mock.calls.length === 1) liberados.push(perfil);
      } catch (erro) {
        expect(erro.status).toBe(403);
        expect(erro.message).toBe(MENSAGEM_PERFIL_SEM_PERMISSAO);
      }
    }
    expect(liberados).toEqual(PERFIS);
  });

  it('está montada em protegidas depois do bloqueio de troca de senha', async () => {
    const { protegidas } = await import('../src/routes/index.js');
    const { default: rotasOcorrencias } = await import('../src/routes/ocorrencias.js');
    const { bloquearComTrocaDeSenhaPendente } = await import('../src/middlewares/autenticacao.js');
    const camadas = protegidas.stack.map((c) => c.handle);
    expect(camadas.indexOf(rotasOcorrencias)).toBeGreaterThan(camadas.indexOf(bloquearComTrocaDeSenhaPendente));
  });
});

// ---------------------------------------------------------------------------
// Validações (400)
// ---------------------------------------------------------------------------
describe('POST /ocorrencias — validação do corpo (400)', () => {
  const semCampo = (campo) => {
    const corpo = corpoValido();
    delete corpo[campo];
    return corpo;
  };

  it.each([
    ['dataHora', MENSAGEM_DATA_HORA_INVALIDA],
    ['local', MENSAGEM_LOCAL_OBRIGATORIO],
    ['turmaId', MENSAGEM_TURMA_ID_INVALIDO],
    ['categoriaId', MENSAGEM_CATEGORIA_ID_INVALIDO],
    ['descricao', MENSAGEM_DESCRICAO_OBRIGATORIA],
    ['estudanteIds', MENSAGEM_ESTUDANTES_OBRIGATORIOS],
    ['encaminhamentos', MENSAGEM_ENCAMINHAMENTOS_OBRIGATORIOS],
  ])('sem %s responde 400 com mensagem clara', async (campo, mensagem) => {
    const res = await postOcorrencia(semCampo(campo));
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ erro: mensagem });
    esperarBancoVazio();
    expect(mocks.$transaction).not.toHaveBeenCalled();
  });

  const enviarBruto = (texto) =>
    request(app)
      .post('/ocorrencias')
      .set('Authorization', `Bearer ${token(ID_PROFESSOR)}`)
      .set('Content-Type', 'application/json')
      .send(texto);

  it('corpo que é uma lista responde 400', async () => {
    const res = await enviarBruto('[]');
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ erro: MENSAGEM_CORPO_OCORRENCIA_INVALIDO });
  });

  it.each([['null'], ['"texto"'], ['42'], ['{ quebrado']])('corpo %s responde 400 (JSON recusado pelo Express)', async (texto) => {
    const res = await enviarBruto(texto);
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ erro: 'JSON inválido no corpo da requisição' });
    esperarBancoVazio();
  });

  it('o service recusa corpo ausente ou que não é objeto', () => {
    for (const corpo of [undefined, null, 'texto', 42, []]) {
      expect(() => validarOcorrencia(corpo)).toThrow(MENSAGEM_CORPO_OCORRENCIA_INVALIDO);
    }
  });

  it('sem estudante (lista vazia) responde 400 (RN02)', async () => {
    const res = await postOcorrencia(corpoValido({ estudanteIds: [] }));
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ erro: MENSAGEM_ESTUDANTES_OBRIGATORIOS });
  });

  it('sem encaminhamento (lista vazia) responde 400 (RN03)', async () => {
    const res = await postOcorrencia(corpoValido({ encaminhamentos: [] }));
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ erro: MENSAGEM_ENCAMINHAMENTOS_OBRIGATORIOS });
    esperarBancoVazio();
  });

  it.each([['   '], [''], [7], [null]])('local %j responde 400', async (local) => {
    const res = await postOcorrencia(corpoValido({ local }));
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ erro: MENSAGEM_LOCAL_OBRIGATORIO });
  });

  it('local acima de 150 caracteres responde 400', async () => {
    const res = await postOcorrencia(corpoValido({ local: 'L'.repeat(TAMANHO_MAXIMO_LOCAL + 1) }));
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ erro: MENSAGEM_LOCAL_LONGO });
  });

  it('descricao só com espaços responde 400', async () => {
    const res = await postOcorrencia(corpoValido({ descricao: '   ' }));
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ erro: MENSAGEM_DESCRICAO_OBRIGATORIA });
  });

  it.each(['descricao', 'demaisEnvolvidos', 'testemunhas', 'providenciasImediatas', 'observacoes'])(
    '%s acima do limite responde 400',
    async (campo) => {
      const res = await postOcorrencia(corpoValido({ [campo]: 'x'.repeat(TAMANHO_MAXIMO_TEXTO_LONGO + 1) }));
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ erro: mensagemTextoLongo(campo) });
    },
  );

  it.each(['demaisEnvolvidos', 'testemunhas', 'providenciasImediatas', 'observacoes'])(
    '%s que não é texto responde 400',
    async (campo) => {
      const res = await postOcorrencia(corpoValido({ [campo]: 123 }));
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ erro: mensagemTextoInvalido(campo) });
    },
  );

  it('textos opcionais null ou vazios são gravados como null', async () => {
    const res = await postOcorrencia(corpoValido({ demaisEnvolvidos: null, testemunhas: '  ' }));
    expect(res.status).toBe(201);
    expect(banco.ocorrencias[0]).toMatchObject({
      demais_envolvidos: null,
      testemunhas: null,
      providencias_imediatas: null,
      observacoes: null,
    });
  });

  it.each([['1'], [1.5], [0], [-1], [2_147_483_648], [true]])('turmaId %j responde 400', async (turmaId) => {
    const res = await postOcorrencia(corpoValido({ turmaId }));
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ erro: MENSAGEM_TURMA_ID_INVALIDO });
  });

  it.each([['1'], [0], [null]])('categoriaId %j responde 400', async (categoriaId) => {
    const res = await postOcorrencia(corpoValido({ categoriaId }));
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ erro: MENSAGEM_CATEGORIA_ID_INVALIDO });
  });

  it.each([[[1, '2']], [[0]], [[1.5]], [[null]]])('estudanteIds %j responde 400', async (estudanteIds) => {
    const res = await postOcorrencia(corpoValido({ estudanteIds }));
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ erro: MENSAGEM_ESTUDANTE_ID_INVALIDO });
  });

  it.each([[1], ['1'], [{ id: 1 }]])('estudanteIds que não é lista (%j) responde 400', async (estudanteIds) => {
    const res = await postOcorrencia(corpoValido({ estudanteIds }));
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ erro: MENSAGEM_ESTUDANTES_OBRIGATORIOS });
  });

  it('encaminhamentos que não é lista responde 400', async () => {
    const res = await postOcorrencia(corpoValido({ encaminhamentos: { destinatarioPerfil: 'GESTAO' } }));
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ erro: MENSAGEM_ENCAMINHAMENTOS_OBRIGATORIOS });
  });
});

// ---------------------------------------------------------------------------
// dataHora (RN17)
// ---------------------------------------------------------------------------
describe('POST /ocorrencias — dataHora (RN17)', () => {
  it.each([
    ['2026-10-20'],
    ['2026-10-20 14:30'],
    ['2026-10-20T14:30:00'], // sem fuso
    ['2026-02-30T10:00:00Z'],
    ['2026-13-01T10:00:00Z'],
    ['2026-10-20T24:00:00Z'],
    ['2026-10-20T10:60:00Z'],
    ['ontem'],
    [1729440000000],
    [null],
  ])('dataHora %j responde 400', async (dataHora) => {
    const res = await postOcorrencia(corpoValido({ dataHora }));
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ erro: MENSAGEM_DATA_HORA_INVALIDA });
  });

  it('aceita fuso Z, offset e fração de segundos e grava em UTC', () => {
    expect(converterDataHora('2026-10-20T14:30Z').toISOString()).toBe('2026-10-20T14:30:00.000Z');
    expect(converterDataHora('2026-10-20T14:30:15.250-03:00').toISOString()).toBe('2026-10-20T17:30:15.250Z');
    expect(converterDataHora('2024-02-29T00:00:00+00:00').toISOString()).toBe('2024-02-29T00:00:00.000Z');
    expect(() => converterDataHora('2026-02-29T00:00:00Z')).toThrow(MENSAGEM_DATA_HORA_INVALIDA);
  });

  it('data mais de 5 minutos no futuro responde 400', async () => {
    const res = await postOcorrencia(corpoValido({ dataHora: new Date(Date.now() + 6 * 60_000).toISOString() }));
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ erro: MENSAGEM_DATA_HORA_FUTURA });
    esperarBancoVazio();
  });

  it('data até 5 minutos no futuro é aceita', async () => {
    const res = await postOcorrencia(corpoValido({ dataHora: new Date(Date.now() + 4 * 60_000).toISOString() }));
    expect(res.status).toBe(201);
  });

  it('limite exato: agora + 5 min aceita; 1 ms a mais recusa', () => {
    const agora = new Date('2026-10-26T12:00:00.000Z');
    const limite = new Date(agora.getTime() + TOLERANCIA_FUTURO_MS).toISOString();
    const acima = new Date(agora.getTime() + TOLERANCIA_FUTURO_MS + 1).toISOString();
    expect(validarOcorrencia(corpoValido({ dataHora: limite }), { agora: () => agora }).dataHora.toISOString()).toBe(limite);
    expect(() => validarOcorrencia(corpoValido({ dataHora: acima }), { agora: () => agora })).toThrow(MENSAGEM_DATA_HORA_FUTURA);
  });

  it('a tolerância compara instantes, independentemente do fuso informado', () => {
    const agora = new Date('2026-10-26T12:00:00.000Z');
    // 09:04 em São Paulo (-03:00) = 12:04Z: dentro da tolerância
    expect(() => validarOcorrencia(corpoValido({ dataHora: '2026-10-26T09:04:00-03:00' }), { agora: () => agora })).not.toThrow();
    // 09:06 em São Paulo = 12:06Z: acima
    expect(() => validarOcorrencia(corpoValido({ dataHora: '2026-10-26T09:06:00-03:00' }), { agora: () => agora })).toThrow(MENSAGEM_DATA_HORA_FUTURA);
  });

  // Limite TÉCNICO do TIMESTAMP(3) via Prisma, medido no PostgreSQL:
  // 0001-01-01T00:00:00.000Z .. 9999-12-31T23:59:59.999Z (UTC).
  it.each([
    ['0000-01-01T00:00:00Z'], // ano 0 (1 a.C.): erro 22008 no PostgreSQL
    ['0000-12-31T23:59:59.999Z'],
    ['0001-01-01T00:00:00+14:00'], // = 0000-12-31T10:00Z
    ['0001-01-01T00:00:00+00:01'], // = 0000-12-31T23:59Z
    ['9999-12-31T23:59:59-14:00'], // = ano 10000 em UTC
    ['9999-12-31T23:59:59.999-00:01'],
  ])('%s fora da faixa gravável responde 400 de data inválida (nunca 500)', async (dataHora) => {
    expect(() => converterDataHora(dataHora)).toThrow(MENSAGEM_DATA_HORA_INVALIDA);
    const res = await postOcorrencia(corpoValido({ dataHora }));
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ erro: MENSAGEM_DATA_HORA_INVALIDA });
    esperarBancoVazio();
  });

  it('extremos graváveis são convertidos (sem data mínima de negócio)', () => {
    expect(converterDataHora('0001-01-01T00:00:00Z').toISOString()).toBe('0001-01-01T00:00:00.000Z');
    expect(converterDataHora('0001-01-01T00:00:00-03:00').toISOString()).toBe('0001-01-01T03:00:00.000Z');
    expect(converterDataHora('9999-12-31T23:59:59.999Z').toISOString()).toBe('9999-12-31T23:59:59.999Z');
    expect(converterDataHora('9999-12-31T23:59:59+14:00').toISOString()).toBe('9999-12-31T09:59:59.000Z');
  });

  it('o menor instante gravável (ano 1) é aceito pela API (201)', async () => {
    const res = await postOcorrencia(corpoValido({ dataHora: '0001-01-01T00:00:00Z' }));
    expect(res.status).toBe(201);
    expect(res.body.dataHora).toBe('0001-01-01T00:00:00.000Z');
  });

  it('o maior instante gravável passa na conversão, mas é futuro (400 de data futura)', async () => {
    const res = await postOcorrencia(corpoValido({ dataHora: '9999-12-31T23:59:59.999Z' }));
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ erro: MENSAGEM_DATA_HORA_FUTURA });
  });
});

// ---------------------------------------------------------------------------
// Referências (RN14) e destinatários (RN03)
// ---------------------------------------------------------------------------
describe('POST /ocorrencias — referências e destinatários (400)', () => {
  it('turma inexistente responde 400', async () => {
    const res = await postOcorrencia(corpoValido({ turmaId: ID_INEXISTENTE }));
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ erro: MENSAGEM_TURMA_INEXISTENTE });
    esperarBancoVazio();
  });

  it('categoria inexistente responde 400', async () => {
    const res = await postOcorrencia(corpoValido({ categoriaId: ID_INEXISTENTE }));
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ erro: MENSAGEM_CATEGORIA_INEXISTENTE });
    esperarBancoVazio();
  });

  it('estudante inexistente (entre válidos) responde 400 sem ecoar ids nem nomes', async () => {
    const res = await postOcorrencia(corpoValido({ estudanteIds: [1, ID_INEXISTENTE] }));
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ erro: MENSAGEM_ESTUDANTE_INEXISTENTE });
    expect(res.body.erro).not.toMatch(/999|Fictício/);
    esperarBancoVazio();
  });

  it('estudante repetido junto de um inexistente continua 400 (contagem após remover repetidos)', async () => {
    const res = await postOcorrencia(corpoValido({ estudanteIds: [1, 1, ID_INEXISTENTE] }));
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ erro: MENSAGEM_ESTUDANTE_INEXISTENTE });
  });

  it.each([[null], ['TUTOR'], [[]], [7]])('encaminhamento %j responde 400', async (item) => {
    const res = await postOcorrencia(corpoValido({ encaminhamentos: [item] }));
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ erro: mensagemEncaminhamentoInvalido(1) });
  });

  it.each([['PROFESSOR'], ['PEDAGOGICO'], ['tutor'], [''], [undefined]])(
    'destinatarioPerfil %j responde 400',
    async (destinatarioPerfil) => {
      const res = await postOcorrencia(corpoValido({ encaminhamentos: [{ destinatarioPerfil }] }));
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ erro: mensagemDestinatarioPerfilInvalido(1) });
    },
  );

  it.each([['2'], [0], [1.5]])('destinatarioUsuarioId %j responde 400', async (destinatarioUsuarioId) => {
    const res = await postOcorrencia(
      corpoValido({ encaminhamentos: [{ destinatarioPerfil: 'GESTAO' }, { destinatarioPerfil: 'GESTAO', destinatarioUsuarioId }] }),
    );
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ erro: mensagemDestinatarioUsuarioIdInvalido(2) });
  });

  it.each([[undefined], [null]])('TUTOR sem destinatarioUsuarioId (%j) responde 400', async (destinatarioUsuarioId) => {
    const res = await postOcorrencia(corpoValido({ encaminhamentos: [{ destinatarioPerfil: 'TUTOR', destinatarioUsuarioId }] }));
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ erro: mensagemTutorObrigatorio(1) });
    esperarBancoVazio();
  });

  it.each([
    ['TUTOR', ID_TUTOR_BLOQUEADO, 'tutor bloqueado'],
    ['TUTOR', ID_TUTOR_DESATIVADO, 'tutor desativado'],
    ['TUTOR', ID_PEDAGOGICO, 'usuário que não é Tutor'],
    ['TUTOR', ID_INEXISTENTE, 'usuário inexistente'],
    ['EQUIPE_PEDAGOGICA', ID_PEDAGOGICO_BLOQUEADO, 'pedagógico bloqueado'],
    ['EQUIPE_PEDAGOGICA', ID_GESTAO, 'Gestão como equipe pedagógica'],
    ['EQUIPE_PEDAGOGICA', ID_INEXISTENTE, 'usuário inexistente'],
    ['GESTAO', ID_GESTAO_DESATIVADA, 'gestão desativada'],
    ['GESTAO', ID_PROFESSOR, 'professor como gestão'],
    ['GESTAO', ID_TECNICO, 'técnico-administrativo como gestão'],
  ])('%s com usuário %i (%s) responde 400', async (destinatarioPerfil, destinatarioUsuarioId) => {
    const res = await postOcorrencia(
      corpoValido({ encaminhamentos: [{ destinatarioPerfil: 'GESTAO' }, { destinatarioPerfil, destinatarioUsuarioId }] }),
    );
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ erro: mensagemDestinatarioInvalido(2, destinatarioPerfil) });
    expect(res.body.erro).not.toMatch(/Fictício|@/);
    esperarBancoVazio();
  });

  it('mensagens de destinatário inválido citam o perfil exigido', () => {
    expect(mensagemDestinatarioInvalido(1, 'TUTOR')).toBe(
      'No encaminhamento 1, o usuário destinatário precisa ter perfil Tutor e status ativo.',
    );
    expect(mensagemDestinatarioInvalido(1, 'EQUIPE_PEDAGOGICA')).toContain('Pedagógico');
    expect(mensagemDestinatarioInvalido(1, 'GESTAO')).toContain('Gestão');
  });

  it('observacao do encaminhamento que não é texto ou é longa demais responde 400', async () => {
    let res = await postOcorrencia(corpoValido({ encaminhamentos: [{ destinatarioPerfil: 'GESTAO', observacao: 5 }] }));
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ erro: mensagemTextoInvalido('observacao do encaminhamento 1') });
    res = await postOcorrencia(
      corpoValido({ encaminhamentos: [{ destinatarioPerfil: 'GESTAO', observacao: 'x'.repeat(TAMANHO_MAXIMO_TEXTO_LONGO + 1) }] }),
    );
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ erro: mensagemTextoLongo('observacao do encaminhamento 1') });
  });
});

// ---------------------------------------------------------------------------
// Decisões do Rafael: quantidades máximas e encaminhamentos repetidos
// ---------------------------------------------------------------------------
describe('POST /ocorrencias — limites de quantidade e encaminhamentos repetidos (400)', () => {
  /** Acrescenta estudantes fictícios até o id informado (metade em cada turma). */
  function criarEstudantesAte(ultimoId) {
    for (let id = banco.estudantes.length + 1; id <= ultimoId; id += 1) {
      banco.estudantes.push({ id, nome_completo: `Estudante Fictício ${id}`, codigo_escolar: null, turma_id: (id % 2) + 1, tutor_id: null });
    }
  }

  /** 10 encaminhamentos distintos: GESTAO/EQUIPE sem usuário e com usuário, e 6 tutores fictícios ativos. */
  function encaminhamentosDistintos(quantidade) {
    for (let id = 20; id < 30; id += 1) {
      banco.usuarios.push({ id, nome: `Tutor Fictício ${id}`, email: `tutor${id}@sisto.exemplo`, perfil: 'TUTOR', status: 'ATIVO', troca_senha_obrigatoria: false, senha_alterada_em: null });
    }
    const lista = [
      { destinatarioPerfil: 'GESTAO' },
      { destinatarioPerfil: 'GESTAO', destinatarioUsuarioId: ID_GESTAO },
      { destinatarioPerfil: 'EQUIPE_PEDAGOGICA' },
      { destinatarioPerfil: 'EQUIPE_PEDAGOGICA', destinatarioUsuarioId: ID_PEDAGOGICO },
      ...Array.from({ length: 8 }, (_, i) => ({ destinatarioPerfil: 'TUTOR', destinatarioUsuarioId: 20 + i })),
    ];
    return lista.slice(0, quantidade);
  }

  it('os limites são 50 estudantes e 10 encaminhamentos', () => {
    expect(MAXIMO_ESTUDANTES).toBe(50);
    expect(MAXIMO_ENCAMINHAMENTOS).toBe(10);
  });

  it('50 estudantes distintos: 201 e 50 linhas na associativa', async () => {
    criarEstudantesAte(60);
    const res = await postOcorrencia(corpoValido({ estudanteIds: Array.from({ length: 50 }, (_, i) => i + 1) }));
    expect(res.status).toBe(201);
    expect(banco.ocorrenciasEstudantes).toHaveLength(50);
  });

  it('51 estudantes distintos: 400 sem consultar o banco', async () => {
    criarEstudantesAte(60);
    const res = await postOcorrencia(corpoValido({ estudanteIds: Array.from({ length: 51 }, (_, i) => i + 1) }));
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ erro: MENSAGEM_ESTUDANTES_EXCEDIDOS });
    expect(mocks.$transaction).not.toHaveBeenCalled();
    esperarBancoVazio();
  });

  it('50 distintos com repetidos (60 itens na lista) contam como 50: 201', async () => {
    criarEstudantesAte(60);
    const ids = [...Array.from({ length: 50 }, (_, i) => i + 1), ...Array.from({ length: 10 }, (_, i) => i + 1)];
    const res = await postOcorrencia(corpoValido({ estudanteIds: ids }));
    expect(res.status).toBe(201);
    expect(banco.ocorrenciasEstudantes).toHaveLength(50);
  });

  it('51 ids inexistentes: o limite é checado antes do banco (400 de quantidade)', async () => {
    const res = await postOcorrencia(corpoValido({ estudanteIds: Array.from({ length: 51 }, (_, i) => 1000 + i) }));
    expect(res.body).toEqual({ erro: MENSAGEM_ESTUDANTES_EXCEDIDOS });
    expect(mocks.$transaction).not.toHaveBeenCalled();
  });

  it('10 encaminhamentos distintos: 201', async () => {
    const res = await postOcorrencia(corpoValido({ encaminhamentos: encaminhamentosDistintos(10) }));
    expect(res.status).toBe(201);
    expect(banco.encaminhamentos).toHaveLength(10);
    expect(banco.historicos).toHaveLength(11);
  });

  it('11 encaminhamentos: 400 sem consultar o banco', async () => {
    const res = await postOcorrencia(
      corpoValido({ encaminhamentos: [...encaminhamentosDistintos(10), { destinatarioPerfil: 'TUTOR', destinatarioUsuarioId: 28 }] }),
    );
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ erro: MENSAGEM_ENCAMINHAMENTOS_EXCEDIDOS });
    expect(mocks.$transaction).not.toHaveBeenCalled();
    esperarBancoVazio();
  });

  it.each([
    ['dois GESTAO sem usuário', [{ destinatarioPerfil: 'GESTAO' }, { destinatarioPerfil: 'GESTAO', destinatarioUsuarioId: null }], 1, 2],
    ['dois EQUIPE_PEDAGOGICA sem usuário', [{ destinatarioPerfil: 'EQUIPE_PEDAGOGICA' }, { destinatarioPerfil: 'GESTAO' }, { destinatarioPerfil: 'EQUIPE_PEDAGOGICA' }], 1, 3],
    ['o mesmo tutor duas vezes', [{ destinatarioPerfil: 'GESTAO' }, { destinatarioPerfil: 'TUTOR', destinatarioUsuarioId: ID_TUTOR }, { destinatarioPerfil: 'TUTOR', destinatarioUsuarioId: ID_TUTOR, observacao: 'outra observação' }], 2, 3],
    ['a mesma Gestão duas vezes', [{ destinatarioPerfil: 'GESTAO', destinatarioUsuarioId: ID_GESTAO }, { destinatarioPerfil: 'GESTAO', destinatarioUsuarioId: ID_GESTAO }], 1, 2],
  ])('%s: 400 citando as posições, sem ids nem nomes', async (_caso, encaminhamentos, primeira, repetida) => {
    const res = await postOcorrencia(corpoValido({ encaminhamentos }));
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ erro: mensagemEncaminhamentoRepetido(primeira, repetida) });
    expect(res.body.erro).not.toMatch(/Fictício|@|sisto|TUTOR|GESTAO|EQUIPE/);
    expect(mocks.$transaction).not.toHaveBeenCalled();
    esperarBancoVazio();
  });

  it('texto exato da mensagem de repetido', () => {
    expect(mensagemEncaminhamentoRepetido(1, 3)).toBe('Os encaminhamentos 1 e 3 têm o mesmo destinatário. Remova o repetido.');
  });

  it.each([
    ['tutores diferentes', [{ destinatarioPerfil: 'TUTOR', destinatarioUsuarioId: ID_TUTOR }, { destinatarioPerfil: 'TUTOR', destinatarioUsuarioId: 20 }]],
    ['GESTAO sem usuário e GESTAO com usuário', [{ destinatarioPerfil: 'GESTAO' }, { destinatarioPerfil: 'GESTAO', destinatarioUsuarioId: ID_GESTAO }]],
    ['GESTAO e EQUIPE_PEDAGOGICA sem usuário', [{ destinatarioPerfil: 'GESTAO' }, { destinatarioPerfil: 'EQUIPE_PEDAGOGICA' }]],
  ])('não são repetidos: %s (201)', async (_caso, encaminhamentos) => {
    encaminhamentosDistintos(0); // cria os tutores fictícios 20..29
    const res = await postOcorrencia(corpoValido({ encaminhamentos }));
    expect(res.status).toBe(201);
    expect(banco.encaminhamentos).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Transação (tudo ou nada) e concorrência
// ---------------------------------------------------------------------------
describe('POST /ocorrencias — transação única', () => {
  it('usa uma transação SERIALIZABLE', async () => {
    await postOcorrencia(corpoValido());
    expect(mocks.$transaction).toHaveBeenCalledTimes(1);
    expect(mocks.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: 'Serializable' });
  });

  it.each([
    'ocorrenciaEstudante.createMany',
    'encaminhamento.create',
    'historicoOcorrencia.createMany',
    'logAuditoria.create',
  ])('falha em %s não deixa registro parcial (500 genérico)', async (operacao) => {
    mocks.falharEm = operacao;
    const res = await postOcorrencia(
      corpoValido({
        estudanteIds: [1, 2],
        encaminhamentos: [{ destinatarioPerfil: 'TUTOR', destinatarioUsuarioId: ID_TUTOR }, { destinatarioPerfil: 'GESTAO' }],
      }),
    );
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ erro: 'Erro interno do servidor' });
    esperarBancoVazio();
  });

  it('falha no segundo encaminhamento desfaz o primeiro e a ocorrência', async () => {
    let chamadas = 0;
    const db = {
      $transaction: async (operacao) => {
        const copia = structuredClone(banco);
        const tx = clientMock();
        const original = tx.encaminhamento.create;
        tx.encaminhamento.create = async (args) => {
          chamadas += 1;
          if (chamadas === 2) throw new Error('falha fictícia no 2º encaminhamento');
          return original(args);
        };
        try {
          return await operacao(tx);
        } catch (erro) {
          banco = copia;
          throw erro;
        }
      },
    };
    await expect(
      registrarOcorrencia(
        corpoValido({ encaminhamentos: [{ destinatarioPerfil: 'GESTAO' }, { destinatarioPerfil: 'EQUIPE_PEDAGOGICA' }] }),
        { id: ID_PROFESSOR },
        { db },
      ),
    ).rejects.toThrow('falha fictícia');
    expect(chamadas).toBe(2);
    esperarBancoVazio();
  });

  it('P2034 seguido de sucesso responde 201 (transação repetida)', async () => {
    mocks.$transaction.mockRejectedValueOnce(erroPrisma('P2034'));
    const res = await postOcorrencia(corpoValido());
    expect(res.status).toBe(201);
    expect(mocks.$transaction).toHaveBeenCalledTimes(2);
    expect(banco.ocorrencias).toHaveLength(1);
  });

  it('P2034 e, na repetição, o tutor já foi bloqueado: responde 400 sem gravar', async () => {
    mocks.$transaction.mockImplementationOnce(async () => {
      usuarioPorId(ID_TUTOR).status = 'BLOQUEADO';
      throw erroPrisma('P2034');
    });
    const res = await postOcorrencia(corpoValido());
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ erro: mensagemDestinatarioInvalido(1, 'TUTOR') });
    esperarBancoVazio();
  });

  it('esgotadas as tentativas, responde 409 pedindo para tentar de novo', async () => {
    mocks.$transaction.mockRejectedValue(erroPrisma('P2034'));
    const res = await postOcorrencia(corpoValido());
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ erro: MENSAGEM_CONFLITO_CONCORRENTE_OCORRENCIA });
    expect(mocks.$transaction).toHaveBeenCalledTimes(3);
  });

  it('o service aceita db e relógio injetados', async () => {
    const db = { $transaction: async (op) => op(clientMock()) };
    const ocorrencia = await registrarOcorrencia(
      corpoValido({ dataHora: '2026-10-26T12:04:59Z' }),
      { id: ID_GESTAO },
      { db, agora: () => new Date('2026-10-26T12:00:00Z') },
    );
    expect(ocorrencia).toMatchObject({ id: 1, status: 'ABERTO', profissionalResponsavel: { id: ID_GESTAO } });
  });
});

// ---------------------------------------------------------------------------
// Schema (migration da Issue #45)
// ---------------------------------------------------------------------------
describe('schema.prisma — data/hora preenchida pelo sistema (RN17)', () => {
  const schema = readFileSync(fileURLToPath(new URL('../prisma/schema.prisma', import.meta.url)), 'utf8');
  const blocoModel = (nome) => new RegExp(`model ${nome} \\{([\\s\\S]*?)\\n\\}`).exec(schema)[1];
  const linhaDataHora = (nome) => blocoModel(nome).split(/\r?\n/).find((l) => /^\s*data_hora\s/.test(l));

  it('Encaminhamento.data_hora e Providencia.data_hora têm @default(now())', () => {
    expect(linhaDataHora('Encaminhamento')).toContain('@default(now())');
    expect(linhaDataHora('Providencia')).toContain('@default(now())');
  });

  it('Ocorrencia.data_hora continua sem valor padrão (informada pelo usuário)', () => {
    expect(linhaDataHora('Ocorrencia')).not.toContain('@default');
  });

  it('a migration só define os valores padrão, sem apagar dados', () => {
    const sql = readFileSync(
      fileURLToPath(
        new URL('../prisma/migrations/20261026103707_default_data_hora_encaminhamento_providencia/migration.sql', import.meta.url),
      ),
      'utf8',
    );
    expect(sql).toContain('ALTER TABLE "encaminhamentos" ALTER COLUMN "data_hora" SET DEFAULT CURRENT_TIMESTAMP');
    expect(sql).toContain('ALTER TABLE "providencias" ALTER COLUMN "data_hora" SET DEFAULT CURRENT_TIMESTAMP');
    expect(sql).not.toMatch(/DROP|DELETE|TRUNCATE/i);
  });
});
