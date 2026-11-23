// Testes de GET /ocorrencias e GET /ocorrencias/{id} (Issue #47, RN19, RN20,
// RN17) — somente dados fictícios (RN05).
// Não dependem do banco: src/lib/prisma.js é substituído por um "banco" em
// memória que AVALIA o `where` gerado pelo service (AND, OR, igualdade, `in`,
// `some` em listas e filtro em relação 1:1). Assim, a matriz de visibilidade
// testa o filtro real de filtroVisibilidadeOcorrencias, e não um atalho do
// mock. Operadores não previstos fazem o mock falhar (em vez de ignorar).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { CODIGOS_ERRO } from '../src/lib/erros.js';
import { criarBancoEmMemoria } from './apoio/bancoEmMemoria.js';

const mocks = vi.hoisted(() => ({
  $transaction: vi.fn(),
}));

let banco;
/** Consultas feitas DENTRO da transação ("modelo.operacao"), em ordem. */
let consultasTx;

// ---------------------------------------------------------------------------
// "Banco" em memória com avaliação de where/select/orderBy
// ---------------------------------------------------------------------------

const DEFAULTS = {
  ocorrencia: () => ({ responsavel_acompanhamento_id: null, data_encerramento: null }),
  encaminhamento: () => ({ data_hora: new Date(), observacao: null, destinatario_usuario_id: null }),
  historicoOcorrencia: () => ({ descricao: null, data_hora: new Date() }),
  logAuditoria: () => ({ data_hora: new Date() }),
};

// Motor do "banco" em memória: tests/apoio/bancoEmMemoria.js (Issue #129).
// Dentro da transação (clientMock(true)), cada operação é registrada em
// consultasTx ("modelo.operacao"), em ordem.
const { clientMock } = criarBancoEmMemoria({
  obterBanco: () => banco,
  padroes: DEFAULTS,
  limiteRelacoes: 2,
  aoOperar: (modelo, operacao, _args, emTransacao) => {
    if (emTransacao) consultasTx.push(`${modelo}.${operacao}`);
  },
});

vi.mock('../src/lib/prisma.js', () => ({
  default: new Proxy(
    {},
    {
      get(_alvo, prop) {
        if (prop === '$transaction') return (...a) => mocks.$transaction(...a);
        return clientMock(false)[prop];
      },
    },
  ),
}));

const { default: app } = await import('../src/app.js');
const { MENSAGEM_TROCA_SENHA_OBRIGATORIA } = await import('../src/middlewares/autenticacao.js');
const { MENSAGEM_NAO_AUTENTICADO } = await import('../src/services/sessao.js');
const { paraRespostaTurma } = await import('../src/services/turmas.js');
const {
  MENSAGEM_ID_OCORRENCIA_INVALIDO,
  MENSAGEM_OCORRENCIA_NAO_ENCONTRADA,
  PERFIS_VISIBILIDADE_TOTAL,
  filtroVisibilidadeOcorrencias,
  validarIdOcorrencia,
} = await import('../src/services/ocorrencias.js');

// ---------------------------------------------------------------------------
// Cenário fictício
// ---------------------------------------------------------------------------

const SEGREDO_TESTE = 'segredo-ficticio-de-teste-com-mais-de-32-caracteres';
const ID_PROFESSOR = 1;
const ID_TUTOR = 2;
const ID_GESTAO = 3;
const ID_PEDAGOGICO = 4;
const ID_TECNICO = 5;
const ID_TROCA_PENDENTE = 6;
const ID_TUTOR_NOVO = 7; // tutor atual do estudante que trocou de tutor
const ID_OUTRO_PROFESSOR = 8; // registra as ocorrências "de outro"

const ID_ESTUDANTE_TUTORADO = 1; // tutor atual: ID_TUTOR
const ID_ESTUDANTE_SEM_TUTOR = 2;
const ID_ESTUDANTE_EX_TUTORADO = 3; // era de ID_TUTOR; hoje é de ID_TUTOR_NOVO
const ID_ESTUDANTE_OUTRO = 4;

// Ocorrências (ver montarBanco): O1 registrada pelo professor; O2 de outro,
// sem vínculo; O3 encaminhada ao tutor; O4 acompanhada pelo tutor; O5 com
// tutorado atual do tutor (ocorrência "rica" do detalhe); O6 com o estudante
// que já foi tutorado dele; O7 registrada pelo tutor; O8 registrada pelo
// técnico-administrativo.
const TODAS = [7, 5, 2, 4, 3, 8, 1, 6]; // data desc; O3 e O4 empatam -> id desc

const ESPERADO_POR_USUARIO = {
  [ID_PROFESSOR]: [1],
  [ID_TUTOR]: [7, 5, 4, 3],
  [ID_GESTAO]: TODAS,
  [ID_PEDAGOGICO]: TODAS,
  [ID_TECNICO]: [8],
};
const ROTULO = {
  [ID_PROFESSOR]: 'PROFESSOR',
  [ID_TUTOR]: 'TUTOR',
  [ID_GESTAO]: 'GESTAO',
  [ID_PEDAGOGICO]: 'PEDAGOGICO',
  [ID_TECNICO]: 'TECNICO_ADMINISTRATIVO',
};

const data = (iso) => new Date(iso);

function montarBanco() {
  const usuario = (id, perfil, extra = {}) => ({
    id,
    nome: `Usuário Fictício ${id}`,
    email: `usuario${id}@sisto.exemplo`,
    senha_hash: 'hash-ficticio',
    perfil,
    status: 'ATIVO',
    troca_senha_obrigatoria: false,
    senha_alterada_em: null,
    ...extra,
  });
  const ocorrencia = (id, iso, profissional, extra = {}) => ({
    id,
    data_hora: data(iso),
    local: `Local fictício ${id}`,
    turma_id: 1,
    categoria_id: 1,
    descricao: `Descrição fictícia ${id}.`,
    demais_envolvidos: null,
    testemunhas: null,
    providencias_imediatas: null,
    observacoes: null,
    profissional_responsavel_id: profissional,
    responsavel_acompanhamento_id: null,
    status: 'ABERTO',
    data_encerramento: null,
    ...extra,
  });
  const encaminhamento = (id, ocorrenciaId, perfil, usuarioId, extra = {}) => ({
    id,
    ocorrencia_id: ocorrenciaId,
    destinatario_perfil: perfil,
    destinatario_usuario_id: usuarioId,
    registrado_por_id: ID_OUTRO_PROFESSOR,
    data_hora: data('2026-10-11T10:00:00.000Z'),
    observacao: null,
    ...extra,
  });

  return {
    usuarios: [
      usuario(ID_PROFESSOR, 'PROFESSOR'),
      usuario(ID_TUTOR, 'TUTOR'),
      usuario(ID_GESTAO, 'GESTAO'),
      usuario(ID_PEDAGOGICO, 'PEDAGOGICO'),
      usuario(ID_TECNICO, 'TECNICO_ADMINISTRATIVO'),
      usuario(ID_TROCA_PENDENTE, 'GESTAO', { troca_senha_obrigatoria: true }),
      usuario(ID_TUTOR_NOVO, 'TUTOR'),
      usuario(ID_OUTRO_PROFESSOR, 'PROFESSOR'),
    ],
    turmas: [
      { id: 1, nome: '6º A', etapa: 'Ensino Fundamental', ano_letivo: 2026 },
      { id: 2, nome: '1º A', etapa: 'Ensino Médio', ano_letivo: 2026 },
    ],
    categorias: [
      { id: 1, nome: 'Indisciplina', descricao: 'Descrição fictícia da categoria.' },
      { id: 2, nome: 'Conflitos', descricao: null },
    ],
    estudantes: [
      { id: ID_ESTUDANTE_TUTORADO, nome_completo: 'Estudante Fictício Beta', codigo_escolar: 'TESTE-0001', turma_id: 1, tutor_id: ID_TUTOR },
      { id: ID_ESTUDANTE_SEM_TUTOR, nome_completo: 'Estudante Fictício Alfa', codigo_escolar: 'TESTE-0002', turma_id: 2, tutor_id: null },
      { id: ID_ESTUDANTE_EX_TUTORADO, nome_completo: 'Estudante Fictício Gama', codigo_escolar: null, turma_id: 1, tutor_id: ID_TUTOR_NOVO },
      { id: ID_ESTUDANTE_OUTRO, nome_completo: 'Estudante Fictício Delta', codigo_escolar: 'TESTE-0004', turma_id: 2, tutor_id: null },
    ],
    ocorrencias: [
      ocorrencia(1, '2026-10-01T10:00:00.000Z', ID_PROFESSOR),
      ocorrencia(2, '2026-10-05T10:00:00.000Z', ID_OUTRO_PROFESSOR),
      ocorrencia(3, '2026-10-03T10:00:00.000Z', ID_OUTRO_PROFESSOR),
      ocorrencia(4, '2026-10-03T10:00:00.000Z', ID_OUTRO_PROFESSOR, {
        responsavel_acompanhamento_id: ID_TUTOR,
        status: 'EM_ACOMPANHAMENTO',
      }),
      ocorrencia(5, '2026-10-08T12:00:00.000Z', ID_OUTRO_PROFESSOR, {
        turma_id: 1,
        categoria_id: 2,
        demais_envolvidos: 'Envolvidos fictícios.',
        testemunhas: 'Testemunhas fictícias.',
        providencias_imediatas: 'Providência imediata fictícia.',
        observacoes: 'Observação fictícia.',
        responsavel_acompanhamento_id: ID_PEDAGOGICO,
        status: 'EM_ACOMPANHAMENTO',
      }),
      ocorrencia(6, '2026-09-20T08:00:00.000Z', ID_OUTRO_PROFESSOR),
      ocorrencia(7, '2026-10-10T09:30:00.000Z', ID_TUTOR),
      ocorrencia(8, '2026-10-02T15:00:00.000Z', ID_TECNICO),
    ],
    ocorrenciasEstudantes: [
      { ocorrencia_id: 1, estudante_id: ID_ESTUDANTE_SEM_TUTOR },
      { ocorrencia_id: 2, estudante_id: ID_ESTUDANTE_OUTRO },
      { ocorrencia_id: 3, estudante_id: ID_ESTUDANTE_OUTRO },
      { ocorrencia_id: 4, estudante_id: ID_ESTUDANTE_OUTRO },
      { ocorrencia_id: 5, estudante_id: ID_ESTUDANTE_TUTORADO },
      { ocorrencia_id: 5, estudante_id: ID_ESTUDANTE_SEM_TUTOR },
      { ocorrencia_id: 6, estudante_id: ID_ESTUDANTE_EX_TUTORADO },
      { ocorrencia_id: 7, estudante_id: ID_ESTUDANTE_OUTRO },
      { ocorrencia_id: 8, estudante_id: ID_ESTUDANTE_OUTRO },
    ],
    encaminhamentos: [
      encaminhamento(1, 2, 'GESTAO', null),
      encaminhamento(2, 3, 'TUTOR', ID_TUTOR),
      encaminhamento(3, 4, 'GESTAO', ID_GESTAO),
      encaminhamento(4, 5, 'EQUIPE_PEDAGOGICA', ID_PEDAGOGICO, { observacao: 'Observação fictícia do encaminhamento.' }),
      encaminhamento(5, 5, 'GESTAO', null),
      encaminhamento(6, 6, 'GESTAO', null),
    ],
    comunicacoes: [
      // Fora de ordem de propósito; 2 e 3 empatam na data (desempate por id).
      { id: 3, ocorrencia_id: 5, destinatario: 'Família fictícia', meio: 'Telefone', descricao: 'Contato fictício 3.', registrado_por_id: ID_GESTAO, data_hora: data('2026-10-09T14:00:00.000Z') },
      { id: 1, ocorrencia_id: 5, destinatario: 'Família fictícia', meio: 'Presencial', descricao: 'Contato fictício 1.', registrado_por_id: ID_PEDAGOGICO, data_hora: data('2026-10-09T15:00:00.000Z') },
      { id: 2, ocorrencia_id: 5, destinatario: 'Rede de proteção fictícia', meio: 'E-mail', descricao: 'Contato fictício 2.', registrado_por_id: ID_GESTAO, data_hora: data('2026-10-09T14:00:00.000Z') },
      { id: 4, ocorrencia_id: 1, destinatario: 'Família fictícia', meio: 'Telefone', descricao: 'Outra ocorrência.', registrado_por_id: ID_GESTAO, data_hora: data('2026-10-02T10:00:00.000Z') },
    ],
    providencias: [
      { id: 2, ocorrencia_id: 5, descricao: 'Providência fictícia 2.', registrado_por_id: ID_PEDAGOGICO, data_hora: data('2026-10-12T09:00:00.000Z') },
      { id: 1, ocorrencia_id: 5, descricao: 'Providência fictícia 1.', registrado_por_id: ID_GESTAO, data_hora: data('2026-10-11T09:00:00.000Z') },
    ],
    historicos: [],
    logs: [],
  };
}

beforeEach(() => {
  process.env.JWT_SECRET = SEGREDO_TESTE;
  banco = montarBanco();
  consultasTx = [];
  mocks.$transaction.mockReset();
  mocks.$transaction.mockImplementation(async (operacao) => {
    const copia = structuredClone(banco);
    try {
      return await operacao(clientMock(true));
    } catch (erro) {
      banco = copia; // rollback
      throw erro;
    }
  });
});

afterEach(() => {
  delete process.env.JWT_SECRET;
  vi.useRealTimers();
});

function token(id) {
  const u = banco.usuarios.find((x) => x.id === id);
  return jwt.sign({ id, perfil: u.perfil }, SEGREDO_TESTE, { algorithm: 'HS256', expiresIn: '8h' });
}

const getLista = (usuarioId) => {
  const req = request(app).get('/ocorrencias');
  return usuarioId ? req.set('Authorization', `Bearer ${token(usuarioId)}`) : req;
};
const getDetalhe = (id, usuarioId) => {
  const req = request(app).get(`/ocorrencias/${id}`);
  return usuarioId ? req.set('Authorization', `Bearer ${token(usuarioId)}`) : req;
};

/** Caminhos de chaves de e-mail/senha/status de usuário em qualquer nível (só o status da ocorrência é permitido). */
function chavesSensiveis(valor, caminho = '', raiz = true) {
  if (Array.isArray(valor)) return valor.flatMap((v, i) => chavesSensiveis(v, `${caminho}[${i}]`, false));
  if (!valor || typeof valor !== 'object') return [];
  return Object.entries(valor).flatMap(([chave, v]) => {
    const aqui = `${caminho}.${chave}`;
    const proibida =
      ['email', 'senha_hash', 'senhaHash', 'trocaSenhaObrigatoria', 'troca_senha_obrigatoria'].includes(chave) ||
      (chave === 'status' && !raiz);
    return [...(proibida ? [aqui] : []), ...chavesSensiveis(v, aqui, false)];
  });
}

// ---------------------------------------------------------------------------
// Função única de visibilidade (RN19)
// ---------------------------------------------------------------------------
describe('filtroVisibilidadeOcorrencias (RN19)', () => {
  it('GESTAO e PEDAGOGICO veem todas (filtro vazio)', () => {
    expect(PERFIS_VISIBILIDADE_TOTAL).toEqual(['GESTAO', 'PEDAGOGICO']);
    expect(filtroVisibilidadeOcorrencias({ id: 3, perfil: 'GESTAO' })).toEqual({});
    expect(filtroVisibilidadeOcorrencias({ id: 4, perfil: 'PEDAGOGICO' })).toEqual({});
  });

  it('PROFESSOR e TECNICO_ADMINISTRATIVO: registrou OU destinatário de encaminhamento (mesma condição, sem tratamento especial)', () => {
    for (const perfil of ['PROFESSOR', 'TECNICO_ADMINISTRATIVO']) {
      expect(filtroVisibilidadeOcorrencias({ id: 9, perfil })).toEqual({
        OR: [
          { profissional_responsavel_id: 9 },
          { encaminhamentos: { some: { destinatario_usuario_id: 9 } } },
        ],
      });
    }
  });

  it('TUTOR: além disso, acompanha OU envolve estudante com tutor_id ATUAL igual ao dele', () => {
    expect(filtroVisibilidadeOcorrencias({ id: 2, perfil: 'TUTOR' })).toEqual({
      OR: [
        { profissional_responsavel_id: 2 },
        { encaminhamentos: { some: { destinatario_usuario_id: 2 } } },
        { responsavel_acompanhamento_id: 2 },
        { estudantes: { some: { estudante: { tutor_id: 2 } } } },
      ],
    });
  });

  it('perfil desconhecido cai na condição restrita (nunca em "todas")', () => {
    expect(filtroVisibilidadeOcorrencias({ id: 9, perfil: 'OUTRO' })).toHaveProperty('OR');
  });

  it('sem usuário válido falha fechada (erro de programação)', () => {
    for (const usuario of [undefined, null, {}, { id: 0, perfil: 'GESTAO' }, { id: '3', perfil: 'GESTAO' }]) {
      expect(() => filtroVisibilidadeOcorrencias(usuario)).toThrow();
    }
  });
});

describe('validarIdOcorrencia', () => {
  it('aceita inteiros positivos até o maior Int do PostgreSQL', () => {
    expect(validarIdOcorrencia('1')).toBe(1);
    expect(validarIdOcorrencia('2147483647')).toBe(2147483647);
  });
  it('recusa formatos inválidos com 400 e mensagem fixa', () => {
    for (const valor of ['abc', '0', '1.5', '-1', '01', '1e3', ' 1', '', '2147483648', '99999999999', undefined, 5]) {
      expect(() => validarIdOcorrencia(valor)).toThrow(
        expect.objectContaining({ status: 400, message: MENSAGEM_ID_OCORRENCIA_INVALIDO }),
      );
    }
  });
});

// ---------------------------------------------------------------------------
// Matriz de visibilidade pela API
// ---------------------------------------------------------------------------
describe('Matriz de visibilidade por perfil (RN19)', () => {
  for (const [usuarioId, esperado] of Object.entries(ESPERADO_POR_USUARIO)) {
    const id = Number(usuarioId);

    it(`${ROTULO[id]}: GET /ocorrencias devolve exatamente ${esperado.join(', ')}`, async () => {
      const res = await getLista(id);
      expect(res.status).toBe(200);
      expect(res.body.itens.map((o) => o.id)).toEqual(esperado);
    });

    it(`${ROTULO[id]}: GET /ocorrencias/{id} responde 200 nas visíveis e 404 nas demais`, async () => {
      for (let ocorrenciaId = 1; ocorrenciaId <= 8; ocorrenciaId += 1) {
        const res = await getDetalhe(ocorrenciaId, id);
        if (esperado.includes(ocorrenciaId)) {
          expect(res.status, `ocorrência ${ocorrenciaId}`).toBe(200);
          expect(res.body.id).toBe(ocorrenciaId);
        } else {
          expect(res.status, `ocorrência ${ocorrenciaId}`).toBe(404);
          expect(res.body).toEqual({ erro: MENSAGEM_OCORRENCIA_NAO_ENCONTRADA });
        }
      }
    });
  }

  it('TUTOR não vê a ocorrência do estudante que já foi tutorado dele (vínculo atual — decisão do Rafael)', async () => {
    expect((await getDetalhe(6, ID_TUTOR)).status).toBe(404);
  });

  it('o tutor ATUAL desse estudante vê a ocorrência, inclusive anterior à troca', async () => {
    const res = await getLista(ID_TUTOR_NOVO);
    expect(res.body.itens.map((o) => o.id)).toEqual([6]);
    expect((await getDetalhe(6, ID_TUTOR_NOVO)).status).toBe(200);
  });

  it('trocar o tutor do estudante muda a visibilidade na consulta seguinte', async () => {
    // O5 é visível ao tutor apenas pelo tutorado (não registrou, não recebeu nem acompanha).
    banco.estudantes.find((e) => e.id === ID_ESTUDANTE_TUTORADO).tutor_id = ID_TUTOR_NOVO;
    expect((await getLista(ID_TUTOR)).body.itens.map((o) => o.id)).toEqual([7, 4, 3]);
    expect((await getDetalhe(5, ID_TUTOR)).status).toBe(404);
    expect((await getLista(ID_TUTOR_NOVO)).body.itens.map((o) => o.id)).toEqual([5, 6]);
    expect((await getDetalhe(5, ID_TUTOR_NOVO)).status).toBe(200);
  });

  it('estudante desvinculado (tutor_id null) tira a ocorrência da visão do ex-tutor', async () => {
    banco.estudantes.find((e) => e.id === ID_ESTUDANTE_TUTORADO).tutor_id = null;
    expect((await getLista(ID_TUTOR)).body.itens.map((o) => o.id)).toEqual([7, 4, 3]);
  });

  it('ex-tutor que ainda acompanha a ocorrência continua vendo (outra condição da RN19)', async () => {
    banco.estudantes.find((e) => e.id === ID_ESTUDANTE_TUTORADO).tutor_id = ID_TUTOR_NOVO;
    banco.ocorrencias.find((o) => o.id === 5).responsavel_acompanhamento_id = ID_TUTOR;
    expect((await getDetalhe(5, ID_TUTOR)).status).toBe(200);
  });

  it('a mesma condição de destinatário vale para PROFESSOR (dado fictício fora da RN03, só para provar a regra única)', async () => {
    banco.encaminhamentos.push({
      id: 99, ocorrencia_id: 2, destinatario_perfil: 'GESTAO', destinatario_usuario_id: ID_PROFESSOR,
      registrado_por_id: ID_OUTRO_PROFESSOR, data_hora: data('2026-10-11T10:00:00.000Z'), observacao: null,
    });
    expect((await getLista(ID_PROFESSOR)).body.itens.map((o) => o.id)).toEqual([2, 1]);
  });
});

// ---------------------------------------------------------------------------
// GET /ocorrencias — formato, ordem e consultas
// ---------------------------------------------------------------------------
describe('GET /ocorrencias — lista resumida', () => {
  it('itens no formato resumido (sem descrição, textos, encaminhamentos nem comunicações)', async () => {
    const res = await getLista(ID_GESTAO);
    expect(res.status).toBe(200);
    for (const item of res.body.itens) {
      expect(Object.keys(item).sort()).toEqual(
        ['categoria', 'dataHora', 'estudantes', 'id', 'local', 'profissionalResponsavel', 'status', 'turma'].sort(),
      );
      for (const e of item.estudantes) expect(Object.keys(e).sort()).toEqual(['id', 'nomeCompleto']);
      // O status do item é o da ocorrência (permitido); nada de usuário.
      expect(chavesSensiveis(item)).toEqual([]);
    }
    expect(JSON.stringify(res.body)).not.toContain('@sisto.exemplo');
  });

  it('conteúdo de um item (O5): datas em ISO 8601 UTC, turma, categoria, profissional e estudantes por nome', async () => {
    const res = await getLista(ID_GESTAO);
    const o5 = res.body.itens.find((o) => o.id === 5);
    expect(o5).toEqual({
      id: 5,
      dataHora: '2026-10-08T12:00:00.000Z',
      local: 'Local fictício 5',
      status: 'EM_ACOMPANHAMENTO',
      turma: paraRespostaTurma(banco.turmas[0]),
      categoria: { id: 2, nome: 'Conflitos' },
      profissionalResponsavel: { id: ID_OUTRO_PROFESSOR, nome: `Usuário Fictício ${ID_OUTRO_PROFESSOR}` },
      estudantes: [
        { id: ID_ESTUDANTE_SEM_TUTOR, nomeCompleto: 'Estudante Fictício Alfa' },
        { id: ID_ESTUDANTE_TUTORADO, nomeCompleto: 'Estudante Fictício Beta' },
      ],
    });
  });

  it('não traz codigoEscolar nem para a Gestão (lista resumida)', async () => {
    const res = await getLista(ID_GESTAO);
    expect(JSON.stringify(res.body)).not.toContain('codigoEscolar');
    expect(JSON.stringify(res.body)).not.toContain('TESTE-000');
  });

  it('ordena por data/hora desc e desempata por id desc', async () => {
    const res = await getLista(ID_GESTAO);
    expect(res.body.itens.map((o) => o.id)).toEqual(TODAS);
    const datas = res.body.itens.map((o) => Date.parse(o.dataHora));
    expect([...datas].sort((a, b) => b - a)).toEqual(datas);
  });

  it('estudantes com o mesmo nome são desempatados por id', async () => {
    banco.estudantes.find((e) => e.id === ID_ESTUDANTE_TUTORADO).nome_completo = 'Estudante Fictício Alfa';
    const o5 = (await getLista(ID_GESTAO)).body.itens.find((o) => o.id === 5);
    expect(o5.estudantes.map((e) => e.id)).toEqual([1, 2]);
  });

  it('usa 4 consultas sequenciais (contagem + página) numa transação REPEATABLE READ, qualquer que seja o número de ocorrências (sem N+1)', async () => {
    await getLista(ID_GESTAO);
    expect(consultasTx).toEqual([
      'ocorrencia.count',
      'ocorrencia.findMany',
      'usuario.findMany',
      'ocorrenciaEstudante.findMany',
    ]);
    expect(mocks.$transaction).toHaveBeenCalledTimes(1);
    expect(mocks.$transaction.mock.calls[0][1]).toEqual({ isolationLevel: 'RepeatableRead' });
  });

  it('sem ocorrências visíveis devolve página vazia com uma só consulta (a contagem)', async () => {
    banco.ocorrencias = [];
    banco.ocorrenciasEstudantes = [];
    const res = await getLista(ID_GESTAO);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ itens: [], total: 0, pagina: 1, tamanhoPagina: 20 });
    expect(consultasTx).toEqual(['ocorrencia.count']);
  });

  it('sem query string: página 1 com o total visível (Issue #86 — novo contrato)', async () => {
    const res = await getLista(ID_TUTOR);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ total: 4, pagina: 1, tamanhoPagina: 20 });
    expect(Object.keys(res.body).sort()).toEqual(['itens', 'pagina', 'tamanhoPagina', 'total']);
  });

  it('filtros não ampliam a visibilidade (Issue #86): o Tutor filtrando por turma e status só vê as dele', async () => {
    const res = await request(app)
      .get('/ocorrencias?turmaId=1&status=EM_ACOMPANHAMENTO')
      .set('Authorization', `Bearer ${token(ID_TUTOR)}`);
    expect(res.status).toBe(200);
    expect(res.body.itens.map((o) => o.id)).toEqual([5, 4]);
    expect(res.body.total).toBe(2);
  });

  it('não grava histórico nem auditoria', async () => {
    await getLista(ID_GESTAO);
    expect(banco.historicos).toEqual([]);
    expect(banco.logs).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// GET /ocorrencias/{id} — detalhe
// ---------------------------------------------------------------------------
describe('GET /ocorrencias/{id} — detalhe', () => {
  const turma1 = () => paraRespostaTurma(banco.turmas[0]);
  const turma2 = () => paraRespostaTurma(banco.turmas[1]);
  const usuarioResumo = (id) => ({ id, nome: `Usuário Fictício ${id}` });

  function detalheEsperadoO5({ comCodigo }) {
    const codigo = (valor) => (comCodigo ? { codigoEscolar: valor } : {});
    return {
      id: 5,
      dataHora: '2026-10-08T12:00:00.000Z',
      local: 'Local fictício 5',
      turma: turma1(),
      categoria: { id: 2, nome: 'Conflitos' },
      descricao: 'Descrição fictícia 5.',
      demaisEnvolvidos: 'Envolvidos fictícios.',
      testemunhas: 'Testemunhas fictícias.',
      providenciasImediatas: 'Providência imediata fictícia.',
      observacoes: 'Observação fictícia.',
      status: 'EM_ACOMPANHAMENTO',
      dataEncerramento: null,
      profissionalResponsavel: usuarioResumo(ID_OUTRO_PROFESSOR),
      responsavelAcompanhamento: usuarioResumo(ID_PEDAGOGICO),
      estudantes: [
        { id: ID_ESTUDANTE_SEM_TUTOR, nomeCompleto: 'Estudante Fictício Alfa', turma: turma2(), ...codigo('TESTE-0002') },
        { id: ID_ESTUDANTE_TUTORADO, nomeCompleto: 'Estudante Fictício Beta', turma: turma1(), ...codigo('TESTE-0001') },
      ],
      encaminhamentos: [
        {
          id: 4,
          destinatarioPerfil: 'EQUIPE_PEDAGOGICA',
          destinatarioUsuario: { ...usuarioResumo(ID_PEDAGOGICO), perfil: 'PEDAGOGICO' },
          registradoPor: usuarioResumo(ID_OUTRO_PROFESSOR),
          dataHora: '2026-10-11T10:00:00.000Z',
          observacao: 'Observação fictícia do encaminhamento.',
        },
        {
          id: 5,
          destinatarioPerfil: 'GESTAO',
          destinatarioUsuario: null,
          registradoPor: usuarioResumo(ID_OUTRO_PROFESSOR),
          dataHora: '2026-10-11T10:00:00.000Z',
          observacao: null,
        },
      ],
      comunicacoes: [
        { id: 2, destinatario: 'Rede de proteção fictícia', meio: 'E-mail', descricao: 'Contato fictício 2.', dataHora: '2026-10-09T14:00:00.000Z', registradoPor: usuarioResumo(ID_GESTAO) },
        { id: 3, destinatario: 'Família fictícia', meio: 'Telefone', descricao: 'Contato fictício 3.', dataHora: '2026-10-09T14:00:00.000Z', registradoPor: usuarioResumo(ID_GESTAO) },
        { id: 1, destinatario: 'Família fictícia', meio: 'Presencial', descricao: 'Contato fictício 1.', dataHora: '2026-10-09T15:00:00.000Z', registradoPor: usuarioResumo(ID_PEDAGOGICO) },
      ],
      providencias: [
        { id: 1, descricao: 'Providência fictícia 1.', dataHora: '2026-10-11T09:00:00.000Z', registradoPor: usuarioResumo(ID_GESTAO) },
        { id: 2, descricao: 'Providência fictícia 2.', dataHora: '2026-10-12T09:00:00.000Z', registradoPor: usuarioResumo(ID_PEDAGOGICO) },
      ],
    };
  }

  it('GESTAO: detalhe completo com estudantes, categoria, turma, encaminhamentos, comunicações, providências e codigoEscolar', async () => {
    const res = await getDetalhe(5, ID_GESTAO);
    expect(res.status).toBe(200);
    expect(res.body).toEqual(detalheEsperadoO5({ comCodigo: true }));
  });

  it('GESTAO: codigoEscolar null aparece como null (chave presente)', async () => {
    const res = await getDetalhe(6, ID_GESTAO);
    expect(res.body.estudantes).toEqual([
      { id: ID_ESTUDANTE_EX_TUTORADO, nomeCompleto: 'Estudante Fictício Gama', turma: turma1(), codigoEscolar: null },
    ]);
  });

  for (const usuarioId of [ID_TUTOR, ID_PEDAGOGICO]) {
    it(`${ROTULO[usuarioId]}: mesmo detalhe, mas os estudantes vêm SEM a chave codigoEscolar (RN20)`, async () => {
      const res = await getDetalhe(5, usuarioId);
      expect(res.status).toBe(200);
      expect(res.body).toEqual(detalheEsperadoO5({ comCodigo: false }));
      for (const e of res.body.estudantes) expect(e).not.toHaveProperty('codigoEscolar');
    });
  }

  for (const [usuarioId, ocorrenciaId] of [
    [ID_PROFESSOR, 1],
    [ID_TUTOR, 5],
    [ID_PEDAGOGICO, 5],
    [ID_TECNICO, 8],
  ]) {
    it(`${ROTULO[usuarioId]}: nenhum codigoEscolar no corpo (ocorrência ${ocorrenciaId})`, async () => {
      const res = await getDetalhe(ocorrenciaId, usuarioId);
      expect(res.status).toBe(200);
      expect(res.body.estudantes.length).toBeGreaterThan(0);
      for (const e of res.body.estudantes) expect(Object.keys(e).sort()).toEqual(['id', 'nomeCompleto', 'turma']);
      expect(JSON.stringify(res.body)).not.toContain('codigoEscolar');
      expect(JSON.stringify(res.body)).not.toContain('TESTE-000');
    });
  }

  it('nenhum e-mail, senha ou status de usuário em lugar nenhum da resposta (todos os perfis)', async () => {
    for (const usuarioId of [ID_GESTAO, ID_PEDAGOGICO, ID_TUTOR]) {
      const res = await getDetalhe(5, usuarioId);
      expect(chavesSensiveis(res.body)).toEqual([]);
      expect(JSON.stringify(res.body)).not.toContain('@sisto.exemplo');
      expect(JSON.stringify(res.body)).not.toContain('hash-ficticio');
    }
  });

  it('ocorrência sem comunicações nem providências devolve listas vazias', async () => {
    const res = await getDetalhe(7, ID_TUTOR);
    expect(res.status).toBe(200);
    expect(res.body.comunicacoes).toEqual([]);
    expect(res.body.providencias).toEqual([]);
    expect(res.body.responsavelAcompanhamento).toBeNull();
  });

  it('comunicações de outra ocorrência não aparecem', async () => {
    const res = await getDetalhe(1, ID_PROFESSOR);
    expect(res.body.comunicacoes.map((c) => c.id)).toEqual([4]);
    expect((await getDetalhe(5, ID_GESTAO)).body.comunicacoes.map((c) => c.id)).toEqual([2, 3, 1]);
  });

  it('confere a visibilidade na própria consulta (findFirst) e lê tudo numa transação REPEATABLE READ', async () => {
    await getDetalhe(5, ID_TUTOR);
    expect(consultasTx[0]).toBe('ocorrencia.findFirst');
    expect(consultasTx).toEqual([
      'ocorrencia.findFirst',
      'ocorrencia.findUnique',
      'ocorrencia.findUnique',
      'ocorrenciaEstudante.findMany',
      'encaminhamento.findMany',
      'comunicacao.findMany',
      'providencia.findMany',
    ]);
    expect(mocks.$transaction.mock.calls[0][1]).toEqual({ isolationLevel: 'RepeatableRead' });
  });

  it('404 com a MESMA mensagem para inexistente e para não permitida', async () => {
    const inexistente = await getDetalhe(999, ID_PROFESSOR);
    const naoPermitida = await getDetalhe(2, ID_PROFESSOR);
    const maiorIdInexistente = await getDetalhe(2147483647, ID_GESTAO);
    for (const res of [inexistente, naoPermitida, maiorIdInexistente]) {
      expect(res.status).toBe(404);
      expect(res.body).toEqual({ erro: MENSAGEM_OCORRENCIA_NAO_ENCONTRADA });
    }
    // Só a consulta com filtro roda: nada da ocorrência não permitida é lido.
    consultasTx = [];
    await getDetalhe(2, ID_PROFESSOR);
    expect(consultasTx).toEqual(['ocorrencia.findFirst']);
  });

  for (const id of ['abc', '0', '1.5', '-1', '01', '1e3', '2147483648', '99999999999', '999999999999999999999']) {
    it(`id "${id}" responde 400 sem consultar ocorrências`, async () => {
      const res = await getDetalhe(id, ID_GESTAO);
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ erro: MENSAGEM_ID_OCORRENCIA_INVALIDO });
      expect(mocks.$transaction).not.toHaveBeenCalled();
    });
  }

  it('não grava histórico nem auditoria', async () => {
    await getDetalhe(5, ID_GESTAO);
    expect(banco.historicos).toEqual([]);
    expect(banco.logs).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Autenticação e troca de senha
// ---------------------------------------------------------------------------
describe('GET /ocorrencias e /ocorrencias/{id} — autenticação', () => {
  it('401 sem token', async () => {
    for (const res of [await getLista(), await getDetalhe(1)]) {
      expect(res.status).toBe(401);
      expect(res.body).toEqual({ erro: MENSAGEM_NAO_AUTENTICADO });
    }
    expect(mocks.$transaction).not.toHaveBeenCalled();
  });

  it('401 com token inválido', async () => {
    const res = await request(app).get('/ocorrencias').set('Authorization', 'Bearer token.invalido.ficticio');
    expect(res.status).toBe(401);
  });

  it('403 com troca de senha pendente (mesmo sendo Gestão)', async () => {
    for (const res of [await getLista(ID_TROCA_PENDENTE), await getDetalhe(1, ID_TROCA_PENDENTE)]) {
      expect(res.status).toBe(403);
      expect(res.body).toEqual({ erro: MENSAGEM_TROCA_SENHA_OBRIGATORIA, codigo: CODIGOS_ERRO.TROCA_SENHA_OBRIGATORIA });
    }
    expect(mocks.$transaction).not.toHaveBeenCalled();
  });

  it('401 para usuário bloqueado (RN09), mesmo com token válido', async () => {
    const t = token(ID_GESTAO);
    banco.usuarios.find((u) => u.id === ID_GESTAO).status = 'BLOQUEADO';
    const res = await request(app).get('/ocorrencias').set('Authorization', `Bearer ${t}`);
    expect(res.status).toBe(401);
  });

  it('o perfil vem do banco, não do token (token antigo de Gestão de quem hoje é Professor)', async () => {
    const tokenGestao = jwt.sign({ id: ID_PROFESSOR, perfil: 'GESTAO' }, SEGREDO_TESTE, {
      algorithm: 'HS256',
      expiresIn: '8h',
    });
    const res = await request(app).get('/ocorrencias').set('Authorization', `Bearer ${tokenGestao}`);
    expect(res.body.itens.map((o) => o.id)).toEqual(ESPERADO_POR_USUARIO[ID_PROFESSOR]);
  });
});

// ---------------------------------------------------------------------------
// POST continua igual e o detalhe estende o 201
// ---------------------------------------------------------------------------
describe('POST /ocorrencias continua com o mesmo 201 (Issue #45)', () => {
  const corpo = () => ({
    dataHora: new Date(Date.now() - 60_000).toISOString(),
    local: 'Pátio',
    turmaId: 1,
    categoriaId: 1,
    descricao: 'Descrição objetiva fictícia do fato.',
    estudanteIds: [ID_ESTUDANTE_TUTORADO, ID_ESTUDANTE_SEM_TUTOR],
    encaminhamentos: [{ destinatarioPerfil: 'TUTOR', destinatarioUsuarioId: ID_TUTOR }],
  });

  it('201 sem comunicações, providências nem codigoEscolar; o detalhe = 201 + listas vazias', async () => {
    const post = await request(app)
      .post('/ocorrencias')
      .set('Authorization', `Bearer ${token(ID_TECNICO)}`)
      .send(corpo());
    expect(post.status).toBe(201);
    expect(Object.keys(post.body).sort()).toEqual(
      [
        'id', 'dataHora', 'local', 'turma', 'categoria', 'descricao', 'demaisEnvolvidos', 'testemunhas',
        'providenciasImediatas', 'observacoes', 'status', 'dataEncerramento', 'profissionalResponsavel',
        'responsavelAcompanhamento', 'estudantes', 'encaminhamentos',
      ].sort(),
    );
    for (const e of post.body.estudantes) expect(Object.keys(e).sort()).toEqual(['id', 'nomeCompleto', 'turma']);
    expect(post.body.profissionalResponsavel).toEqual({ id: ID_TECNICO, nome: `Usuário Fictício ${ID_TECNICO}` });
    expect(post.body.status).toBe('ABERTO');

    // Quem registrou passa a ver; o detalhe estende exatamente o 201.
    const detalhe = await getDetalhe(post.body.id, ID_TECNICO);
    expect(detalhe.status).toBe(200);
    expect(detalhe.body).toEqual({ ...post.body, comunicacoes: [], providencias: [] });

    // O tutor destinatário (e tutor do estudante) também vê; a Gestão vê com codigoEscolar.
    expect((await getDetalhe(post.body.id, ID_TUTOR)).status).toBe(200);
    const gestao = await getDetalhe(post.body.id, ID_GESTAO);
    expect(gestao.body.estudantes.map((e) => e.codigoEscolar)).toEqual(['TESTE-0002', 'TESTE-0001']);

    // E entra no topo da lista de quem registrou.
    expect((await getLista(ID_TECNICO)).body.itens.map((o) => o.id)).toEqual([post.body.id, 8]);
  });
});
