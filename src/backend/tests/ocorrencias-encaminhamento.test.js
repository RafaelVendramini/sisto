// Testes de POST /ocorrencias/{id}/encaminhamentos (Issue #49, UC02, RF08,
// RN03, RN04, RN08, RN15, RN17, RNF04) — somente dados fictícios (RN05).
// Não dependem do banco: src/lib/prisma.js é substituído por um "banco" em
// memória que AVALIA o `where` gerado pelo service (mesmo modelo de
// ocorrencias-consulta.test.js, acrescido de `update`). A transação do mock
// faz rollback (cópia do banco) quando a operação falha.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { CODIGOS_ERRO } from '../src/lib/erros.js';
import { OPERACOES_ESCRITA, criarBancoEmMemoria } from './apoio/bancoEmMemoria.js';
import { TENTATIVAS_TRANSACAO } from '../src/lib/transacao.js';

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
  MENSAGEM_TEXTO_CARACTERE_INVALIDO,
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

// ---------------------------------------------------------------------------
// Autenticação e permissões
// ---------------------------------------------------------------------------
describe('POST /ocorrencias/{id}/encaminhamentos — autenticação e perfis (Seção 4, RN15)', () => {
  it('PERFIS_ENCAMINHAMENTO são exatamente GESTAO e PEDAGOGICO', () => {
    expect([...PERFIS_ENCAMINHAMENTO].sort()).toEqual(['GESTAO', 'PEDAGOGICO']);
  });

  it('sem token responde 401 sem gravar', async () => {
    const res = await encaminhar(O_ABERTA, { ...CORPO_TUTOR, responsavelAcompanhamentoId: ID_TUTOR }, null);
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ erro: MENSAGEM_NAO_AUTENTICADO });
    expect(mocks.$transaction).not.toHaveBeenCalled();
    esperarNadaGravado();
  });

  for (const [rotulo, id] of [
    ['PROFESSOR', ID_PROFESSOR],
    ['TUTOR', ID_TUTOR],
    ['TECNICO_ADMINISTRATIVO', ID_TECNICO],
  ]) {
    it(`${rotulo} recebe 403 sem gravar (mesmo com corpo válido)`, async () => {
      const res = await encaminhar(O_ABERTA, { ...CORPO_TUTOR, responsavelAcompanhamentoId: ID_TUTOR }, id);
      expect(res.status).toBe(403);
      expect(res.body).toEqual({ erro: MENSAGEM_PERFIL_SEM_PERMISSAO });
      expect(mocks.$transaction).not.toHaveBeenCalled();
      esperarNadaGravado();
    });

    it(`${rotulo} recebe 403 também em ocorrência inexistente (não revela existência)`, async () => {
      const res = await encaminhar(ID_INEXISTENTE, CORPO_TUTOR, id);
      expect(res.status).toBe(403);
    });
  }

  it('troca de senha pendente responde 403 sem gravar', async () => {
    const res = await encaminhar(O_ABERTA, { ...CORPO_TUTOR, responsavelAcompanhamentoId: ID_TUTOR }, ID_TROCA_PENDENTE);
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ erro: MENSAGEM_TROCA_SENHA_OBRIGATORIA, codigo: CODIGOS_ERRO.TROCA_SENHA_OBRIGATORIA });
    esperarNadaGravado();
  });

  it('GESTAO e PEDAGOGICO conseguem encaminhar (201)', async () => {
    const r1 = await encaminhar(O_ACOMPANHAMENTO, { destinatarioPerfil: 'GESTAO' }, ID_GESTAO);
    const r2 = await encaminhar(O_ACOMPANHAMENTO, { destinatarioPerfil: 'GESTAO' }, ID_PEDAGOGICO);
    expect([r1.status, r2.status]).toEqual([201, 201]);
  });
});

// ---------------------------------------------------------------------------
// id da URL e ocorrência
// ---------------------------------------------------------------------------
describe('id da URL', () => {
  for (const id of ['abc', '0', '-1', '1.5', '01', '2147483648']) {
    it(`id "${id}" responde 400 sem abrir transação`, async () => {
      const res = await encaminhar(id, { destinatarioPerfil: 'GESTAO' });
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ erro: MENSAGEM_ID_OCORRENCIA_INVALIDO });
      expect(mocks.$transaction).not.toHaveBeenCalled();
    });
  }

  it('ocorrência inexistente responde 404 sem gravar', async () => {
    const res = await encaminhar(ID_INEXISTENTE, { destinatarioPerfil: 'GESTAO', responsavelAcompanhamentoId: ID_TUTOR });
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ erro: MENSAGEM_OCORRENCIA_NAO_ENCONTRADA });
    esperarNadaGravado();
  });

  it('id inválido vem antes do corpo inválido (400 do id)', async () => {
    const res = await encaminhar('abc', { destinatarioPerfil: 'X' });
    expect(res.body).toEqual({ erro: MENSAGEM_ID_OCORRENCIA_INVALIDO });
  });
});

// ---------------------------------------------------------------------------
// Validação do corpo (sem banco)
// ---------------------------------------------------------------------------
describe('validação do corpo (400 antes de qualquer consulta)', () => {
  const casos = [
    ['corpo array', [], MENSAGEM_CORPO_ENCAMINHAMENTO_INVALIDO],
    ['destinatarioPerfil ausente', {}, MENSAGEM_ENCAMINHAMENTO_DESTINATARIO_PERFIL_INVALIDO],
    ['destinatarioPerfil desconhecido', { destinatarioPerfil: 'PROFESSOR' }, MENSAGEM_ENCAMINHAMENTO_DESTINATARIO_PERFIL_INVALIDO],
    ['destinatarioPerfil em minúsculas', { destinatarioPerfil: 'gestao' }, MENSAGEM_ENCAMINHAMENTO_DESTINATARIO_PERFIL_INVALIDO],
    ['destinatarioUsuarioId texto', { destinatarioPerfil: 'GESTAO', destinatarioUsuarioId: '3' }, MENSAGEM_ENCAMINHAMENTO_DESTINATARIO_USUARIO_ID_INVALIDO],
    ['destinatarioUsuarioId fracionário', { destinatarioPerfil: 'GESTAO', destinatarioUsuarioId: 1.5 }, MENSAGEM_ENCAMINHAMENTO_DESTINATARIO_USUARIO_ID_INVALIDO],
    ['tutor sem usuário', { destinatarioPerfil: 'TUTOR' }, MENSAGEM_ENCAMINHAMENTO_TUTOR_OBRIGATORIO],
    ['tutor com usuário null', { destinatarioPerfil: 'TUTOR', destinatarioUsuarioId: null }, MENSAGEM_ENCAMINHAMENTO_TUTOR_OBRIGATORIO],
    ['observacao número', { destinatarioPerfil: 'GESTAO', observacao: 5 }, 'Informe observacao como texto (ou null).'],
    ['observacao longa', { destinatarioPerfil: 'GESTAO', observacao: 'x'.repeat(5001) }, mensagemTextoLongo('observacao')],
    ['observacao com caractere nulo', { destinatarioPerfil: 'GESTAO', observacao: 'Texto\u0000fictício' }, MENSAGEM_TEXTO_CARACTERE_INVALIDO],
    ['responsavel texto', { destinatarioPerfil: 'GESTAO', responsavelAcompanhamentoId: '2' }, MENSAGEM_RESPONSAVEL_ID_INVALIDO],
    ['responsavel zero', { destinatarioPerfil: 'GESTAO', responsavelAcompanhamentoId: 0 }, MENSAGEM_RESPONSAVEL_ID_INVALIDO],
    ['responsavel acima do Int', { destinatarioPerfil: 'GESTAO', responsavelAcompanhamentoId: 2147483648 }, MENSAGEM_RESPONSAVEL_ID_INVALIDO],
  ];
  for (const [rotulo, corpo, mensagem] of casos) {
    it(`${rotulo}: 400`, async () => {
      const res = await encaminhar(O_ABERTA, corpo);
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ erro: mensagem });
      expect(mocks.$transaction).not.toHaveBeenCalled();
      esperarNadaGravado();
    });
  }

  it('JSON malformado responde 400 sem gravar', async () => {
    const res = await request(app)
      .post(`/ocorrencias/${O_ABERTA}/encaminhamentos`)
      .set('Authorization', `Bearer ${token(ID_GESTAO)}`)
      .set('Content-Type', 'application/json')
      .send('{"destinatarioPerfil":');
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('erro');
    esperarNadaGravado();
  });

  it('corpo inválido em ocorrência ENCERRADO responde 400 (formato vem antes do 409)', async () => {
    const res = await encaminhar(O_ENCERRADA, { destinatarioPerfil: 'X' });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ erro: MENSAGEM_ENCAMINHAMENTO_DESTINATARIO_PERFIL_INVALIDO });
  });

  it('validarEncaminhamento normaliza observação (NFC, trim, vazio -> null) e ignora campos fora do contrato', () => {
    expect(
      validarEncaminhamento({
        destinatarioPerfil: 'GESTAO',
        observacao: '  Observação fictícia  ',
        registradoPorId: 99,
        status: 'ENCERRADO',
      }),
    ).toEqual({
      destinatarioPerfil: 'GESTAO',
      destinatarioUsuarioId: null,
      observacao: 'Observação fictícia',
      responsavelAcompanhamentoId: null,
    });
    expect(validarEncaminhamento({ destinatarioPerfil: 'GESTAO', observacao: '   ' }).observacao).toBeNull();
    expect(
      validarEncaminhamento({ destinatarioPerfil: 'EQUIPE_PEDAGOGICA', destinatarioUsuarioId: null, responsavelAcompanhamentoId: null }),
    ).toMatchObject({ destinatarioUsuarioId: null, responsavelAcompanhamentoId: null });
  });
});

// ---------------------------------------------------------------------------
// RN15 — ocorrência ABERTO
// ---------------------------------------------------------------------------
describe('RN15 — ocorrência ABERTO', () => {
  it('muda para EM_ACOMPANHAMENTO, grava o responsável, o encaminhamento, o histórico e a auditoria', async () => {
    const res = await encaminhar(O_ABERTA, {
      destinatarioPerfil: 'TUTOR',
      destinatarioUsuarioId: ID_TUTOR_2,
      observacao: 'Observação fictícia do encaminhamento.',
      responsavelAcompanhamentoId: ID_TUTOR_2,
    });
    expect(res.status).toBe(201);

    const o = ocorrenciaNoBanco(O_ABERTA);
    expect(o.status).toBe('EM_ACOMPANHAMENTO');
    expect(o.responsavel_acompanhamento_id).toBe(ID_TUTOR_2);

    const novos = banco.encaminhamentos.filter((e) => e.ocorrencia_id === O_ABERTA);
    expect(novos).toHaveLength(2);
    expect(novos[1]).toEqual({
      id: 4,
      ocorrencia_id: O_ABERTA,
      destinatario_perfil: 'TUTOR',
      destinatario_usuario_id: ID_TUTOR_2,
      registrado_por_id: ID_GESTAO,
      observacao: 'Observação fictícia do encaminhamento.',
      data_hora: AGORA_BANCO, // preenchida pelo banco (RN17)
    });

    expect(banco.historicos.map(({ ocorrencia_id, usuario_id, acao, descricao }) => ({ ocorrencia_id, usuario_id, acao, descricao }))).toEqual([
      { ocorrencia_id: O_ABERTA, usuario_id: ID_GESTAO, acao: 'encaminhamento registrado', descricao: 'Destinatário: tutor' },
      { ocorrencia_id: O_ABERTA, usuario_id: ID_GESTAO, acao: 'status alterado', descricao: 'De aberto para em acompanhamento' },
      { ocorrencia_id: O_ABERTA, usuario_id: ID_GESTAO, acao: 'responsável pelo acompanhamento definido', descricao: null },
    ]);
    expect(banco.logs).toEqual([
      { id: 1, usuario_id: ID_GESTAO, acao: 'encaminhamento registrado', recurso: 'ocorrencias/1', data_hora: AGORA_BANCO },
    ]);

    expect(res.body).toMatchObject({
      id: O_ABERTA,
      status: 'EM_ACOMPANHAMENTO',
      responsavelAcompanhamento: { id: ID_TUTOR_2, nome: `Usuário Fictício ${ID_TUTOR_2}` },
    });
    expect(res.body.encaminhamentos.at(-1)).toEqual({
      id: 4,
      destinatarioPerfil: 'TUTOR',
      destinatarioUsuario: { id: ID_TUTOR_2, nome: `Usuário Fictício ${ID_TUTOR_2}`, perfil: 'TUTOR' },
      registradoPor: { id: ID_GESTAO, nome: `Usuário Fictício ${ID_GESTAO}` },
      dataHora: AGORA_BANCO.toISOString(),
      observacao: 'Observação fictícia do encaminhamento.',
    });
  });

  it('constantes de histórico e auditoria são as esperadas', () => {
    expect(ACOES_HISTORICO).toMatchObject({
      ENCAMINHAMENTO_REGISTRADO: 'encaminhamento registrado',
      STATUS_ALTERADO: 'status alterado',
      RESPONSAVEL_DEFINIDO: 'responsável pelo acompanhamento definido',
      RESPONSAVEL_ALTERADO: 'responsável pelo acompanhamento alterado',
    });
    expect(DESCRICAO_HISTORICO_ABERTO_PARA_ACOMPANHAMENTO).toBe('De aberto para em acompanhamento');
    expect(ACOES_AUDITORIA.ENCAMINHAMENTO_REGISTRADO).toBe('encaminhamento registrado');
    expect([...PERFIS_RESPONSAVEL_ACOMPANHAMENTO].sort()).toEqual(['GESTAO', 'PEDAGOGICO', 'TUTOR']);
  });

  for (const [perfil, idResponsavel] of [['TUTOR', ID_TUTOR], ['PEDAGOGICO', ID_PEDAGOGICO], ['GESTAO', ID_GESTAO_2]]) {
    it(`aceita responsável com perfil ${perfil} ativo`, async () => {
      const res = await encaminhar(O_ABERTA, { destinatarioPerfil: 'GESTAO', responsavelAcompanhamentoId: idResponsavel }, ID_PEDAGOGICO);
      expect(res.status).toBe(201);
      expect(ocorrenciaNoBanco(O_ABERTA).responsavel_acompanhamento_id).toBe(idResponsavel);
    });
  }

  it('o próprio usuário logado pode ser o responsável', async () => {
    const res = await encaminhar(O_ABERTA, { destinatarioPerfil: 'EQUIPE_PEDAGOGICA', responsavelAcompanhamentoId: ID_PEDAGOGICO }, ID_PEDAGOGICO);
    expect(res.status).toBe(201);
    expect(res.body.responsavelAcompanhamento.id).toBe(ID_PEDAGOGICO);
  });

  for (const valor of [undefined, null]) {
    it(`sem responsável (${valor}) responde 400 sem gravar`, async () => {
      const res = await encaminhar(O_ABERTA, { destinatarioPerfil: 'GESTAO', responsavelAcompanhamentoId: valor });
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ erro: MENSAGEM_RESPONSAVEL_OBRIGATORIO });
      esperarNadaGravado();
    });
  }

  for (const [rotulo, idResponsavel] of [
    ['inexistente', ID_INEXISTENTE],
    ['bloqueado', ID_TUTOR_BLOQUEADO],
    ['desativado', ID_PEDAGOGICO_DESATIVADO],
    ['PROFESSOR', ID_PROFESSOR],
    ['TECNICO_ADMINISTRATIVO', ID_TECNICO],
  ]) {
    it(`responsável ${rotulo} responde 400 sem gravar`, async () => {
      const res = await encaminhar(O_ABERTA, { destinatarioPerfil: 'GESTAO', responsavelAcompanhamentoId: idResponsavel });
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ erro: MENSAGEM_RESPONSAVEL_INVALIDO });
      esperarNadaGravado();
    });
  }
});

// ---------------------------------------------------------------------------
// RN15 — EM_ACOMPANHAMENTO e ENCERRADO
// ---------------------------------------------------------------------------
describe('RN15 — ocorrência EM_ACOMPANHAMENTO', () => {
  it('sem responsável: grava o encaminhamento, não muda status nem responsável; só histórico do encaminhamento', async () => {
    const res = await encaminhar(O_ACOMPANHAMENTO, { destinatarioPerfil: 'EQUIPE_PEDAGOGICA', destinatarioUsuarioId: ID_PEDAGOGICO });
    expect(res.status).toBe(201);
    const o = ocorrenciaNoBanco(O_ACOMPANHAMENTO);
    expect(o.status).toBe('EM_ACOMPANHAMENTO');
    expect(o.responsavel_acompanhamento_id).toBe(ID_TUTOR);
    expect(banco.historicos.map((h) => [h.acao, h.descricao])).toEqual([
      ['encaminhamento registrado', 'Destinatário: equipe pedagógica'],
    ]);
    expect(banco.logs).toHaveLength(1);
    expect(banco.logs[0]).toMatchObject({ acao: 'encaminhamento registrado', recurso: 'ocorrencias/2' });
  });

  it('com troca do responsável: troca e gera histórico "responsável pelo acompanhamento alterado"', async () => {
    const res = await encaminhar(O_ACOMPANHAMENTO, { destinatarioPerfil: 'GESTAO', responsavelAcompanhamentoId: ID_GESTAO_2 });
    expect(res.status).toBe(201);
    const o = ocorrenciaNoBanco(O_ACOMPANHAMENTO);
    expect(o.status).toBe('EM_ACOMPANHAMENTO');
    expect(o.responsavel_acompanhamento_id).toBe(ID_GESTAO_2);
    expect(banco.historicos.map((h) => [h.acao, h.descricao])).toEqual([
      ['encaminhamento registrado', 'Destinatário: gestão'],
      ['responsável pelo acompanhamento alterado', null],
    ]);
    expect(res.body.responsavelAcompanhamento).toEqual({ id: ID_GESTAO_2, nome: `Usuário Fictício ${ID_GESTAO_2}` });
  });

  it('com o MESMO responsável atual: não é troca (sem histórico de troca)', async () => {
    const res = await encaminhar(O_ACOMPANHAMENTO, { destinatarioPerfil: 'GESTAO', responsavelAcompanhamentoId: ID_TUTOR });
    expect(res.status).toBe(201);
    expect(ocorrenciaNoBanco(O_ACOMPANHAMENTO).responsavel_acompanhamento_id).toBe(ID_TUTOR);
    expect(banco.historicos.map((h) => h.acao)).toEqual(['encaminhamento registrado']);
  });

  it('troca para responsável inválido (PROFESSOR) responde 400 sem gravar', async () => {
    const res = await encaminhar(O_ACOMPANHAMENTO, { destinatarioPerfil: 'GESTAO', responsavelAcompanhamentoId: ID_PROFESSOR });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ erro: MENSAGEM_RESPONSAVEL_INVALIDO });
    esperarNadaGravado();
  });

  it('a linha da ocorrência é sempre atualizada (trava contra concorrência), mesmo sem mudança', async () => {
    await encaminhar(O_ACOMPANHAMENTO, { destinatarioPerfil: 'GESTAO' });
    expect(escritas).toEqual([
      'encaminhamento.create',
      'ocorrencia.update',
      'historicoOcorrencia.createMany',
      'logAuditoria.create',
    ]);
  });
});

describe('RN15 — ocorrência ENCERRADO', () => {
  it('responde 409 sem gravar', async () => {
    const res = await encaminhar(O_ENCERRADA, { destinatarioPerfil: 'GESTAO' });
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ erro: MENSAGEM_OCORRENCIA_ENCERRADA_ENCAMINHAMENTO, codigo: CODIGOS_ERRO.OCORRENCIA_ENCERRADA });
    esperarNadaGravado();
  });

  it('409 vem antes da validação do responsável e do destinatário no banco', async () => {
    const res = await encaminhar(O_ENCERRADA, {
      destinatarioPerfil: 'TUTOR',
      destinatarioUsuarioId: ID_TUTOR_BLOQUEADO,
      responsavelAcompanhamentoId: ID_PROFESSOR,
    });
    expect(res.status).toBe(409);
    esperarNadaGravado();
  });
});

// ---------------------------------------------------------------------------
// RN03 — destinatário
// ---------------------------------------------------------------------------
describe('RN03 — usuário destinatário', () => {
  const casos = [
    ['TUTOR com usuário PEDAGOGICO', 'TUTOR', ID_PEDAGOGICO],
    ['TUTOR bloqueado', 'TUTOR', ID_TUTOR_BLOQUEADO],
    ['TUTOR inexistente', 'TUTOR', ID_INEXISTENTE],
    ['EQUIPE_PEDAGOGICA com usuário GESTAO', 'EQUIPE_PEDAGOGICA', ID_GESTAO],
    ['EQUIPE_PEDAGOGICA desativado', 'EQUIPE_PEDAGOGICA', ID_PEDAGOGICO_DESATIVADO],
    ['GESTAO com usuário TUTOR', 'GESTAO', ID_TUTOR],
    ['GESTAO com usuário PROFESSOR', 'GESTAO', ID_PROFESSOR],
  ];
  for (const [rotulo, perfil, usuarioId] of casos) {
    it(`${rotulo}: 400 sem gravar`, async () => {
      const res = await encaminhar(O_ABERTA, { destinatarioPerfil: perfil, destinatarioUsuarioId: usuarioId, responsavelAcompanhamentoId: ID_TUTOR });
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ erro: mensagemDestinatarioEncaminhamentoInvalido(perfil) });
      esperarNadaGravado();
    });
  }

  it('mensagens de destinatário inválido não têm posição nem nomes', () => {
    expect(mensagemDestinatarioEncaminhamentoInvalido('TUTOR')).toBe('O usuário destinatário precisa ter perfil Tutor e status ativo.');
    expect(mensagemDestinatarioEncaminhamentoInvalido('EQUIPE_PEDAGOGICA')).toBe('O usuário destinatário precisa ter perfil Pedagógico e status ativo.');
    expect(mensagemDestinatarioEncaminhamentoInvalido('GESTAO')).toBe('O usuário destinatário precisa ter perfil Gestão e status ativo.');
  });

  it('EQUIPE_PEDAGOGICA e GESTAO aceitam usuário opcional válido', async () => {
    const r1 = await encaminhar(O_ACOMPANHAMENTO, { destinatarioPerfil: 'EQUIPE_PEDAGOGICA' });
    const r2 = await encaminhar(O_ACOMPANHAMENTO, { destinatarioPerfil: 'GESTAO', destinatarioUsuarioId: ID_GESTAO_2 });
    expect([r1.status, r2.status]).toEqual([201, 201]);
    expect(r2.body.encaminhamentos.at(-1).destinatarioUsuario).toEqual({
      id: ID_GESTAO_2,
      nome: `Usuário Fictício ${ID_GESTAO_2}`,
      perfil: 'GESTAO',
    });
  });

  it('encaminhamento repetido para o mesmo destinatário é PERMITIDO (decisão do Rafael)', async () => {
    // O_ACOMPANHAMENTO já foi encaminhada ao ID_TUTOR (encaminhamento 2).
    const r1 = await encaminhar(O_ACOMPANHAMENTO, { destinatarioPerfil: 'TUTOR', destinatarioUsuarioId: ID_TUTOR });
    const r2 = await encaminhar(O_ACOMPANHAMENTO, { destinatarioPerfil: 'TUTOR', destinatarioUsuarioId: ID_TUTOR });
    expect([r1.status, r2.status]).toEqual([201, 201]);
    const doTutor = banco.encaminhamentos.filter(
      (e) => e.ocorrencia_id === O_ACOMPANHAMENTO && e.destinatario_usuario_id === ID_TUTOR,
    );
    expect(doTutor).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// RN17, RN08, RNF04 — autoria, dados pessoais
// ---------------------------------------------------------------------------
describe('autoria, histórico e auditoria sem dados pessoais', () => {
  it('registrado_por é sempre o usuário logado, mesmo se o corpo tentar outro; status do corpo é ignorado', async () => {
    const res = await encaminhar(
      O_ABERTA,
      {
        destinatarioPerfil: 'GESTAO',
        responsavelAcompanhamentoId: ID_TUTOR,
        registradoPorId: ID_PROFESSOR,
        registrado_por_id: ID_PROFESSOR,
        status: 'ENCERRADO',
        dataHora: '2020-01-01T00:00:00Z',
      },
      ID_PEDAGOGICO,
    );
    expect(res.status).toBe(201);
    const novo = banco.encaminhamentos.at(-1);
    expect(novo.registrado_por_id).toBe(ID_PEDAGOGICO);
    expect(novo.data_hora).toBe(AGORA_BANCO);
    expect(ocorrenciaNoBanco(O_ABERTA).status).toBe('EM_ACOMPANHAMENTO');
    expect(banco.historicos.every((h) => h.usuario_id === ID_PEDAGOGICO)).toBe(true);
    expect(banco.logs[0].usuario_id).toBe(ID_PEDAGOGICO);
  });

  it('histórico e auditoria só com textos fixos, mesmo com observação contendo nomes', async () => {
    await encaminhar(O_ABERTA, {
      destinatarioPerfil: 'TUTOR',
      destinatarioUsuarioId: ID_TUTOR_2,
      observacao: 'Conversar com Aluno Fictício 01 e Responsável Fictício',
      responsavelAcompanhamentoId: ID_TUTOR_2,
    });
    await encaminhar(O_ACOMPANHAMENTO, { destinatarioPerfil: 'GESTAO', responsavelAcompanhamentoId: ID_GESTAO_2 });
    const acoesFixas = Object.values(ACOES_HISTORICO);
    const descricoesFixas = [
      null,
      'Destinatário: tutor',
      'Destinatário: equipe pedagógica',
      'Destinatário: gestão',
      DESCRICAO_HISTORICO_ABERTO_PARA_ACOMPANHAMENTO,
    ];
    expect(banco.historicos).toHaveLength(5);
    for (const h of banco.historicos) {
      expect(acoesFixas).toContain(h.acao);
      expect(descricoesFixas).toContain(h.descricao);
    }
    expect(JSON.stringify([banco.historicos, banco.logs])).not.toMatch(/Fictíci|@|TESTE-/);
    expect(banco.logs.map((l) => l.recurso)).toEqual(['ocorrencias/1', 'ocorrencias/2']);
  });
});

// ---------------------------------------------------------------------------
// Resposta 201 = detalhe do GET
// ---------------------------------------------------------------------------
describe('resposta 201 com o detalhe completo', () => {
  it('GESTAO: 201 igual ao GET /ocorrencias/{id} logo depois (com codigoEscolar, comunicações e providências)', async () => {
    const res = await encaminhar(O_ACOMPANHAMENTO, { destinatarioPerfil: 'GESTAO', responsavelAcompanhamentoId: ID_GESTAO_2 }, ID_GESTAO);
    expect(res.status).toBe(201);
    const detalhe = await getDetalhe(O_ACOMPANHAMENTO, ID_GESTAO);
    expect(res.body).toEqual(detalhe.body);
    expect(res.body.estudantes[0]).toHaveProperty('codigoEscolar', 'TESTE-0001');
    expect(res.body.comunicacoes).toHaveLength(1);
    expect(res.body.providencias).toHaveLength(1);
    expect(res.body.encaminhamentos.map((e) => e.id)).toEqual([2, 4]);
  });

  it('PEDAGOGICO: 201 igual ao GET e SEM codigoEscolar (RN20)', async () => {
    const res = await encaminhar(O_ABERTA, { destinatarioPerfil: 'GESTAO', responsavelAcompanhamentoId: ID_TUTOR }, ID_PEDAGOGICO);
    expect(res.status).toBe(201);
    const detalhe = await getDetalhe(O_ABERTA, ID_PEDAGOGICO);
    expect(res.body).toEqual(detalhe.body);
    for (const estudante of res.body.estudantes) expect(estudante).not.toHaveProperty('codigoEscolar');
    expect(JSON.stringify(res.body)).not.toMatch(/@sisto|hash-ficticio|TESTE-/);
  });
});

// ---------------------------------------------------------------------------
// Transação
// ---------------------------------------------------------------------------
describe('transação única SERIALIZABLE', () => {
  it('usa uma única transação serializável', async () => {
    const res = await encaminhar(O_ACOMPANHAMENTO, { destinatarioPerfil: 'GESTAO' });
    expect(res.status).toBe(201);
    expect(mocks.$transaction).toHaveBeenCalledTimes(1);
    expect(mocks.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: 'Serializable' });
  });

  for (const ponto of ['ocorrencia.update', 'historicoOcorrencia.createMany', 'logAuditoria.create']) {
    it(`falha em ${ponto} desfaz tudo (nada gravado) e responde 500`, async () => {
      mocks.$transaction.mockImplementationOnce(async (operacao) => {
        const copia = structuredClone(banco);
        const tx = clientMock();
        const [modelo, operacaoAlvo] = ponto.split('.');
        tx[modelo][operacaoAlvo] = async () => {
          throw new Error('falha fictícia');
        };
        try {
          return await operacao(tx);
        } catch (erro) {
          banco = copia;
          throw erro;
        }
      });
      const res = await encaminhar(O_ABERTA, { destinatarioPerfil: 'GESTAO', responsavelAcompanhamentoId: ID_TUTOR });
      expect(res.status).toBe(500);
      expect(res.body).toEqual({ erro: 'Erro interno do servidor' });
      esperarNadaGravado();
    });
  }

  it('P2034 seguido de sucesso responde 201 (transação repetida)', async () => {
    mocks.$transaction.mockRejectedValueOnce(erroPrisma('P2034'));
    const res = await encaminhar(O_ABERTA, { destinatarioPerfil: 'GESTAO', responsavelAcompanhamentoId: ID_TUTOR });
    expect(res.status).toBe(201);
    expect(mocks.$transaction).toHaveBeenCalledTimes(2);
    expect(banco.encaminhamentos).toHaveLength(4);
  });

  it('P2034 e, na repetição, a ocorrência já foi encerrada por outra operação: 409 de encerrada (status relido)', async () => {
    mocks.$transaction.mockImplementationOnce(async () => {
      Object.assign(ocorrenciaNoBanco(O_ACOMPANHAMENTO), { status: 'ENCERRADO' });
      throw erroPrisma('P2034');
    });
    const res = await encaminhar(O_ACOMPANHAMENTO, { destinatarioPerfil: 'GESTAO' });
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ erro: MENSAGEM_OCORRENCIA_ENCERRADA_ENCAMINHAMENTO, codigo: CODIGOS_ERRO.OCORRENCIA_ENCERRADA });
    expect(banco.encaminhamentos).toHaveLength(3);
  });

  it('P2034 e, na repetição, outro encaminhamento já definiu o responsável: sem 400 e com histórico de troca', async () => {
    mocks.$transaction.mockImplementationOnce(async () => {
      Object.assign(ocorrenciaNoBanco(O_ABERTA), { status: 'EM_ACOMPANHAMENTO', responsavel_acompanhamento_id: ID_TUTOR });
      throw erroPrisma('P2034');
    });
    const res = await encaminhar(O_ABERTA, { destinatarioPerfil: 'GESTAO', responsavelAcompanhamentoId: ID_PEDAGOGICO });
    expect(res.status).toBe(201);
    expect(banco.historicos.map((h) => h.acao)).toEqual([
      'encaminhamento registrado',
      'responsável pelo acompanhamento alterado',
    ]);
  });

  it('esgotadas as tentativas, responde 409 pedindo para tentar de novo', async () => {
    mocks.$transaction.mockRejectedValue(erroPrisma('P2034'));
    const res = await encaminhar(O_ABERTA, { destinatarioPerfil: 'GESTAO', responsavelAcompanhamentoId: ID_TUTOR });
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ erro: MENSAGEM_CONFLITO_CONCORRENTE_ENCAMINHAMENTO, codigo: CODIGOS_ERRO.CONFLITO_CONCORRENTE });
    expect(mocks.$transaction).toHaveBeenCalledTimes(TENTATIVAS_TRANSACAO);
    esperarNadaGravado();
  });

  it('o service aceita db injetado', async () => {
    const db = { $transaction: async (op) => op(clientMock()) };
    const ocorrencia = await registrarEncaminhamento(
      String(O_ABERTA),
      { destinatarioPerfil: 'EQUIPE_PEDAGOGICA', responsavelAcompanhamentoId: ID_PEDAGOGICO },
      { id: ID_GESTAO, perfil: 'GESTAO' },
      { db },
    );
    expect(ocorrencia).toMatchObject({ id: O_ABERTA, status: 'EM_ACOMPANHAMENTO', responsavelAcompanhamento: { id: ID_PEDAGOGICO } });
  });
});
