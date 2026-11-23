// Testes COMPLEMENTARES (QA) de POST /ocorrencias/{id}/encaminhamentos
// (Issue #49, UC02, RF08, RN03, RN04, RN08, RN15, RN17, RN19, RNF04) —
// somente dados fictícios (RN05). Mesmo "banco" em memória de
// ocorrencias-encaminhamento.test.js (src/lib/prisma.js substituído; a
// transação do mock faz rollback quando a operação falha). Nada é gravado
// no PostgreSQL.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { CODIGOS_ERRO } from '../src/lib/erros.js';
import { OPERACOES_ESCRITA, criarBancoEmMemoria } from './apoio/bancoEmMemoria.js';

const mocks = vi.hoisted(() => ({
  $transaction: vi.fn(),
}));

let banco;

// ---------------------------------------------------------------------------
// "Banco" em memória com avaliação de where/select/orderBy
// ---------------------------------------------------------------------------

/** Momento fictício preenchido pelo "banco" (@default(now())). */
const AGORA_BANCO = new Date('2026-10-28T13:00:00.000Z');

const DEFAULTS = {
  encaminhamento: () => ({ data_hora: AGORA_BANCO, observacao: null, destinatario_usuario_id: null }),
  historicoOcorrencia: () => ({ descricao: null, data_hora: AGORA_BANCO }),
  logAuditoria: () => ({ data_hora: AGORA_BANCO }),
};

/** Operações de escrita feitas na transação ("modelo.operacao"), em ordem. */
let escritas;

// Motor do "banco" em memória: tests/apoio/bancoEmMemoria.js (Issue #129).
const { clientMock } = criarBancoEmMemoria({
  obterBanco: () => banco,
  padroes: DEFAULTS,
  limiteRelacoes: 2,
  aoOperar: (modelo, operacao) => {
    if (OPERACOES_ESCRITA.includes(operacao)) escritas.push(`${modelo}.${operacao}`);
  },
});

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
const { MENSAGEM_TROCA_SENHA_OBRIGATORIA, MENSAGEM_PERFIL_SEM_PERMISSAO } = await import(
  '../src/middlewares/autenticacao.js'
);
const { MENSAGEM_NAO_AUTENTICADO } = await import('../src/services/sessao.js');
const { ACOES_AUDITORIA } = await import('../src/services/auditoria.js');
const {
  ACOES_HISTORICO,
  DESCRICAO_HISTORICO_ABERTO_PARA_ACOMPANHAMENTO,
  MENSAGEM_CONFLITO_CONCORRENTE_ENCAMINHAMENTO,
  MENSAGEM_CORPO_ENCAMINHAMENTO_INVALIDO,
  MENSAGEM_ENCAMINHAMENTO_DESTINATARIO_PERFIL_INVALIDO,
  MENSAGEM_ENCAMINHAMENTO_DESTINATARIO_USUARIO_ID_INVALIDO,
  MENSAGEM_ENCAMINHAMENTO_TUTOR_OBRIGATORIO,
  MENSAGEM_ID_OCORRENCIA_INVALIDO,
  MENSAGEM_OCORRENCIA_ENCERRADA_ENCAMINHAMENTO,
  MENSAGEM_OCORRENCIA_NAO_ENCONTRADA,
  MENSAGEM_RESPONSAVEL_ID_INVALIDO,
  MENSAGEM_RESPONSAVEL_INVALIDO,
  MENSAGEM_RESPONSAVEL_OBRIGATORIO,
  PERFIS_ENCAMINHAMENTO,
  PERFIS_RESPONSAVEL_ACOMPANHAMENTO,
  mensagemDestinatarioEncaminhamentoInvalido,
  mensagemTextoLongo,
  registrarEncaminhamento,
  validarEncaminhamento,
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
const ID_TROCA_PENDENTE = 6; // GESTAO com troca de senha pendente
const ID_TUTOR_BLOQUEADO = 7;
const ID_PEDAGOGICO_DESATIVADO = 8;
const ID_TUTOR_2 = 9;
const ID_GESTAO_2 = 10;
const ID_INEXISTENTE = 999;

const O_ABERTA = 1; // sem responsável
const O_ACOMPANHAMENTO = 2; // responsável: ID_TUTOR; com comunicação e providência
const O_ENCERRADA = 3;

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
  const ocorrencia = (id, status, extra = {}) => ({
    id,
    data_hora: data(`2026-10-0${id}T10:00:00.000Z`),
    local: `Local fictício ${id}`,
    turma_id: 1,
    categoria_id: 1,
    descricao: `Descrição fictícia ${id}.`,
    demais_envolvidos: null,
    testemunhas: null,
    providencias_imediatas: null,
    observacoes: null,
    profissional_responsavel_id: ID_PROFESSOR,
    responsavel_acompanhamento_id: null,
    status,
    data_encerramento: null,
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
      usuario(ID_TUTOR_BLOQUEADO, 'TUTOR', { status: 'BLOQUEADO' }),
      usuario(ID_PEDAGOGICO_DESATIVADO, 'PEDAGOGICO', { status: 'DESATIVADO' }),
      usuario(ID_TUTOR_2, 'TUTOR'),
      usuario(ID_GESTAO_2, 'GESTAO'),
    ],
    turmas: [{ id: 1, nome: '6º A', etapa: 'Ensino Fundamental', ano_letivo: 2026 }],
    categorias: [{ id: 1, nome: 'Indisciplina', descricao: null }],
    estudantes: [
      { id: 1, nome_completo: 'Estudante Fictício Alfa', codigo_escolar: 'TESTE-0001', turma_id: 1, tutor_id: ID_TUTOR },
      { id: 2, nome_completo: 'Estudante Fictício Beta', codigo_escolar: null, turma_id: 1, tutor_id: null },
    ],
    ocorrencias: [
      ocorrencia(O_ABERTA, 'ABERTO'),
      ocorrencia(O_ACOMPANHAMENTO, 'EM_ACOMPANHAMENTO', { responsavel_acompanhamento_id: ID_TUTOR }),
      ocorrencia(O_ENCERRADA, 'ENCERRADO', {
        responsavel_acompanhamento_id: ID_PEDAGOGICO,
        data_encerramento: data('2026-10-20T10:00:00.000Z'),
      }),
    ],
    ocorrenciasEstudantes: [
      { ocorrencia_id: O_ABERTA, estudante_id: 1 },
      { ocorrencia_id: O_ABERTA, estudante_id: 2 },
      { ocorrencia_id: O_ACOMPANHAMENTO, estudante_id: 1 },
      { ocorrencia_id: O_ENCERRADA, estudante_id: 2 },
    ],
    encaminhamentos: [
      { id: 1, ocorrencia_id: O_ABERTA, destinatario_perfil: 'GESTAO', destinatario_usuario_id: null, registrado_por_id: ID_PROFESSOR, data_hora: data('2026-10-01T10:05:00.000Z'), observacao: null },
      { id: 2, ocorrencia_id: O_ACOMPANHAMENTO, destinatario_perfil: 'TUTOR', destinatario_usuario_id: ID_TUTOR, registrado_por_id: ID_PROFESSOR, data_hora: data('2026-10-02T10:05:00.000Z'), observacao: null },
      { id: 3, ocorrencia_id: O_ENCERRADA, destinatario_perfil: 'GESTAO', destinatario_usuario_id: null, registrado_por_id: ID_PROFESSOR, data_hora: data('2026-10-03T10:05:00.000Z'), observacao: null },
    ],
    comunicacoes: [
      { id: 1, ocorrencia_id: O_ACOMPANHAMENTO, destinatario: 'Família fictícia', meio: 'Telefone', descricao: 'Contato fictício.', registrado_por_id: ID_GESTAO, data_hora: data('2026-10-03T14:00:00.000Z') },
    ],
    providencias: [
      { id: 1, ocorrencia_id: O_ACOMPANHAMENTO, descricao: 'Providência fictícia.', registrado_por_id: ID_PEDAGOGICO, data_hora: data('2026-10-04T09:00:00.000Z') },
    ],
    historicos: [],
    logs: [],
  };
}

let bancoInicial;

beforeEach(() => {
  process.env.JWT_SECRET = SEGREDO_TESTE;
  banco = montarBanco();
  bancoInicial = structuredClone(banco);
  escritas = [];
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
  const u = banco.usuarios.find((x) => x.id === id);
  return jwt.sign({ id, perfil: u.perfil }, SEGREDO_TESTE, { algorithm: 'HS256', expiresIn: '8h' });
}

const encaminhar = (ocorrenciaId, corpo, usuarioId = ID_GESTAO) => {
  const req = request(app).post(`/ocorrencias/${ocorrenciaId}/encaminhamentos`);
  return usuarioId ? req.set('Authorization', `Bearer ${token(usuarioId)}`).send(corpo) : req.send(corpo);
};
const getDetalhe = (id, usuarioId) =>
  request(app).get(`/ocorrencias/${id}`).set('Authorization', `Bearer ${token(usuarioId)}`);

const ocorrenciaNoBanco = (id) => banco.ocorrencias.find((o) => o.id === id);
const usuarioPorId = (id) => banco.usuarios.find((u) => u.id === id);

/** Nada foi gravado (banco igual ao inicial). */
function esperarNadaGravado() {
  expect(banco).toEqual(bancoInicial);
}

function erroPrisma(code) {
  const erro = new Error(`Erro fictício do Prisma (${code})`);
  erro.code = code;
  return erro;
}

const CORPO_TUTOR = { destinatarioPerfil: 'TUTOR', destinatarioUsuarioId: ID_TUTOR_2 };

const ID_TUTOR_3 = 11; // acrescentado só nos testes de visibilidade (RN19)
const acoes = () => banco.historicos.map((h) => h.acao);
const getLista = (usuarioId) =>
  request(app).get('/ocorrencias').set('Authorization', `Bearer ${token(usuarioId)}`);

// ---------------------------------------------------------------------------
// Fluxo com vários encaminhamentos na mesma ocorrência
// ---------------------------------------------------------------------------
describe('QA — encaminhamentos seguidos na mesma ocorrência', () => {
  it('ABERTO -> EM_ACOMPANHAMENTO -> novo encaminhamento sem responsável: status e responsável mantidos', async () => {
    const r1 = await encaminhar(O_ABERTA, { ...CORPO_TUTOR, responsavelAcompanhamentoId: ID_TUTOR_2 });
    expect(r1.status).toBe(201);
    expect(r1.body.status).toBe('EM_ACOMPANHAMENTO');

    // Segundo encaminhamento: a ocorrência já está EM_ACOMPANHAMENTO, então o
    // responsável deixa de ser obrigatório (RN15).
    const r2 = await encaminhar(O_ABERTA, { destinatarioPerfil: 'EQUIPE_PEDAGOGICA' }, ID_PEDAGOGICO);
    expect(r2.status).toBe(201);
    expect(r2.body.status).toBe('EM_ACOMPANHAMENTO');
    expect(r2.body.responsavelAcompanhamento).toEqual({ id: ID_TUTOR_2, nome: `Usuário Fictício ${ID_TUTOR_2}` });

    const o = ocorrenciaNoBanco(O_ABERTA);
    expect(o.status).toBe('EM_ACOMPANHAMENTO');
    expect(o.responsavel_acompanhamento_id).toBe(ID_TUTOR_2);

    // Histórico: contagem exata e ordem (RN08); "status alterado" só uma vez.
    expect(banco.historicos.map((h) => [h.usuario_id, h.acao, h.descricao])).toEqual([
      [ID_GESTAO, 'encaminhamento registrado', 'Destinatário: tutor'],
      [ID_GESTAO, 'status alterado', 'De aberto para em acompanhamento'],
      [ID_GESTAO, 'responsável pelo acompanhamento definido', null],
      [ID_PEDAGOGICO, 'encaminhamento registrado', 'Destinatário: equipe pedagógica'],
    ]);
    // Auditoria: exatamente 1 registro por encaminhamento.
    expect(banco.logs.map((l) => [l.usuario_id, l.acao, l.recurso])).toEqual([
      [ID_GESTAO, 'encaminhamento registrado', 'ocorrencias/1'],
      [ID_PEDAGOGICO, 'encaminhamento registrado', 'ocorrencias/1'],
    ]);
    // Encaminhamentos na resposta em ordem de registro (id crescente).
    expect(r2.body.encaminhamentos.map((e) => [e.id, e.destinatarioPerfil, e.registradoPor.id])).toEqual([
      [1, 'GESTAO', ID_PROFESSOR],
      [4, 'TUTOR', ID_GESTAO],
      [5, 'EQUIPE_PEDAGOGICA', ID_PEDAGOGICO],
    ]);
  });

  it('terceiro encaminhamento com troca de responsável gera "alterado" (não "definido") e nunca repete "status alterado"', async () => {
    await encaminhar(O_ABERTA, { destinatarioPerfil: 'GESTAO', responsavelAcompanhamentoId: ID_TUTOR });
    await encaminhar(O_ABERTA, { destinatarioPerfil: 'GESTAO' });
    const r3 = await encaminhar(O_ABERTA, { destinatarioPerfil: 'GESTAO', responsavelAcompanhamentoId: ID_PEDAGOGICO });
    expect(r3.status).toBe(201);
    expect(acoes()).toEqual([
      'encaminhamento registrado',
      'status alterado',
      'responsável pelo acompanhamento definido',
      'encaminhamento registrado',
      'encaminhamento registrado',
      'responsável pelo acompanhamento alterado',
    ]);
    expect(banco.logs).toHaveLength(3);
    expect(ocorrenciaNoBanco(O_ABERTA).responsavel_acompanhamento_id).toBe(ID_PEDAGOGICO);
  });

  it('encaminhamento que falha depois de outro bem-sucedido não deixa rastro', async () => {
    await encaminhar(O_ABERTA, { destinatarioPerfil: 'GESTAO', responsavelAcompanhamentoId: ID_TUTOR });
    const antes = structuredClone(banco);
    const falha = await encaminhar(O_ABERTA, { destinatarioPerfil: 'GESTAO', responsavelAcompanhamentoId: ID_TUTOR_BLOQUEADO });
    expect(falha.status).toBe(400);
    expect(banco).toEqual(antes);
  });
});

// ---------------------------------------------------------------------------
// Responsável pelo acompanhamento (RN15)
// ---------------------------------------------------------------------------
describe('QA — responsável pelo acompanhamento', () => {
  it('responsável = o próprio usuário logado (GESTAO) é aceito e gera "definido"', async () => {
    const res = await encaminhar(O_ABERTA, { destinatarioPerfil: 'GESTAO', responsavelAcompanhamentoId: ID_GESTAO }, ID_GESTAO);
    expect(res.status).toBe(201);
    expect(res.body.responsavelAcompanhamento).toEqual({ id: ID_GESTAO, nome: `Usuário Fictício ${ID_GESTAO}` });
    expect(acoes()).toContain('responsável pelo acompanhamento definido');
  });

  it('responsável igual ao usuário destinatário é aceito', async () => {
    const res = await encaminhar(O_ABERTA, { ...CORPO_TUTOR, responsavelAcompanhamentoId: ID_TUTOR_2 });
    expect(res.status).toBe(201);
    expect(res.body.responsavelAcompanhamento.id).toBe(ID_TUTOR_2);
    expect(res.body.encaminhamentos.at(-1).destinatarioUsuario.id).toBe(ID_TUTOR_2);
  });

  it('ABERTO com responsável já gravado (dado inconsistente) e SEM responsável no corpo: 400 obrigatório', async () => {
    ocorrenciaNoBanco(O_ABERTA).responsavel_acompanhamento_id = ID_TUTOR;
    bancoInicial = structuredClone(banco);
    const res = await encaminhar(O_ABERTA, { destinatarioPerfil: 'GESTAO' });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ erro: MENSAGEM_RESPONSAVEL_OBRIGATORIO });
    esperarNadaGravado();
  });

  it('ABERTO com responsável já gravado (inconsistente) e outro no corpo: EM_ACOMPANHAMENTO com "alterado"', async () => {
    ocorrenciaNoBanco(O_ABERTA).responsavel_acompanhamento_id = ID_TUTOR;
    const res = await encaminhar(O_ABERTA, { destinatarioPerfil: 'GESTAO', responsavelAcompanhamentoId: ID_PEDAGOGICO });
    expect(res.status).toBe(201);
    expect(ocorrenciaNoBanco(O_ABERTA)).toMatchObject({ status: 'EM_ACOMPANHAMENTO', responsavel_acompanhamento_id: ID_PEDAGOGICO });
    expect(acoes()).toEqual(['encaminhamento registrado', 'status alterado', 'responsável pelo acompanhamento alterado']);
  });

  // Regressão (achado do QA, dado inconsistente): em ABERTO o responsável é
  // revalidado mesmo igual ao já gravado — a RN15 exige responsável ATIVO.
  it('ABERTO com responsável gravado BLOQUEADO e o mesmo id no corpo responde 400 (RN15: ativo)', async () => {
    ocorrenciaNoBanco(O_ABERTA).responsavel_acompanhamento_id = ID_TUTOR_BLOQUEADO;
    const res = await encaminhar(O_ABERTA, { destinatarioPerfil: 'GESTAO', responsavelAcompanhamentoId: ID_TUTOR_BLOQUEADO });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ erro: MENSAGEM_RESPONSAVEL_INVALIDO });
  });

  it('EM_ACOMPANHAMENTO sem responsável atual (inconsistente) e sem responsável no corpo: 201, continua null', async () => {
    ocorrenciaNoBanco(O_ACOMPANHAMENTO).responsavel_acompanhamento_id = null;
    const res = await encaminhar(O_ACOMPANHAMENTO, { destinatarioPerfil: 'GESTAO' });
    expect(res.status).toBe(201);
    expect(res.body.responsavelAcompanhamento).toBeNull();
    expect(acoes()).toEqual(['encaminhamento registrado']);
  });

  it('EM_ACOMPANHAMENTO sem responsável atual e com responsável no corpo: grava e gera "definido"', async () => {
    ocorrenciaNoBanco(O_ACOMPANHAMENTO).responsavel_acompanhamento_id = null;
    const res = await encaminhar(O_ACOMPANHAMENTO, { destinatarioPerfil: 'GESTAO', responsavelAcompanhamentoId: ID_GESTAO_2 });
    expect(res.status).toBe(201);
    expect(acoes()).toEqual(['encaminhamento registrado', 'responsável pelo acompanhamento definido']);
    expect(ocorrenciaNoBanco(O_ACOMPANHAMENTO).status).toBe('EM_ACOMPANHAMENTO');
  });

  for (const [rotulo, id] of [
    ['bloqueado', ID_TUTOR_BLOQUEADO],
    ['desativado', ID_PEDAGOGICO_DESATIVADO],
    ['inexistente', ID_INEXISTENTE],
    ['TECNICO_ADMINISTRATIVO', ID_TECNICO],
  ]) {
    it(`EM_ACOMPANHAMENTO: troca para responsável ${rotulo} responde 400 sem gravar`, async () => {
      const res = await encaminhar(O_ACOMPANHAMENTO, { destinatarioPerfil: 'GESTAO', responsavelAcompanhamentoId: id });
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ erro: MENSAGEM_RESPONSAVEL_INVALIDO });
      esperarNadaGravado();
    });
  }
});

// ---------------------------------------------------------------------------
// Destinatário e observação (RN03)
// ---------------------------------------------------------------------------
describe('QA — destinatário e observação', () => {
  it('EQUIPE_PEDAGOGICA sem usuário: destinatarioUsuario null no banco e na resposta', async () => {
    const res = await encaminhar(O_ABERTA, { destinatarioPerfil: 'EQUIPE_PEDAGOGICA', responsavelAcompanhamentoId: ID_PEDAGOGICO }, ID_PEDAGOGICO);
    expect(res.status).toBe(201);
    expect(banco.encaminhamentos.at(-1)).toMatchObject({ destinatario_perfil: 'EQUIPE_PEDAGOGICA', destinatario_usuario_id: null });
    expect(res.body.encaminhamentos.at(-1)).toMatchObject({ destinatarioPerfil: 'EQUIPE_PEDAGOGICA', destinatarioUsuario: null });
    expect(banco.historicos[0].descricao).toBe('Destinatário: equipe pedagógica');
  });

  it('GESTAO com destinatarioUsuarioId null explícito é aceito', async () => {
    const res = await encaminhar(O_ACOMPANHAMENTO, { destinatarioPerfil: 'GESTAO', destinatarioUsuarioId: null });
    expect(res.status).toBe(201);
    expect(banco.encaminhamentos.at(-1).destinatario_usuario_id).toBeNull();
  });

  for (const [rotulo, valor] of [['só espaços', '   \t  '], ['vazia', ''], ['null', null]]) {
    it(`observação ${rotulo} vira null no banco e na resposta`, async () => {
      const res = await encaminhar(O_ACOMPANHAMENTO, { destinatarioPerfil: 'GESTAO', observacao: valor });
      expect(res.status).toBe(201);
      expect(banco.encaminhamentos.at(-1).observacao).toBeNull();
      expect(res.body.encaminhamentos.at(-1).observacao).toBeNull();
    });
  }

  it('observação com exatamente 5000 caracteres (após trim) é aceita', async () => {
    const res = await encaminhar(O_ACOMPANHAMENTO, { destinatarioPerfil: 'GESTAO', observacao: `  ${'a'.repeat(5000)}  ` });
    expect(res.status).toBe(201);
    expect(banco.encaminhamentos.at(-1).observacao).toHaveLength(5000);
  });

  it('dataHora do encaminhamento na resposta é a do banco (RN17), não a do corpo', async () => {
    const res = await encaminhar(O_ACOMPANHAMENTO, {
      destinatarioPerfil: 'GESTAO',
      dataHora: '2020-01-01T00:00:00Z',
      data_hora: '2020-01-01T00:00:00Z',
    });
    expect(res.status).toBe(201);
    expect(res.body.encaminhamentos.at(-1).dataHora).toBe(AGORA_BANCO.toISOString());
  });
});

// ---------------------------------------------------------------------------
// Visibilidade depois do encaminhamento (integração com a RN19 da #47)
// ---------------------------------------------------------------------------
describe('QA — visibilidade (RN19) depois do encaminhamento', () => {
  beforeEach(() => {
    banco.usuarios.push({
      id: ID_TUTOR_3,
      nome: `Usuário Fictício ${ID_TUTOR_3}`,
      email: `usuario${ID_TUTOR_3}@sisto.exemplo`,
      senha_hash: 'hash-ficticio',
      perfil: 'TUTOR',
      status: 'ATIVO',
      troca_senha_obrigatoria: false,
      senha_alterada_em: null,
    });
    bancoInicial = structuredClone(banco);
  });

  it('o TUTOR destinatário e o TUTOR responsável passam a ver a ocorrência (detalhe e lista)', async () => {
    for (const id of [ID_TUTOR_2, ID_TUTOR_3]) {
      expect((await getDetalhe(O_ABERTA, id)).status).toBe(404);
      expect((await getLista(id)).body.itens.map((o) => o.id)).not.toContain(O_ABERTA);
    }

    const res = await encaminhar(O_ABERTA, { ...CORPO_TUTOR, responsavelAcompanhamentoId: ID_TUTOR_3 });
    expect(res.status).toBe(201);

    for (const id of [ID_TUTOR_2, ID_TUTOR_3]) {
      const detalhe = await getDetalhe(O_ABERTA, id);
      expect(detalhe.status).toBe(200);
      expect(detalhe.body.status).toBe('EM_ACOMPANHAMENTO');
      for (const e of detalhe.body.estudantes) expect(e).not.toHaveProperty('codigoEscolar');
      expect((await getLista(id)).body.itens.map((o) => o.id)).toContain(O_ABERTA);
    }
  });

  it('TUTOR que deixa de ser responsável (troca) e não é destinatário deixa de ver a ocorrência', async () => {
    await encaminhar(O_ABERTA, { destinatarioPerfil: 'GESTAO', responsavelAcompanhamentoId: ID_TUTOR_3 });
    expect((await getDetalhe(O_ABERTA, ID_TUTOR_3)).status).toBe(200);
    await encaminhar(O_ABERTA, { destinatarioPerfil: 'GESTAO', responsavelAcompanhamentoId: ID_PEDAGOGICO });
    expect((await getDetalhe(O_ABERTA, ID_TUTOR_3)).status).toBe(404);
  });

  it('encaminhamento para equipe (sem usuário) não amplia a visibilidade de TUTOR', async () => {
    await encaminhar(O_ABERTA, { destinatarioPerfil: 'EQUIPE_PEDAGOGICA', responsavelAcompanhamentoId: ID_PEDAGOGICO });
    expect((await getDetalhe(O_ABERTA, ID_TUTOR_3)).status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Resposta sem vazamento de dados
// ---------------------------------------------------------------------------
describe('QA — resposta 201 sem e-mail, status de usuário ou hash', () => {
  it('objetos de usuário só com id, nome (e perfil no destinatário)', async () => {
    const res = await encaminhar(O_ABERTA, { ...CORPO_TUTOR, responsavelAcompanhamentoId: ID_TUTOR_2 }, ID_PEDAGOGICO);
    expect(res.status).toBe(201);
    expect(Object.keys(res.body.responsavelAcompanhamento).sort()).toEqual(['id', 'nome']);
    expect(Object.keys(res.body.profissionalResponsavel).sort()).toEqual(['id', 'nome']);
    for (const e of res.body.encaminhamentos) {
      expect(Object.keys(e.registradoPor).sort()).toEqual(['id', 'nome']);
      if (e.destinatarioUsuario) expect(Object.keys(e.destinatarioUsuario).sort()).toEqual(['id', 'nome', 'perfil']);
    }
    expect(JSON.stringify(res.body)).not.toMatch(/@sisto|hash|senha|email|"ATIVO"|BLOQUEADO|DESATIVADO|TESTE-/);
  });
});

// ---------------------------------------------------------------------------
// Corpo, ordem de erros e mensagens
// ---------------------------------------------------------------------------
describe('QA — corpo inválido (400 sem abrir transação)', () => {
  const brutos = [
    ['null', 'null'],
    ['string', '"GESTAO"'],
    ['número', '42'],
    ['booleano', 'true'],
    ['array de objeto', '[{"destinatarioPerfil":"GESTAO"}]'],
  ];
  for (const [rotulo, bruto] of brutos) {
    it(`corpo JSON ${rotulo}: 400`, async () => {
      const res = await request(app)
        .post(`/ocorrencias/${O_ABERTA}/encaminhamentos`)
        .set('Authorization', `Bearer ${token(ID_GESTAO)}`)
        .set('Content-Type', 'application/json')
        .send(bruto);
      expect(res.status).toBe(400);
      expect(typeof res.body.erro).toBe('string');
      expect(mocks.$transaction).not.toHaveBeenCalled();
      esperarNadaGravado();
    });
  }

  it('sem corpo: 400 com a mensagem do contrato', async () => {
    const res = await request(app)
      .post(`/ocorrencias/${O_ABERTA}/encaminhamentos`)
      .set('Authorization', `Bearer ${token(ID_GESTAO)}`);
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ erro: MENSAGEM_CORPO_ENCAMINHAMENTO_INVALIDO });
    expect(mocks.$transaction).not.toHaveBeenCalled();
  });

  it('corpo text/plain: 400 sem gravar', async () => {
    const res = await request(app)
      .post(`/ocorrencias/${O_ABERTA}/encaminhamentos`)
      .set('Authorization', `Bearer ${token(ID_GESTAO)}`)
      .set('Content-Type', 'text/plain')
      .send('destinatarioPerfil=GESTAO');
    expect(res.status).toBe(400);
    esperarNadaGravado();
  });

  it('validarEncaminhamento recusa null, undefined, string, número e array com a mensagem do contrato', () => {
    for (const corpo of [null, undefined, 'GESTAO', 42, [], [{ destinatarioPerfil: 'GESTAO' }]]) {
      expect(() => validarEncaminhamento(corpo)).toThrow(MENSAGEM_CORPO_ENCAMINHAMENTO_INVALIDO);
    }
  });

  it('responsavelAcompanhamentoId negativo, fracionário, booleano, objeto ou array: 400', async () => {
    for (const valor of [-1, 2.5, true, { id: 2 }, [2]]) {
      const res = await encaminhar(O_ACOMPANHAMENTO, { destinatarioPerfil: 'GESTAO', responsavelAcompanhamentoId: valor });
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ erro: MENSAGEM_RESPONSAVEL_ID_INVALIDO });
    }
    expect(mocks.$transaction).not.toHaveBeenCalled();
  });
});

describe('QA — ordem documentada dos erros', () => {
  it('perfil sem permissão recebe 403 antes do 400 do id', async () => {
    const res = await encaminhar('abc', { destinatarioPerfil: 'X' }, ID_TUTOR);
    expect(res.status).toBe(403);
  });

  it('404 vem antes do 400 de responsável obrigatório', async () => {
    const res = await encaminhar(ID_INEXISTENTE, { destinatarioPerfil: 'GESTAO' });
    expect(res.status).toBe(404);
  });

  it('409 (ENCERRADO) vem antes do 400 de responsável obrigatório', async () => {
    const res = await encaminhar(O_ENCERRADA, { destinatarioPerfil: 'GESTAO' }, ID_PEDAGOGICO);
    expect(res.status).toBe(409);
  });

  it('ABERTO: responsável obrigatório vem antes do destinatário inválido', async () => {
    const res = await encaminhar(O_ABERTA, { destinatarioPerfil: 'TUTOR', destinatarioUsuarioId: ID_TUTOR_BLOQUEADO });
    expect(res.body).toEqual({ erro: MENSAGEM_RESPONSAVEL_OBRIGATORIO });
  });

  it('destinatário inválido vem antes do responsável inválido', async () => {
    const res = await encaminhar(O_ABERTA, {
      destinatarioPerfil: 'TUTOR',
      destinatarioUsuarioId: ID_TUTOR_BLOQUEADO,
      responsavelAcompanhamentoId: ID_PROFESSOR,
    });
    expect(res.body).toEqual({ erro: mensagemDestinatarioEncaminhamentoInvalido('TUTOR') });
  });

  it('erros não gravam histórico nem auditoria (400, 404, 409)', async () => {
    await encaminhar(O_ABERTA, { destinatarioPerfil: 'GESTAO' });
    await encaminhar(ID_INEXISTENTE, { destinatarioPerfil: 'GESTAO' });
    await encaminhar(O_ENCERRADA, { destinatarioPerfil: 'GESTAO' });
    expect(banco.historicos).toEqual([]);
    expect(banco.logs).toEqual([]);
  });
});

describe('QA — mensagens de erro claras, sem ids nem nomes', () => {
  it('nenhuma resposta de erro contém id, nome, e-mail ou status do usuário envolvido', async () => {
    const respostas = [
      await encaminhar(ID_INEXISTENTE, { destinatarioPerfil: 'GESTAO' }),
      await encaminhar(O_ENCERRADA, { destinatarioPerfil: 'GESTAO' }),
      await encaminhar(O_ABERTA, { destinatarioPerfil: 'GESTAO' }),
      await encaminhar(O_ABERTA, { destinatarioPerfil: 'TUTOR', destinatarioUsuarioId: 777, responsavelAcompanhamentoId: ID_TUTOR }),
      await encaminhar(O_ABERTA, { destinatarioPerfil: 'GESTAO', responsavelAcompanhamentoId: 888 }),
      await encaminhar(O_ABERTA, { destinatarioPerfil: 'GESTAO', responsavelAcompanhamentoId: ID_TUTOR_BLOQUEADO }),
    ];
    expect(respostas.map((r) => r.status)).toEqual([404, 409, 400, 400, 400, 400]);
    expect(respostas[1].body.codigo).toBe(CODIGOS_ERRO.OCORRENCIA_ENCERRADA);
    for (const r of respostas) {
      // Só o 409 traz, além de `erro`, o código estável (#72, D1).
      expect(Object.keys(r.body)).toEqual(r.status === 409 ? ['erro', 'codigo'] : ['erro']);
      expect(r.body.erro.length).toBeGreaterThan(10);
      expect(r.body.erro).not.toMatch(/999|777|888|Fictíci|@|BLOQUEADO|undefined/);
    }
  });
});
