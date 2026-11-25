// Testes de POST /ocorrencias/{id}/providencias (Issue #81, UC04, RN04, RN08,
// RN17, RN19, RN22, RNF04) — somente dados fictícios (RN05).
// Não dependem do banco: src/lib/prisma.js é substituído por um "banco" em
// memória que AVALIA o `where` gerado pelo service (mesmo modelo de
// ocorrencias-comunicacao.test.js). A transação do mock faz rollback
// (cópia do banco) quando a operação falha.
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
  providencia: () => ({ data_hora: AGORA_BANCO }),
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
  MENSAGEM_CONFLITO_CONCORRENTE_PROVIDENCIA,
  MENSAGEM_CORPO_PROVIDENCIA_INVALIDO,
  MENSAGEM_DESCRICAO_OBRIGATORIA,
  MENSAGEM_ID_OCORRENCIA_INVALIDO,
  MENSAGEM_OCORRENCIA_ABERTA_PROVIDENCIA,
  MENSAGEM_OCORRENCIA_ENCERRADA_PROVIDENCIA,
  MENSAGEM_OCORRENCIA_NAO_ENCONTRADA,
  MENSAGEM_PROVIDENCIA_SEM_PERMISSAO,
  MENSAGEM_TEXTO_CARACTERE_INVALIDO,
  PERFIS_PROVIDENCIA,
  TAMANHO_MAXIMO_TEXTO_LONGO,
  mensagemTextoLongo,
  registrarProvidencia,
  validarProvidencia,
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
const ID_TUTOR_2 = 7;
const ID_INEXISTENTE = 999;

// O ID_TUTOR NÃO vê as ocorrências 1 e 2. Vê a 3 a 9, cada uma por UMA
// condição da RN19; só é o responsável pelo acompanhamento da 3 e da 6.
const O_ABERTA = 1; // registrada pelo Professor, sem vínculo com o ID_TUTOR
const O_ACOMPANHAMENTO = 2; // registrada pelo Professor; responsável: ID_TUTOR_2; já tem providência
const O_ENCERRADA = 3; // responsável: ID_TUTOR (ele a vê por ser o responsável)
const O_TUTOR_REGISTROU = 4; // ABERTO, profissional responsável: ID_TUTOR
const O_TUTOR_DESTINATARIO = 5; // EM_ACOMPANHAMENTO, encaminhada ao ID_TUTOR; responsável: ID_GESTAO
const O_TUTOR_RESPONSAVEL = 6; // EM_ACOMPANHAMENTO, responsável: ID_TUTOR
const O_TUTOR_TUTORADO = 7; // EM_ACOMPANHAMENTO, envolve tutorado do ID_TUTOR; responsável: ID_PEDAGOGICO
const O_ENCERRADA_TUTORADO = 8; // ENCERRADO, envolve tutorado do ID_TUTOR; responsável: ID_TUTOR_2

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
  const encaminhamento = (id, ocorrenciaId, perfil, usuarioId = null) => ({
    id,
    ocorrencia_id: ocorrenciaId,
    destinatario_perfil: perfil,
    destinatario_usuario_id: usuarioId,
    registrado_por_id: ID_PROFESSOR,
    data_hora: data(`2026-10-0${ocorrenciaId}T10:05:00.000Z`),
    observacao: null,
  });
  const encerrada = { data_encerramento: data('2026-10-20T10:00:00.000Z') };

  return {
    usuarios: [
      usuario(ID_PROFESSOR, 'PROFESSOR'),
      usuario(ID_TUTOR, 'TUTOR'),
      usuario(ID_GESTAO, 'GESTAO'),
      usuario(ID_PEDAGOGICO, 'PEDAGOGICO'),
      usuario(ID_TECNICO, 'TECNICO_ADMINISTRATIVO'),
      usuario(ID_TROCA_PENDENTE, 'GESTAO', { troca_senha_obrigatoria: true }),
      usuario(ID_TUTOR_2, 'TUTOR'),
    ],
    turmas: [{ id: 1, nome: '6º A', etapa: 'Ensino Fundamental', ano_letivo: 2026 }],
    categorias: [{ id: 1, nome: 'Indisciplina', descricao: null }],
    estudantes: [
      { id: 1, nome_completo: 'Estudante Fictício Alfa', codigo_escolar: 'TESTE-0001', turma_id: 1, tutor_id: ID_TUTOR },
      { id: 2, nome_completo: 'Estudante Fictício Beta', codigo_escolar: 'TESTE-0002', turma_id: 1, tutor_id: null },
    ],
    ocorrencias: [
      ocorrencia(O_ABERTA, 'ABERTO'),
      ocorrencia(O_ACOMPANHAMENTO, 'EM_ACOMPANHAMENTO', { responsavel_acompanhamento_id: ID_TUTOR_2 }),
      ocorrencia(O_ENCERRADA, 'ENCERRADO', { responsavel_acompanhamento_id: ID_TUTOR, ...encerrada }),
      ocorrencia(O_TUTOR_REGISTROU, 'ABERTO', { profissional_responsavel_id: ID_TUTOR }),
      ocorrencia(O_TUTOR_DESTINATARIO, 'EM_ACOMPANHAMENTO', { responsavel_acompanhamento_id: ID_GESTAO }),
      ocorrencia(O_TUTOR_RESPONSAVEL, 'EM_ACOMPANHAMENTO', { responsavel_acompanhamento_id: ID_TUTOR }),
      ocorrencia(O_TUTOR_TUTORADO, 'EM_ACOMPANHAMENTO', { responsavel_acompanhamento_id: ID_PEDAGOGICO }),
      ocorrencia(O_ENCERRADA_TUTORADO, 'ENCERRADO', { responsavel_acompanhamento_id: ID_TUTOR_2, ...encerrada }),
    ],
    ocorrenciasEstudantes: [
      { ocorrencia_id: O_ABERTA, estudante_id: 2 },
      { ocorrencia_id: O_ACOMPANHAMENTO, estudante_id: 2 },
      { ocorrencia_id: O_ENCERRADA, estudante_id: 2 },
      { ocorrencia_id: O_TUTOR_REGISTROU, estudante_id: 2 },
      { ocorrencia_id: O_TUTOR_DESTINATARIO, estudante_id: 2 },
      { ocorrencia_id: O_TUTOR_RESPONSAVEL, estudante_id: 2 },
      { ocorrencia_id: O_TUTOR_TUTORADO, estudante_id: 1 },
      { ocorrencia_id: O_TUTOR_TUTORADO, estudante_id: 2 },
      { ocorrencia_id: O_ENCERRADA_TUTORADO, estudante_id: 1 },
    ],
    encaminhamentos: [
      encaminhamento(1, O_ABERTA, 'GESTAO'),
      encaminhamento(2, O_ACOMPANHAMENTO, 'TUTOR', ID_TUTOR_2),
      encaminhamento(3, O_ENCERRADA, 'GESTAO'),
      encaminhamento(4, O_TUTOR_REGISTROU, 'GESTAO'),
      encaminhamento(5, O_TUTOR_DESTINATARIO, 'TUTOR', ID_TUTOR),
      encaminhamento(6, O_TUTOR_RESPONSAVEL, 'GESTAO'),
      encaminhamento(7, O_TUTOR_TUTORADO, 'GESTAO'),
      encaminhamento(8, O_ENCERRADA_TUTORADO, 'GESTAO'),
    ],
    comunicacoes: [
      { id: 1, ocorrencia_id: O_ACOMPANHAMENTO, destinatario: 'Família fictícia', meio: 'Telefone', descricao: 'Contato fictício anterior.', registrado_por_id: ID_GESTAO, data_hora: data('2026-10-03T14:00:00.000Z') },
    ],
    providencias: [
      { id: 1, ocorrencia_id: O_ACOMPANHAMENTO, descricao: 'Providência fictícia anterior.', registrado_por_id: ID_PEDAGOGICO, data_hora: data('2026-10-04T09:00:00.000Z') },
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

const providenciar = (ocorrenciaId, corpo, usuarioId = ID_GESTAO) => {
  const req = request(app).post(`/ocorrencias/${ocorrenciaId}/providencias`);
  return usuarioId ? req.set('Authorization', `Bearer ${token(usuarioId)}`).send(corpo) : req.send(corpo);
};
const getDetalhe = (id, usuarioId) =>
  request(app).get(`/ocorrencias/${id}`).set('Authorization', `Bearer ${token(usuarioId)}`);

const ocorrenciaNoBanco = (id) => banco.ocorrencias.find((o) => o.id === id);

/** Nada foi gravado (banco igual ao inicial). */
function esperarNadaGravado() {
  expect(banco).toEqual(bancoInicial);
}

function erroPrisma(code) {
  const erro = new Error(`Erro fictício do Prisma (${code})`);
  erro.code = code;
  return erro;
}

/** Corpo válido fictício. */
const CORPO = Object.freeze({
  descricao: 'Conversa fictícia com o estudante e orientação sobre a convivência.',
});
const corpo = (extra = {}) => ({ ...CORPO, ...extra });

// ---------------------------------------------------------------------------
// Autenticação e permissões (rota)
// ---------------------------------------------------------------------------
describe('POST /ocorrencias/{id}/providencias — autenticação e perfis (Seção 4, RN22)', () => {
  it('PERFIS_PROVIDENCIA são exatamente GESTAO, PEDAGOGICO e TUTOR', () => {
    expect([...PERFIS_PROVIDENCIA].sort()).toEqual(['GESTAO', 'PEDAGOGICO', 'TUTOR']);
  });

  it('a mensagem do 403 do service é a mesma do 403 por perfil do middleware', () => {
    expect(MENSAGEM_PROVIDENCIA_SEM_PERMISSAO).toBe(MENSAGEM_PERFIL_SEM_PERMISSAO);
  });

  it('sem token responde 401 sem gravar', async () => {
    const res = await providenciar(O_ACOMPANHAMENTO, corpo(), null);
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ erro: MENSAGEM_NAO_AUTENTICADO });
    expect(mocks.$transaction).not.toHaveBeenCalled();
    esperarNadaGravado();
  });

  for (const [rotulo, id] of [
    ['PROFESSOR', ID_PROFESSOR],
    ['TECNICO_ADMINISTRATIVO', ID_TECNICO],
  ]) {
    it(`${rotulo} recebe 403 sem gravar (mesmo com corpo válido)`, async () => {
      const res = await providenciar(O_ACOMPANHAMENTO, corpo(), id);
      expect(res.status).toBe(403);
      expect(res.body).toEqual({ erro: MENSAGEM_PERFIL_SEM_PERMISSAO });
      expect(mocks.$transaction).not.toHaveBeenCalled();
      esperarNadaGravado();
    });

    it(`${rotulo} recebe 403 também em ocorrência inexistente, com id inválido e com corpo inválido`, async () => {
      const r1 = await providenciar(ID_INEXISTENTE, corpo(), id);
      const r2 = await providenciar(O_ACOMPANHAMENTO, {}, id);
      const r3 = await providenciar('abc', corpo(), id);
      expect([r1.status, r2.status, r3.status]).toEqual([403, 403, 403]);
      esperarNadaGravado();
    });
  }

  it('PROFESSOR que registrou a ocorrência (em acompanhamento) também recebe 403 (RN22)', async () => {
    // O_ACOMPANHAMENTO foi registrada pelo ID_PROFESSOR (ele a vê pela RN19).
    expect(ocorrenciaNoBanco(O_ACOMPANHAMENTO).profissional_responsavel_id).toBe(ID_PROFESSOR);
    const res = await providenciar(O_ACOMPANHAMENTO, corpo(), ID_PROFESSOR);
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ erro: MENSAGEM_PERFIL_SEM_PERMISSAO });
    esperarNadaGravado();
  });

  it('troca de senha pendente responde 403 sem gravar', async () => {
    const res = await providenciar(O_ACOMPANHAMENTO, corpo(), ID_TROCA_PENDENTE);
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ erro: MENSAGEM_TROCA_SENHA_OBRIGATORIA, codigo: CODIGOS_ERRO.TROCA_SENHA_OBRIGATORIA });
    expect(mocks.$transaction).not.toHaveBeenCalled();
    esperarNadaGravado();
  });

  for (const [rotulo, id] of [['GESTAO', ID_GESTAO], ['PEDAGOGICO', ID_PEDAGOGICO]]) {
    it(`${rotulo} registra em qualquer ocorrência em acompanhamento, sem ser o responsável (201)`, async () => {
      for (const ocorrenciaId of [O_ACOMPANHAMENTO, O_TUTOR_DESTINATARIO, O_TUTOR_RESPONSAVEL, O_TUTOR_TUTORADO]) {
        const res = await providenciar(ocorrenciaId, corpo(), id);
        expect(res.status, `ocorrência ${ocorrenciaId}`).toBe(201);
        expect(res.body.id).toBe(ocorrenciaId);
      }
      expect(banco.providencias).toHaveLength(5);
    });
  }
});

// ---------------------------------------------------------------------------
// RN19/RN22 — Tutor: visibilidade (404) e responsável pelo acompanhamento (403)
// ---------------------------------------------------------------------------
describe('RN19/RN22 — Tutor', () => {
  for (const [rotulo, ocorrenciaId] of [
    ['registrada pelo Professor, sem vínculo (aberta)', O_ABERTA],
    ['em acompanhamento por outro tutor', O_ACOMPANHAMENTO],
  ]) {
    it(`que não vê a ocorrência (${rotulo}): 404 igual à inexistente, sem gravar`, async () => {
      const res = await providenciar(ocorrenciaId, corpo(), ID_TUTOR);
      const inexistente = await providenciar(ID_INEXISTENTE, corpo(), ID_TUTOR);
      expect(res.status).toBe(404);
      expect(res.body).toEqual({ erro: MENSAGEM_OCORRENCIA_NAO_ENCONTRADA });
      expect(res.body).toEqual(inexistente.body);
      esperarNadaGravado();
    });
  }

  for (const [condicao, ocorrenciaId] of [
    ['registrou a ocorrência (aberta: o 403 vem antes do 409)', O_TUTOR_REGISTROU],
    ['é usuário destinatário de um encaminhamento', O_TUTOR_DESTINATARIO],
    ['tutora um estudante envolvido', O_TUTOR_TUTORADO],
    ['tutora um estudante envolvido (encerrada: o 403 vem antes do 409)', O_ENCERRADA_TUTORADO],
  ]) {
    it(`que vê porque ${condicao}, sem ser o responsável: 403 sem gravar`, async () => {
      const res = await providenciar(ocorrenciaId, corpo(), ID_TUTOR);
      expect(res.status).toBe(403);
      expect(res.body).toEqual({ erro: MENSAGEM_PERFIL_SEM_PERMISSAO });
      esperarNadaGravado();
    });
  }

  it('o Tutor que vê sem ser o responsável consegue consultar o detalhe (prova de que o 403 não é falta de visibilidade)', async () => {
    const res = await getDetalhe(O_TUTOR_TUTORADO, ID_TUTOR);
    expect(res.status).toBe(200);
  });

  it('responsável pelo acompanhamento: 201 com a providência registrada por ele', async () => {
    const res = await providenciar(O_TUTOR_RESPONSAVEL, corpo(), ID_TUTOR);
    expect(res.status).toBe(201);
    expect(res.body.id).toBe(O_TUTOR_RESPONSAVEL);
    expect(banco.providencias.at(-1)).toMatchObject({
      ocorrencia_id: O_TUTOR_RESPONSAVEL,
      registrado_por_id: ID_TUTOR,
    });
  });

  it('outro Tutor responsável pela ocorrência dele também registra (201)', async () => {
    const res = await providenciar(O_ACOMPANHAMENTO, corpo(), ID_TUTOR_2);
    expect(res.status).toBe(201);
  });

  it('responsável por ocorrência ENCERRADO: 409 (passa da permissão e para no status)', async () => {
    const res = await providenciar(O_ENCERRADA, corpo(), ID_TUTOR);
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ erro: MENSAGEM_OCORRENCIA_ENCERRADA_PROVIDENCIA, codigo: CODIGOS_ERRO.OCORRENCIA_ENCERRADA });
    esperarNadaGravado();
  });

  it('o 404 do Tutor sem acesso consulta com o filtro de visibilidade na própria consulta', async () => {
    const consultas = [];
    mocks.$transaction.mockImplementationOnce(async (operacao) => {
      const tx = clientMock();
      const original = tx.ocorrencia.findFirst;
      tx.ocorrencia.findFirst = async (args) => {
        consultas.push(args.where);
        return original(args);
      };
      return operacao(tx);
    });
    const res = await providenciar(O_ABERTA, corpo(), ID_TUTOR);
    expect(res.status).toBe(404);
    expect(consultas).toHaveLength(1);
    expect(consultas[0].AND[0]).toEqual({ id: O_ABERTA });
    expect(consultas[0].AND[1]).toHaveProperty('OR');
  });

  it('o service recusa o Tutor não responsável com 403 mesmo chamado direto', async () => {
    const db = { $transaction: (op, opcoes) => mocks.$transaction(op, opcoes) };
    await expect(
      registrarProvidencia(String(O_TUTOR_TUTORADO), corpo(), { id: ID_TUTOR, perfil: 'TUTOR' }, { db }),
    ).rejects.toMatchObject({ status: 403, message: MENSAGEM_PROVIDENCIA_SEM_PERMISSAO });
    esperarNadaGravado();
  });
});

// ---------------------------------------------------------------------------
// id da URL
// ---------------------------------------------------------------------------
describe('id da URL', () => {
  for (const id of ['abc', '0', '-1', '1.5', '01', '2147483648']) {
    it(`id "${id}" responde 400 sem abrir transação`, async () => {
      const res = await providenciar(id, corpo());
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ erro: MENSAGEM_ID_OCORRENCIA_INVALIDO });
      expect(mocks.$transaction).not.toHaveBeenCalled();
    });
  }

  it('ocorrência inexistente responde 404 sem gravar', async () => {
    const res = await providenciar(ID_INEXISTENTE, corpo());
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ erro: MENSAGEM_OCORRENCIA_NAO_ENCONTRADA });
    esperarNadaGravado();
  });

  it('maior Int do PostgreSQL inexistente responde 404 (não 500)', async () => {
    const res = await providenciar('2147483647', corpo());
    expect(res.status).toBe(404);
  });

  it('id inválido vem antes do corpo inválido (400 do id)', async () => {
    const res = await providenciar('abc', {});
    expect(res.body).toEqual({ erro: MENSAGEM_ID_OCORRENCIA_INVALIDO });
  });
});

// ---------------------------------------------------------------------------
// Validação do corpo (sem banco)
// ---------------------------------------------------------------------------
describe('validação do corpo (400 antes de qualquer consulta)', () => {
  const casos = [
    ['corpo array', [], MENSAGEM_CORPO_PROVIDENCIA_INVALIDO],
    ['corpo vazio (sem campos)', {}, MENSAGEM_DESCRICAO_OBRIGATORIA],
    ['descricao ausente', { outro: 'x' }, MENSAGEM_DESCRICAO_OBRIGATORIA],
    ['descricao null', { descricao: null }, MENSAGEM_DESCRICAO_OBRIGATORIA],
    ['descricao vazia', { descricao: '' }, MENSAGEM_DESCRICAO_OBRIGATORIA],
    ['descricao só espaços', { descricao: '   \t\n ' }, MENSAGEM_DESCRICAO_OBRIGATORIA],
    ['descricao número', { descricao: 123 }, MENSAGEM_DESCRICAO_OBRIGATORIA],
    ['descricao booleano', { descricao: true }, MENSAGEM_DESCRICAO_OBRIGATORIA],
    ['descricao array', { descricao: ['texto'] }, MENSAGEM_DESCRICAO_OBRIGATORIA],
    ['descricao objeto', { descricao: { texto: 'x' } }, MENSAGEM_DESCRICAO_OBRIGATORIA],
    ['descricao com 5001 caracteres', { descricao: 'x'.repeat(5001) }, mensagemTextoLongo('descricao')],
    ['descricao com U+0000', { descricao: 'Texto fictício\u0000 com nulo' }, MENSAGEM_TEXTO_CARACTERE_INVALIDO],
    ['descricao só com U+0000', { descricao: '\u0000' }, MENSAGEM_TEXTO_CARACTERE_INVALIDO],
  ];

  for (const [rotulo, corpoEnviado, mensagem] of casos) {
    it(`${rotulo}: 400`, async () => {
      const res = await providenciar(O_ACOMPANHAMENTO, corpoEnviado);
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ erro: mensagem });
      expect(mocks.$transaction).not.toHaveBeenCalled();
      esperarNadaGravado();
    });
  }

  it('JSON malformado responde 400 sem gravar', async () => {
    const res = await request(app)
      .post(`/ocorrencias/${O_ACOMPANHAMENTO}/providencias`)
      .set('Authorization', `Bearer ${token(ID_GESTAO)}`)
      .set('Content-Type', 'application/json')
      .send('{"descricao":');
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('erro');
    esperarNadaGravado();
  });

  it('corpo inválido em ocorrência inexistente, aberta ou encerrada responde 400 (corpo vem antes do 404/409)', async () => {
    const r1 = await providenciar(ID_INEXISTENTE, { descricao: '' });
    const r2 = await providenciar(O_ABERTA, { descricao: '' });
    const r3 = await providenciar(O_ENCERRADA, { descricao: '' });
    expect([r1.status, r2.status, r3.status]).toEqual([400, 400, 400]);
    expect(r1.body).toEqual({ erro: MENSAGEM_DESCRICAO_OBRIGATORIA });
  });

  it('corpo inválido do Tutor que não vê ou não é o responsável responde 400 (corpo vem antes do 404/403)', async () => {
    const r1 = await providenciar(O_ABERTA, {}, ID_TUTOR);
    const r2 = await providenciar(O_TUTOR_TUTORADO, {}, ID_TUTOR);
    expect([r1.status, r2.status]).toEqual([400, 400]);
    expect(mocks.$transaction).not.toHaveBeenCalled();
  });

  it('o limite é o de 5000 caracteres da Seção 11', () => {
    expect(TAMANHO_MAXIMO_TEXTO_LONGO).toBe(5000);
    expect(mensagemTextoLongo('descricao')).toBe('O campo descricao deve ter no máximo 5000 caracteres.');
  });
});

describe('limites, normalização e campos fora do contrato', () => {
  it('exatamente 5000 caracteres (com espaços nas pontas) aceita e grava sem os espaços', async () => {
    const res = await providenciar(O_ACOMPANHAMENTO, { descricao: `  ${'x'.repeat(5000)} \n` });
    expect(res.status).toBe(201);
    expect(banco.providencias.at(-1).descricao).toBe('x'.repeat(5000));
  });

  it('conta em unidades UTF-16: 2500 emojis (5000 unidades) aceita; mais um caractere recusa', async () => {
    const emojis = '😀'.repeat(2500);
    const r1 = await providenciar(O_ACOMPANHAMENTO, { descricao: emojis });
    expect(r1.status).toBe(201);
    const r2 = await providenciar(O_ACOMPANHAMENTO, { descricao: `${emojis}a` });
    expect(r2.status).toBe(400);
    expect(r2.body).toEqual({ erro: mensagemTextoLongo('descricao') });
  });

  it('normaliza para NFC antes de contar e gravar (acento decomposto)', async () => {
    const decomposto = 'Reunião com a família'; // "ã" decomposto
    const res = await providenciar(O_ACOMPANHAMENTO, { descricao: `  ${decomposto} fictícia  ` });
    expect(res.status).toBe(201);
    expect(banco.providencias.at(-1).descricao).toBe('Reunião com a família fictícia');
    // 5000 caracteres após NFC (cada "é" decomposto ocupa 2 unidades antes).
    const r2 = await providenciar(O_ACOMPANHAMENTO, { descricao: 'é'.repeat(5000) });
    expect(r2.status).toBe(201);
    expect(banco.providencias.at(-1).descricao).toBe('é'.repeat(5000));
  });

  it('validarProvidencia ignora campos fora do contrato', () => {
    expect(
      validarProvidencia({
        ...CORPO,
        registradoPorId: 99,
        dataHora: '2020-01-01T00:00:00Z',
        ocorrenciaId: 5,
        status: 'ENCERRADO',
        id: 77,
      }),
    ).toEqual({ descricao: CORPO.descricao });
  });
});

// ---------------------------------------------------------------------------
// RN04 — status da ocorrência
// ---------------------------------------------------------------------------
describe('RN04 — só em "em acompanhamento"', () => {
  for (const [rotulo, id] of [['GESTAO', ID_GESTAO], ['PEDAGOGICO', ID_PEDAGOGICO]]) {
    it(`ABERTO: 409 sem gravar (${rotulo})`, async () => {
      const res = await providenciar(O_ABERTA, corpo(), id);
      expect(res.status).toBe(409);
      expect(res.body).toEqual({ erro: MENSAGEM_OCORRENCIA_ABERTA_PROVIDENCIA, codigo: CODIGOS_ERRO.OCORRENCIA_ABERTA });
      esperarNadaGravado();
    });

    it(`ENCERRADO: 409 sem gravar (${rotulo})`, async () => {
      const res = await providenciar(O_ENCERRADA, corpo(), id);
      expect(res.status).toBe(409);
      expect(res.body).toEqual({ erro: MENSAGEM_OCORRENCIA_ENCERRADA_PROVIDENCIA, codigo: CODIGOS_ERRO.OCORRENCIA_ENCERRADA });
      esperarNadaGravado();
    });
  }

  it('mensagens do 409 de status são claras', () => {
    expect(MENSAGEM_OCORRENCIA_ABERTA_PROVIDENCIA).toMatch(/em acompanhamento/);
    expect(MENSAGEM_OCORRENCIA_ABERTA_PROVIDENCIA).toMatch(/aberta/);
    expect(MENSAGEM_OCORRENCIA_ENCERRADA_PROVIDENCIA).toBe('Ocorrência encerrada não recebe providências.');
  });

  it('EM_ACOMPANHAMENTO: aceita e NÃO muda o status, o responsável nem a data de encerramento', async () => {
    const antes = { ...ocorrenciaNoBanco(O_ACOMPANHAMENTO) };
    const res = await providenciar(O_ACOMPANHAMENTO, corpo());
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('EM_ACOMPANHAMENTO');
    expect(res.body.dataEncerramento).toBeNull();
    expect(ocorrenciaNoBanco(O_ACOMPANHAMENTO)).toEqual(antes);
  });

  it('a linha da ocorrência é sempre atualizada (trava contra concorrência), com o mesmo status', async () => {
    const update = [];
    mocks.$transaction.mockImplementationOnce(async (operacao) => {
      const tx = clientMock();
      const original = tx.ocorrencia.update;
      tx.ocorrencia.update = async (args) => {
        update.push(args);
        return original(args);
      };
      return operacao(tx);
    });
    await providenciar(O_ACOMPANHAMENTO, corpo());
    expect(escritas).toEqual([
      'providencia.create',
      'ocorrencia.update',
      'historicoOcorrencia.create',
      'logAuditoria.create',
    ]);
    expect(update).toEqual([
      { where: { id: O_ACOMPANHAMENTO }, data: { status: 'EM_ACOMPANHAMENTO' }, select: { id: true } },
    ]);
  });
});

// ---------------------------------------------------------------------------
// Gravação, autoria (RN17), histórico (RN08) e auditoria (RNF04)
// ---------------------------------------------------------------------------
describe('gravação, autoria, histórico e auditoria', () => {
  it('grava a providência, o histórico e a auditoria com o usuário logado', async () => {
    const res = await providenciar(O_ACOMPANHAMENTO, corpo(), ID_PEDAGOGICO);
    expect(res.status).toBe(201);
    expect(banco.providencias).toHaveLength(2);
    expect(banco.providencias[1]).toEqual({
      id: 2,
      ocorrencia_id: O_ACOMPANHAMENTO,
      descricao: CORPO.descricao,
      registrado_por_id: ID_PEDAGOGICO,
      data_hora: AGORA_BANCO, // momento do registro, preenchido pelo banco (RN17)
    });
    expect(banco.historicos).toEqual([
      {
        id: 1,
        ocorrencia_id: O_ACOMPANHAMENTO,
        usuario_id: ID_PEDAGOGICO,
        acao: 'providência registrada',
        descricao: null,
        data_hora: AGORA_BANCO,
      },
    ]);
    expect(banco.logs).toEqual([
      { id: 1, usuario_id: ID_PEDAGOGICO, acao: 'providência registrada', recurso: 'ocorrencias/2', data_hora: AGORA_BANCO },
    ]);
  });

  it('constantes de histórico e auditoria são as esperadas', () => {
    expect(ACOES_HISTORICO.PROVIDENCIA_REGISTRADA).toBe('providência registrada');
    expect(ACOES_AUDITORIA.PROVIDENCIA_REGISTRADA).toBe('providência registrada');
  });

  it('registradoPor e dataHora vêm do sistema, mesmo se o corpo trouxer outros valores; campos extras ignorados', async () => {
    const res = await providenciar(
      O_TUTOR_RESPONSAVEL,
      corpo({
        registradoPorId: ID_GESTAO,
        registrado_por_id: ID_GESTAO,
        registradoPor: { id: ID_GESTAO },
        dataHora: '2020-01-01T00:00:00Z',
        data_hora: '2020-01-01T00:00:00Z',
        ocorrenciaId: O_ACOMPANHAMENTO,
        ocorrencia_id: O_ACOMPANHAMENTO,
        status: 'ENCERRADO',
        id: 50,
      }),
      ID_TUTOR,
    );
    expect(res.status).toBe(201);
    const nova = banco.providencias.at(-1);
    expect(nova).toEqual({
      id: 2,
      ocorrencia_id: O_TUTOR_RESPONSAVEL,
      descricao: CORPO.descricao,
      registrado_por_id: ID_TUTOR,
      data_hora: AGORA_BANCO,
    });
    expect(ocorrenciaNoBanco(O_TUTOR_RESPONSAVEL).status).toBe('EM_ACOMPANHAMENTO');
    expect(banco.historicos[0].usuario_id).toBe(ID_TUTOR);
    expect(banco.logs[0]).toMatchObject({ usuario_id: ID_TUTOR, recurso: `ocorrencias/${O_TUTOR_RESPONSAVEL}` });
    expect(res.body.providencias.at(-1)).toEqual({
      id: 2,
      descricao: CORPO.descricao,
      dataHora: AGORA_BANCO.toISOString(),
      registradoPor: { id: ID_TUTOR, nome: `Usuário Fictício ${ID_TUTOR}` },
    });
  });

  it('RN08/RNF06: histórico e auditoria SEM o conteúdo da providência nem dados pessoais', async () => {
    await providenciar(O_ACOMPANHAMENTO, {
      descricao: 'Conversa fictícia com Estudante Fictício Beta e a mãe, contato@familia.exemplo, (11) 90000-0000.',
    });
    await providenciar(O_TUTOR_RESPONSAVEL, corpo(), ID_TUTOR);
    expect(banco.historicos).toHaveLength(2);
    for (const h of banco.historicos) {
      expect(h.acao).toBe('providência registrada');
      expect(h.descricao).toBeNull();
    }
    const gravado = JSON.stringify([banco.historicos, banco.logs]);
    expect(gravado).not.toMatch(/Fictíci|Conversa|90000|@|TESTE-|orientação/);
    expect(banco.logs.map((l) => [l.acao, l.recurso])).toEqual([
      ['providência registrada', 'ocorrencias/2'],
      ['providência registrada', 'ocorrencias/6'],
    ]);
  });

  it('várias providências na mesma ocorrência são permitidas (uma linha de histórico e de auditoria cada)', async () => {
    const r1 = await providenciar(O_TUTOR_RESPONSAVEL, corpo());
    const r2 = await providenciar(O_TUTOR_RESPONSAVEL, { descricao: 'Segunda providência fictícia.' }, ID_PEDAGOGICO);
    expect([r1.status, r2.status]).toEqual([201, 201]);
    expect(r2.body.providencias.map((p) => p.descricao)).toEqual([CORPO.descricao, 'Segunda providência fictícia.']);
    expect(banco.historicos).toHaveLength(2);
    expect(banco.logs).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Resposta 201 = detalhe do GET
// ---------------------------------------------------------------------------
describe('resposta 201 com o detalhe completo', () => {
  it('GESTAO: 201 igual ao GET /ocorrencias/{id} logo depois (com codigoEscolar e a nova providência)', async () => {
    const res = await providenciar(O_ACOMPANHAMENTO, corpo(), ID_GESTAO);
    expect(res.status).toBe(201);
    const detalhe = await getDetalhe(O_ACOMPANHAMENTO, ID_GESTAO);
    expect(detalhe.status).toBe(200);
    expect(res.body).toEqual(detalhe.body);
    expect(res.body.estudantes[0]).toHaveProperty('codigoEscolar', 'TESTE-0002');
    expect(res.body.comunicacoes).toHaveLength(1);
    expect(res.body.encaminhamentos).toHaveLength(1);
    expect(res.body.providencias).toEqual([
      {
        id: 1,
        descricao: 'Providência fictícia anterior.',
        dataHora: '2026-10-04T09:00:00.000Z',
        registradoPor: { id: ID_PEDAGOGICO, nome: `Usuário Fictício ${ID_PEDAGOGICO}` },
      },
      {
        id: 2,
        descricao: CORPO.descricao,
        dataHora: AGORA_BANCO.toISOString(),
        registradoPor: { id: ID_GESTAO, nome: `Usuário Fictício ${ID_GESTAO}` },
      },
    ]);
  });

  for (const [rotulo, id, ocorrenciaId] of [
    ['PEDAGOGICO', ID_PEDAGOGICO, O_TUTOR_TUTORADO],
    ['TUTOR responsável', ID_TUTOR, O_TUTOR_RESPONSAVEL],
  ]) {
    it(`${rotulo}: 201 igual ao GET e SEM codigoEscolar (RN20)`, async () => {
      const res = await providenciar(ocorrenciaId, corpo(), id);
      expect(res.status).toBe(201);
      const detalhe = await getDetalhe(ocorrenciaId, id);
      expect(res.body).toEqual(detalhe.body);
      for (const estudante of res.body.estudantes) expect(estudante).not.toHaveProperty('codigoEscolar');
      expect(JSON.stringify(res.body)).not.toMatch(/@sisto|hash-ficticio|TESTE-/);
    });
  }

  it('o detalhe é lido na MESMA transação da gravação', async () => {
    await providenciar(O_ACOMPANHAMENTO, corpo());
    expect(mocks.$transaction).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Transação
// ---------------------------------------------------------------------------
describe('transação única SERIALIZABLE', () => {
  it('usa uma única transação serializável', async () => {
    const res = await providenciar(O_ACOMPANHAMENTO, corpo());
    expect(res.status).toBe(201);
    expect(mocks.$transaction).toHaveBeenCalledTimes(1);
    expect(mocks.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: 'Serializable' });
  });

  for (const ponto of ['providencia.create', 'ocorrencia.update', 'historicoOcorrencia.create', 'logAuditoria.create']) {
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
      const res = await providenciar(O_ACOMPANHAMENTO, corpo());
      expect(res.status).toBe(500);
      expect(res.body).toEqual({ erro: 'Erro interno do servidor' });
      esperarNadaGravado();
    });
  }

  it('P2034 seguido de sucesso responde 201 (transação repetida, uma providência só)', async () => {
    mocks.$transaction.mockRejectedValueOnce(erroPrisma('P2034'));
    const res = await providenciar(O_ACOMPANHAMENTO, corpo());
    expect(res.status).toBe(201);
    expect(mocks.$transaction).toHaveBeenCalledTimes(2);
    expect(banco.providencias).toHaveLength(2);
    expect(banco.historicos).toHaveLength(1);
    expect(banco.logs).toHaveLength(1);
  });

  it('P2034 e, na repetição, a ocorrência já foi encerrada por outra operação: 409 de encerrada (status relido)', async () => {
    mocks.$transaction.mockImplementationOnce(async () => {
      Object.assign(ocorrenciaNoBanco(O_ACOMPANHAMENTO), { status: 'ENCERRADO' });
      throw erroPrisma('P2034');
    });
    const res = await providenciar(O_ACOMPANHAMENTO, corpo());
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ erro: MENSAGEM_OCORRENCIA_ENCERRADA_PROVIDENCIA, codigo: CODIGOS_ERRO.OCORRENCIA_ENCERRADA });
    expect(banco.providencias).toHaveLength(1);
    expect(banco.historicos).toHaveLength(0);
  });

  it('P2034 e, na repetição, o Tutor deixou de ser o responsável (mas ainda vê): 403 (responsável relido)', async () => {
    mocks.$transaction.mockImplementationOnce(async () => {
      // Troca concorrente do responsável; o ID_TUTOR continua vendo a
      // ocorrência porque tutora um estudante envolvido.
      Object.assign(ocorrenciaNoBanco(O_TUTOR_TUTORADO), { responsavel_acompanhamento_id: ID_PEDAGOGICO });
      throw erroPrisma('P2034');
    });
    ocorrenciaNoBanco(O_TUTOR_TUTORADO).responsavel_acompanhamento_id = ID_TUTOR;
    const res = await providenciar(O_TUTOR_TUTORADO, corpo(), ID_TUTOR);
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ erro: MENSAGEM_PERFIL_SEM_PERMISSAO });
    expect(banco.providencias).toHaveLength(1);
  });

  it('esgotadas as tentativas, responde 409 pedindo para tentar de novo', async () => {
    mocks.$transaction.mockRejectedValue(erroPrisma('P2034'));
    const res = await providenciar(O_ACOMPANHAMENTO, corpo());
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ erro: MENSAGEM_CONFLITO_CONCORRENTE_PROVIDENCIA, codigo: CODIGOS_ERRO.CONFLITO_CONCORRENTE });
    expect(MENSAGEM_CONFLITO_CONCORRENTE_PROVIDENCIA).toMatch(/Tente novamente\.$/);
    expect(mocks.$transaction).toHaveBeenCalledTimes(TENTATIVAS_TRANSACAO);
    esperarNadaGravado();
  });

  it('outro erro do banco não é repetido e responde 500', async () => {
    mocks.$transaction.mockRejectedValueOnce(erroPrisma('P1001'));
    const res = await providenciar(O_ACOMPANHAMENTO, corpo());
    expect(res.status).toBe(500);
    expect(mocks.$transaction).toHaveBeenCalledTimes(1);
  });

  it('o service aceita db injetado', async () => {
    const db = { $transaction: async (op) => op(clientMock()) };
    const ocorrencia = await registrarProvidencia(
      String(O_TUTOR_RESPONSAVEL),
      corpo(),
      { id: ID_TUTOR, perfil: 'TUTOR' },
      { db },
    );
    expect(ocorrencia).toMatchObject({ id: O_TUTOR_RESPONSAVEL, status: 'EM_ACOMPANHAMENTO' });
    expect(ocorrencia.providencias).toHaveLength(1);
  });
});
