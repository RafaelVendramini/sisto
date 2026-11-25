// Testes de POST /ocorrencias/{id}/comunicacoes (Issue #51, UC02, RF09, RN08,
// RN16, RN17, RN19, RNF04) — somente dados fictícios (RN05).
// Não dependem do banco: src/lib/prisma.js é substituído por um "banco" em
// memória que AVALIA o `where` gerado pelo service (mesmo modelo de
// ocorrencias-encaminhamento.test.js). A transação do mock faz rollback
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
  MENSAGEM_COMUNICACAO_DESTINATARIO_LONGO,
  MENSAGEM_COMUNICACAO_DESTINATARIO_OBRIGATORIO,
  MENSAGEM_COMUNICACAO_MEIO_LONGO,
  MENSAGEM_COMUNICACAO_MEIO_OBRIGATORIO,
  MENSAGEM_CONFLITO_CONCORRENTE_COMUNICACAO,
  MENSAGEM_CORPO_COMUNICACAO_INVALIDO,
  MENSAGEM_DATA_HORA_COMUNICACAO_FUTURA,
  MENSAGEM_DATA_HORA_INVALIDA,
  MENSAGEM_DESCRICAO_OBRIGATORIA,
  MENSAGEM_ID_OCORRENCIA_INVALIDO,
  MENSAGEM_OCORRENCIA_ENCERRADA_COMUNICACAO,
  MENSAGEM_OCORRENCIA_NAO_ENCONTRADA,
  PERFIS_COMUNICACAO,
  TAMANHO_MAXIMO_DESTINATARIO_MEIO,
  TAMANHO_MAXIMO_TEXTO_LONGO,
  TOLERANCIA_FUTURO_MS,
  mensagemTextoLongo,
  registrarComunicacao,
  validarComunicacao,
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

// O ID_TUTOR NÃO vê as ocorrências 1, 2 e 3; vê a 4, 5, 6 e 7, cada uma por
// UMA condição da RN19.
const O_ABERTA = 1; // registrada pelo Professor, sem vínculo com o ID_TUTOR
const O_ACOMPANHAMENTO = 2; // responsável: ID_TUTOR_2; já tem comunicação e providência
const O_ENCERRADA = 3; // responsável: ID_TUTOR_2
const O_TUTOR_REGISTROU = 4; // profissional responsável: ID_TUTOR
const O_TUTOR_DESTINATARIO = 5; // encaminhada ao ID_TUTOR como usuário destinatário
const O_TUTOR_RESPONSAVEL = 6; // EM_ACOMPANHAMENTO, responsável: ID_TUTOR
const O_TUTOR_TUTORADO = 7; // envolve estudante tutorado pelo ID_TUTOR

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
      ocorrencia(O_ENCERRADA, 'ENCERRADO', {
        responsavel_acompanhamento_id: ID_TUTOR_2,
        data_encerramento: data('2026-10-20T10:00:00.000Z'),
      }),
      ocorrencia(O_TUTOR_REGISTROU, 'ABERTO', { profissional_responsavel_id: ID_TUTOR }),
      ocorrencia(O_TUTOR_DESTINATARIO, 'ABERTO'),
      ocorrencia(O_TUTOR_RESPONSAVEL, 'EM_ACOMPANHAMENTO', { responsavel_acompanhamento_id: ID_TUTOR }),
      ocorrencia(O_TUTOR_TUTORADO, 'ABERTO'),
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
    ],
    encaminhamentos: [
      encaminhamento(1, O_ABERTA, 'GESTAO'),
      encaminhamento(2, O_ACOMPANHAMENTO, 'TUTOR', ID_TUTOR_2),
      encaminhamento(3, O_ENCERRADA, 'GESTAO'),
      encaminhamento(4, O_TUTOR_REGISTROU, 'GESTAO'),
      encaminhamento(5, O_TUTOR_DESTINATARIO, 'TUTOR', ID_TUTOR),
      encaminhamento(6, O_TUTOR_RESPONSAVEL, 'GESTAO'),
      encaminhamento(7, O_TUTOR_TUTORADO, 'GESTAO'),
    ],
    comunicacoes: [
      { id: 1, ocorrencia_id: O_ACOMPANHAMENTO, destinatario: 'Família fictícia', meio: 'Telefone', descricao: 'Contato fictício anterior.', registrado_por_id: ID_GESTAO, data_hora: data('2026-10-03T14:00:00.000Z') },
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

const comunicar = (ocorrenciaId, corpo, usuarioId = ID_GESTAO) => {
  const req = request(app).post(`/ocorrencias/${ocorrenciaId}/comunicacoes`);
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

/** Corpo válido fictício (momento do contato no passado, com fuso de São Paulo). */
const CORPO = Object.freeze({
  destinatario: 'Responsável Fictício da Silva',
  meio: 'Telefone',
  descricao: 'Contato fictício com a família para relatar a ocorrência.',
  dataHora: '2026-10-20T14:30:00-03:00',
});
const corpo = (extra = {}) => ({ ...CORPO, ...extra });
/** dataHora do CORPO em UTC (RN17: gravação em UTC). */
const DATA_HORA_CORPO_UTC = '2026-10-20T17:30:00.000Z';

// ---------------------------------------------------------------------------
// Autenticação e permissões
// ---------------------------------------------------------------------------
describe('POST /ocorrencias/{id}/comunicacoes — autenticação e perfis (Seção 4, RN16)', () => {
  it('PERFIS_COMUNICACAO são exatamente TUTOR, PSICOLOGO, GESTAO e PEDAGOGICO', () => {
    // PSICOLOGO desde a v1.18 (Issue #153): testes em ocorrencias-psicologo.test.js.
    expect([...PERFIS_COMUNICACAO].sort()).toEqual(['GESTAO', 'PEDAGOGICO', 'PSICOLOGO', 'TUTOR']);
  });

  it('sem token responde 401 sem gravar', async () => {
    const res = await comunicar(O_ABERTA, corpo(), null);
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
      const res = await comunicar(O_ABERTA, corpo(), id);
      expect(res.status).toBe(403);
      expect(res.body).toEqual({ erro: MENSAGEM_PERFIL_SEM_PERMISSAO });
      expect(mocks.$transaction).not.toHaveBeenCalled();
      esperarNadaGravado();
    });

    it(`${rotulo} recebe 403 também em ocorrência inexistente e com corpo inválido`, async () => {
      const r1 = await comunicar(ID_INEXISTENTE, corpo(), id);
      const r2 = await comunicar(O_ABERTA, {}, id);
      expect([r1.status, r2.status]).toEqual([403, 403]);
      esperarNadaGravado();
    });
  }

  it('PROFESSOR que registrou a ocorrência também recebe 403 (permissão é por perfil)', async () => {
    // O_ABERTA foi registrada pelo ID_PROFESSOR (ele a vê pela RN19).
    const res = await comunicar(O_ABERTA, corpo(), ID_PROFESSOR);
    expect(res.status).toBe(403);
  });

  it('troca de senha pendente responde 403 sem gravar', async () => {
    const res = await comunicar(O_ABERTA, corpo(), ID_TROCA_PENDENTE);
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ erro: MENSAGEM_TROCA_SENHA_OBRIGATORIA, codigo: CODIGOS_ERRO.TROCA_SENHA_OBRIGATORIA });
    esperarNadaGravado();
  });

  for (const [rotulo, id] of [['GESTAO', ID_GESTAO], ['PEDAGOGICO', ID_PEDAGOGICO]]) {
    it(`${rotulo} registra em qualquer ocorrência não encerrada (201)`, async () => {
      for (const ocorrenciaId of [O_ABERTA, O_ACOMPANHAMENTO, O_TUTOR_TUTORADO]) {
        const res = await comunicar(ocorrenciaId, corpo(), id);
        expect(res.status, `ocorrência ${ocorrenciaId}`).toBe(201);
      }
      expect(banco.comunicacoes).toHaveLength(4);
    });
  }
});

// ---------------------------------------------------------------------------
// RN16/RN19 — visibilidade do Tutor
// ---------------------------------------------------------------------------
describe('RN16/RN19 — Tutor só registra nas ocorrências que pode visualizar', () => {
  for (const [rotulo, ocorrenciaId] of [
    ['registrada pelo Professor, sem vínculo', O_ABERTA],
    ['em acompanhamento por outro tutor', O_ACOMPANHAMENTO],
  ]) {
    it(`sem acesso (${rotulo}): 404 com a mesma resposta da inexistente, sem gravar`, async () => {
      const res = await comunicar(ocorrenciaId, corpo(), ID_TUTOR);
      const inexistente = await comunicar(ID_INEXISTENTE, corpo(), ID_TUTOR);
      expect(res.status).toBe(404);
      expect(res.body).toEqual({ erro: MENSAGEM_OCORRENCIA_NAO_ENCONTRADA });
      expect(res.body).toEqual(inexistente.body);
      esperarNadaGravado();
    });
  }

  it('sem acesso a ocorrência ENCERRADO: 404 (não revela o status com 409)', async () => {
    const res = await comunicar(O_ENCERRADA, corpo(), ID_TUTOR);
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ erro: MENSAGEM_OCORRENCIA_NAO_ENCONTRADA });
    esperarNadaGravado();
  });

  for (const [condicao, ocorrenciaId] of [
    ['registrou a ocorrência', O_TUTOR_REGISTROU],
    ['é usuário destinatário de um encaminhamento', O_TUTOR_DESTINATARIO],
    ['é o responsável pelo acompanhamento', O_TUTOR_RESPONSAVEL],
    ['tutora um estudante envolvido', O_TUTOR_TUTORADO],
  ]) {
    it(`com acesso porque ${condicao}: 201`, async () => {
      const res = await comunicar(ocorrenciaId, corpo(), ID_TUTOR);
      expect(res.status).toBe(201);
      expect(res.body.id).toBe(ocorrenciaId);
      const nova = banco.comunicacoes.at(-1);
      expect(nova).toMatchObject({ ocorrencia_id: ocorrenciaId, registrado_por_id: ID_TUTOR });
    });
  }

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
    const res = await comunicar(O_ABERTA, corpo(), ID_TUTOR);
    expect(res.status).toBe(404);
    expect(consultas).toHaveLength(1);
    expect(consultas[0].AND[0]).toEqual({ id: O_ABERTA });
    expect(consultas[0].AND[1]).toHaveProperty('OR');
  });
});

// ---------------------------------------------------------------------------
// id da URL
// ---------------------------------------------------------------------------
describe('id da URL', () => {
  for (const id of ['abc', '0', '-1', '1.5', '01', '2147483648']) {
    it(`id "${id}" responde 400 sem abrir transação`, async () => {
      const res = await comunicar(id, corpo());
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ erro: MENSAGEM_ID_OCORRENCIA_INVALIDO });
      expect(mocks.$transaction).not.toHaveBeenCalled();
    });
  }

  it('ocorrência inexistente responde 404 sem gravar', async () => {
    const res = await comunicar(ID_INEXISTENTE, corpo());
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ erro: MENSAGEM_OCORRENCIA_NAO_ENCONTRADA });
    esperarNadaGravado();
  });

  it('maior Int do PostgreSQL inexistente responde 404 (não 500)', async () => {
    const res = await comunicar('2147483647', corpo());
    expect(res.status).toBe(404);
  });

  it('id inválido vem antes do corpo inválido (400 do id)', async () => {
    const res = await comunicar('abc', {});
    expect(res.body).toEqual({ erro: MENSAGEM_ID_OCORRENCIA_INVALIDO });
  });
});

// ---------------------------------------------------------------------------
// Validação do corpo (sem banco)
// ---------------------------------------------------------------------------
describe('validação do corpo (400 antes de qualquer consulta)', () => {
  const casos = [
    ['corpo array', [], MENSAGEM_CORPO_COMUNICACAO_INVALIDO],
    ['corpo vazio (sem campos)', {}, MENSAGEM_COMUNICACAO_DESTINATARIO_OBRIGATORIO],
  ];
  const obrigatorios = [
    ['destinatario', MENSAGEM_COMUNICACAO_DESTINATARIO_OBRIGATORIO],
    ['meio', MENSAGEM_COMUNICACAO_MEIO_OBRIGATORIO],
    ['descricao', MENSAGEM_DESCRICAO_OBRIGATORIA],
  ];
  for (const [campo, mensagem] of obrigatorios) {
    casos.push(
      [`${campo} ausente`, corpo({ [campo]: undefined }), mensagem],
      [`${campo} null`, corpo({ [campo]: null }), mensagem],
      [`${campo} vazio`, corpo({ [campo]: '' }), mensagem],
      [`${campo} só espaços`, corpo({ [campo]: '   \t\n ' }), mensagem],
      [`${campo} número`, corpo({ [campo]: 123 }), mensagem],
      [`${campo} booleano`, corpo({ [campo]: true }), mensagem],
      [`${campo} array`, corpo({ [campo]: ['Telefone'] }), mensagem],
      [`${campo} objeto`, corpo({ [campo]: { texto: 'x' } }), mensagem],
    );
  }
  casos.push(
    ['dataHora ausente', corpo({ dataHora: undefined }), MENSAGEM_DATA_HORA_INVALIDA],
    ['dataHora null', corpo({ dataHora: null }), MENSAGEM_DATA_HORA_INVALIDA],
    ['dataHora vazia', corpo({ dataHora: '' }), MENSAGEM_DATA_HORA_INVALIDA],
    ['dataHora número', corpo({ dataHora: 1760000000000 }), MENSAGEM_DATA_HORA_INVALIDA],
    ['dataHora sem fuso', corpo({ dataHora: '2026-10-20T14:30:00' }), MENSAGEM_DATA_HORA_INVALIDA],
    ['dataHora só a data', corpo({ dataHora: '2026-10-20' }), MENSAGEM_DATA_HORA_INVALIDA],
    ['dataHora inexistente (30/02)', corpo({ dataHora: '2026-02-30T10:00:00Z' }), MENSAGEM_DATA_HORA_INVALIDA],
    ['dataHora em texto livre', corpo({ dataHora: 'ontem à tarde' }), MENSAGEM_DATA_HORA_INVALIDA],
    ['dataHora futura (1 dia)', corpo({ dataHora: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() }), MENSAGEM_DATA_HORA_COMUNICACAO_FUTURA],
    ['dataHora futura (10 min)', corpo({ dataHora: new Date(Date.now() + 10 * 60 * 1000).toISOString() }), MENSAGEM_DATA_HORA_COMUNICACAO_FUTURA],
    ['destinatario com 151 caracteres', corpo({ destinatario: 'd'.repeat(151) }), MENSAGEM_COMUNICACAO_DESTINATARIO_LONGO],
    ['meio com 151 caracteres', corpo({ meio: 'm'.repeat(151) }), MENSAGEM_COMUNICACAO_MEIO_LONGO],
    ['descricao com 5001 caracteres', corpo({ descricao: 'x'.repeat(5001) }), mensagemTextoLongo('descricao')],
  );

  for (const [rotulo, corpoEnviado, mensagem] of casos) {
    it(`${rotulo}: 400`, async () => {
      const res = await comunicar(O_ABERTA, corpoEnviado);
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ erro: mensagem });
      expect(mocks.$transaction).not.toHaveBeenCalled();
      esperarNadaGravado();
    });
  }

  it('JSON malformado responde 400 sem gravar', async () => {
    const res = await request(app)
      .post(`/ocorrencias/${O_ABERTA}/comunicacoes`)
      .set('Authorization', `Bearer ${token(ID_GESTAO)}`)
      .set('Content-Type', 'application/json')
      .send('{"destinatario":');
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('erro');
    esperarNadaGravado();
  });

  it('corpo inválido em ocorrência ENCERRADO ou inexistente responde 400 (corpo vem antes do 404/409)', async () => {
    const r1 = await comunicar(O_ENCERRADA, corpo({ meio: '' }));
    const r2 = await comunicar(ID_INEXISTENTE, corpo({ meio: '' }));
    expect([r1.status, r2.status]).toEqual([400, 400]);
    expect(r1.body).toEqual({ erro: MENSAGEM_COMUNICACAO_MEIO_OBRIGATORIO });
  });

  it('ordem do corpo: destinatario -> meio -> descricao -> dataHora', async () => {
    const r1 = await comunicar(O_ABERTA, { meio: '', descricao: '', dataHora: 'x' });
    const r2 = await comunicar(O_ABERTA, { destinatario: 'Família', descricao: '', dataHora: 'x' });
    const r3 = await comunicar(O_ABERTA, { destinatario: 'Família', meio: 'Telefone', dataHora: 'x' });
    expect(r1.body.erro).toBe(MENSAGEM_COMUNICACAO_DESTINATARIO_OBRIGATORIO);
    expect(r2.body.erro).toBe(MENSAGEM_COMUNICACAO_MEIO_OBRIGATORIO);
    expect(r3.body.erro).toBe(MENSAGEM_DESCRICAO_OBRIGATORIA);
  });

  it('mensagens de limite citam os valores definidos', () => {
    expect(TAMANHO_MAXIMO_DESTINATARIO_MEIO).toBe(150);
    expect(TAMANHO_MAXIMO_TEXTO_LONGO).toBe(5000);
    expect(MENSAGEM_COMUNICACAO_DESTINATARIO_LONGO).toBe('O destinatario deve ter no máximo 150 caracteres.');
    expect(MENSAGEM_COMUNICACAO_MEIO_LONGO).toBe('O meio deve ter no máximo 150 caracteres.');
  });
});

describe('limites, normalização e campos fora do contrato', () => {
  it('no limite (150/150/5000, com espaços nas pontas) aceita e grava sem os espaços', async () => {
    const res = await comunicar(
      O_ABERTA,
      corpo({
        destinatario: `  ${'d'.repeat(150)}  `,
        meio: `\t${'m'.repeat(150)}\n`,
        descricao: ` ${'x'.repeat(5000)} `,
      }),
    );
    expect(res.status).toBe(201);
    const nova = banco.comunicacoes.at(-1);
    expect(nova.destinatario).toBe('d'.repeat(150));
    expect(nova.meio).toBe('m'.repeat(150));
    expect(nova.descricao).toBe('x'.repeat(5000));
  });

  it('normaliza para NFC antes de contar e gravar (acento decomposto)', async () => {
    const decomposto = 'Família'; // "Família" com acento combinante
    const res = await comunicar(
      O_ABERTA,
      corpo({ destinatario: `  ${decomposto} fictícia  `, meio: 'Reunião presencial', descricao: 'Ligação fictícia.' }),
    );
    expect(res.status).toBe(201);
    const nova = banco.comunicacoes.at(-1);
    expect(nova.destinatario).toBe('Família fictícia');
    expect(nova.meio).toBe('Reunião presencial');
    expect(nova.descricao).toBe('Ligação fictícia.');
    // 150 caracteres após NFC (cada "é" decomposto ocupa 2 unidades antes).
    const r2 = await comunicar(O_ABERTA, corpo({ meio: 'é'.repeat(150) }));
    expect(r2.status).toBe(201);
  });

  it('RN16: destinatario e meio são texto livre (sem lista fixa)', async () => {
    const res = await comunicar(
      O_ABERTA,
      corpo({ destinatario: 'Conselho Tutelar (fictício)', meio: 'Visita domiciliar / bilhete na agenda' }),
    );
    expect(res.status).toBe(201);
  });

  it('validarComunicacao ignora campos fora do contrato e converte dataHora para UTC', () => {
    expect(
      validarComunicacao(
        { ...CORPO, registradoPorId: 99, ocorrenciaId: 5, status: 'ENCERRADO', id: 77 },
        { agora: () => new Date('2026-10-21T00:00:00Z') },
      ),
    ).toEqual({
      destinatario: CORPO.destinatario,
      meio: CORPO.meio,
      descricao: CORPO.descricao,
      dataHora: new Date(DATA_HORA_CORPO_UTC),
    });
  });
});

// ---------------------------------------------------------------------------
// RN17 — data/hora informada, não futura (tolerância de 5 minutos)
// ---------------------------------------------------------------------------
describe('RN17 — dataHora com tolerância de 5 minutos', () => {
  const agora = new Date('2026-10-26T12:00:00.000Z');
  const relogio = () => agora;

  it('limite exato: agora + 5 min aceita; 1 ms a mais recusa (relógio injetado)', () => {
    const limite = new Date(agora.getTime() + TOLERANCIA_FUTURO_MS).toISOString();
    const acima = new Date(agora.getTime() + TOLERANCIA_FUTURO_MS + 1).toISOString();
    expect(validarComunicacao(corpo({ dataHora: limite }), { agora: relogio }).dataHora.toISOString()).toBe(limite);
    expect(() => validarComunicacao(corpo({ dataHora: acima }), { agora: relogio })).toThrow(
      MENSAGEM_DATA_HORA_COMUNICACAO_FUTURA,
    );
  });

  it('considera o fuso informado (09:04-03:00 = 12:04Z aceita; 09:06-03:00 recusa)', () => {
    expect(() => validarComunicacao(corpo({ dataHora: '2026-10-26T09:04:00-03:00' }), { agora: relogio })).not.toThrow();
    expect(() => validarComunicacao(corpo({ dataHora: '2026-10-26T09:06:00-03:00' }), { agora: relogio })).toThrow(
      MENSAGEM_DATA_HORA_COMUNICACAO_FUTURA,
    );
  });

  it('service com relógio injetado: até 5 min responde com o detalhe; acima, 400 sem transação', async () => {
    const db = { $transaction: (op, opcoes) => mocks.$transaction(op, opcoes) };
    const solicitante = { id: ID_GESTAO, perfil: 'GESTAO' };
    const dentro = new Date(agora.getTime() + 4 * 60 * 1000).toISOString();
    const fora = new Date(agora.getTime() + 6 * 60 * 1000).toISOString();

    await expect(
      registrarComunicacao(String(O_ABERTA), corpo({ dataHora: fora }), solicitante, { db, agora: relogio }),
    ).rejects.toMatchObject({ status: 400, message: MENSAGEM_DATA_HORA_COMUNICACAO_FUTURA });
    expect(mocks.$transaction).not.toHaveBeenCalled();

    const detalhe = await registrarComunicacao(String(O_ABERTA), corpo({ dataHora: dentro }), solicitante, {
      db,
      agora: relogio,
    });
    expect(detalhe.comunicacoes.at(-1).dataHora).toEqual(new Date(dentro));
  });

  it('pela API: 4 minutos à frente do servidor é aceito (201)', async () => {
    const quase = new Date(Date.now() + 4 * 60 * 1000).toISOString();
    const res = await comunicar(O_ABERTA, corpo({ dataHora: quase }));
    expect(res.status).toBe(201);
    expect(banco.comunicacoes.at(-1).data_hora.toISOString()).toBe(quase);
  });

  it('data no passado distante é aceita (só o futuro é recusado)', async () => {
    const res = await comunicar(O_ABERTA, corpo({ dataHora: '2025-03-10T08:00:00Z' }));
    expect(res.status).toBe(201);
  });
});

// ---------------------------------------------------------------------------
// RN16 — status da ocorrência
// ---------------------------------------------------------------------------
describe('RN16 — status da ocorrência', () => {
  for (const [status, ocorrenciaId, responsavel] of [
    ['ABERTO', O_ABERTA, null],
    ['EM_ACOMPANHAMENTO', O_ACOMPANHAMENTO, ID_TUTOR_2],
  ]) {
    it(`${status}: aceita e NÃO muda o status nem o responsável`, async () => {
      const antes = { ...ocorrenciaNoBanco(ocorrenciaId) };
      const res = await comunicar(ocorrenciaId, corpo());
      expect(res.status).toBe(201);
      expect(res.body.status).toBe(status);
      expect(ocorrenciaNoBanco(ocorrenciaId)).toEqual(antes);
      expect(ocorrenciaNoBanco(ocorrenciaId).responsavel_acompanhamento_id).toBe(responsavel);
      expect(banco.historicos.map((h) => h.acao)).toEqual(['comunicação registrada']);
    });
  }

  for (const [rotulo, id] of [['GESTAO', ID_GESTAO], ['PEDAGOGICO', ID_PEDAGOGICO], ['TUTOR com acesso', ID_TUTOR_2]]) {
    it(`ENCERRADO: 409 sem gravar (${rotulo})`, async () => {
      const res = await comunicar(O_ENCERRADA, corpo(), id);
      expect(res.status).toBe(409);
      expect(res.body).toEqual({ erro: MENSAGEM_OCORRENCIA_ENCERRADA_COMUNICACAO, codigo: CODIGOS_ERRO.OCORRENCIA_ENCERRADA });
      esperarNadaGravado();
    });
  }

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
    await comunicar(O_ACOMPANHAMENTO, corpo());
    expect(escritas).toEqual([
      'comunicacao.create',
      'ocorrencia.update',
      'historicoOcorrencia.create',
      'logAuditoria.create',
    ]);
    expect(update).toEqual([{ where: { id: O_ACOMPANHAMENTO }, data: { status: 'EM_ACOMPANHAMENTO' }, select: { id: true } }]);
  });
});

// ---------------------------------------------------------------------------
// Gravação, autoria, histórico (RN08) e auditoria (RNF04)
// ---------------------------------------------------------------------------
describe('gravação, autoria, histórico e auditoria', () => {
  it('grava a comunicação, o histórico e a auditoria com o usuário logado', async () => {
    const res = await comunicar(O_ACOMPANHAMENTO, corpo(), ID_PEDAGOGICO);
    expect(res.status).toBe(201);
    expect(banco.comunicacoes).toHaveLength(2);
    expect(banco.comunicacoes[1]).toEqual({
      id: 2,
      ocorrencia_id: O_ACOMPANHAMENTO,
      destinatario: CORPO.destinatario,
      meio: CORPO.meio,
      descricao: CORPO.descricao,
      registrado_por_id: ID_PEDAGOGICO,
      data_hora: new Date(DATA_HORA_CORPO_UTC), // informada pelo usuário, em UTC (RN17)
    });
    expect(banco.historicos).toEqual([
      {
        id: 1,
        ocorrencia_id: O_ACOMPANHAMENTO,
        usuario_id: ID_PEDAGOGICO,
        acao: 'comunicação registrada',
        descricao: null,
        data_hora: AGORA_BANCO,
      },
    ]);
    expect(banco.logs).toEqual([
      { id: 1, usuario_id: ID_PEDAGOGICO, acao: 'comunicação registrada', recurso: 'ocorrencias/2', data_hora: AGORA_BANCO },
    ]);
  });

  it('constantes de histórico e auditoria são as esperadas', () => {
    expect(ACOES_HISTORICO.COMUNICACAO_REGISTRADA).toBe('comunicação registrada');
    expect(ACOES_AUDITORIA.COMUNICACAO_REGISTRADA).toBe('comunicação registrada');
  });

  it('registrado_por é sempre o usuário logado, mesmo se o corpo tentar outro; campos extras ignorados', async () => {
    const res = await comunicar(
      O_TUTOR_TUTORADO,
      corpo({
        registradoPorId: ID_GESTAO,
        registrado_por_id: ID_GESTAO,
        ocorrenciaId: O_ABERTA,
        ocorrencia_id: O_ABERTA,
        status: 'ENCERRADO',
        id: 50,
      }),
      ID_TUTOR,
    );
    expect(res.status).toBe(201);
    const nova = banco.comunicacoes.at(-1);
    expect(nova).toMatchObject({ id: 2, ocorrencia_id: O_TUTOR_TUTORADO, registrado_por_id: ID_TUTOR });
    expect(Object.keys(nova).sort()).toEqual(
      ['data_hora', 'descricao', 'destinatario', 'id', 'meio', 'ocorrencia_id', 'registrado_por_id'].sort(),
    );
    expect(ocorrenciaNoBanco(O_TUTOR_TUTORADO).status).toBe('ABERTO');
    expect(banco.historicos[0].usuario_id).toBe(ID_TUTOR);
    expect(banco.logs[0]).toMatchObject({ usuario_id: ID_TUTOR, recurso: `ocorrencias/${O_TUTOR_TUTORADO}` });
    expect(res.body.comunicacoes.at(-1).registradoPor).toEqual({ id: ID_TUTOR, nome: `Usuário Fictício ${ID_TUTOR}` });
  });

  it('RN08/RNF06: histórico e auditoria SEM o conteúdo da comunicação nem dados pessoais', async () => {
    await comunicar(
      O_ABERTA,
      corpo({
        destinatario: 'Mãe Fictícia de Estudante Fictício Beta',
        meio: 'WhatsApp (11) 90000-0000',
        descricao: 'Conversa fictícia sobre Estudante Fictício Beta, contato@familia.exemplo.',
      }),
    );
    await comunicar(O_TUTOR_RESPONSAVEL, corpo(), ID_TUTOR);
    expect(banco.historicos).toHaveLength(2);
    for (const h of banco.historicos) {
      expect(h.acao).toBe('comunicação registrada');
      expect(h.descricao).toBeNull();
    }
    const gravado = JSON.stringify([banco.historicos, banco.logs]);
    expect(gravado).not.toMatch(/Fictíci|WhatsApp|Telefone|90000|@|TESTE-|Responsável|Contato|Conversa/);
    expect(banco.logs.map((l) => [l.acao, l.recurso])).toEqual([
      ['comunicação registrada', 'ocorrencias/1'],
      ['comunicação registrada', 'ocorrencias/6'],
    ]);
  });

  it('várias comunicações na mesma ocorrência são permitidas (uma linha de histórico cada)', async () => {
    const r1 = await comunicar(O_ABERTA, corpo());
    const r2 = await comunicar(O_ABERTA, corpo({ meio: 'E-mail' }), ID_PEDAGOGICO);
    expect([r1.status, r2.status]).toEqual([201, 201]);
    expect(r2.body.comunicacoes.map((c) => c.meio)).toEqual(['Telefone', 'E-mail']);
    expect(banco.historicos).toHaveLength(2);
    expect(banco.logs).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Resposta 201 = detalhe do GET
// ---------------------------------------------------------------------------
describe('resposta 201 com o detalhe completo', () => {
  it('GESTAO: 201 igual ao GET /ocorrencias/{id} logo depois (com codigoEscolar e a nova comunicação)', async () => {
    const res = await comunicar(O_ACOMPANHAMENTO, corpo(), ID_GESTAO);
    expect(res.status).toBe(201);
    const detalhe = await getDetalhe(O_ACOMPANHAMENTO, ID_GESTAO);
    expect(detalhe.status).toBe(200);
    expect(res.body).toEqual(detalhe.body);
    expect(res.body.estudantes[0]).toHaveProperty('codigoEscolar', 'TESTE-0002');
    expect(res.body.providencias).toHaveLength(1);
    expect(res.body.comunicacoes).toEqual([
      {
        id: 1,
        destinatario: 'Família fictícia',
        meio: 'Telefone',
        descricao: 'Contato fictício anterior.',
        dataHora: '2026-10-03T14:00:00.000Z',
        registradoPor: { id: ID_GESTAO, nome: `Usuário Fictício ${ID_GESTAO}` },
      },
      {
        id: 2,
        destinatario: CORPO.destinatario,
        meio: CORPO.meio,
        descricao: CORPO.descricao,
        dataHora: DATA_HORA_CORPO_UTC,
        registradoPor: { id: ID_GESTAO, nome: `Usuário Fictício ${ID_GESTAO}` },
      },
    ]);
  });

  for (const [rotulo, id, ocorrenciaId] of [
    ['PEDAGOGICO', ID_PEDAGOGICO, O_ABERTA],
    ['TUTOR', ID_TUTOR, O_TUTOR_TUTORADO],
  ]) {
    it(`${rotulo}: 201 igual ao GET e SEM codigoEscolar (RN20)`, async () => {
      const res = await comunicar(ocorrenciaId, corpo(), id);
      expect(res.status).toBe(201);
      const detalhe = await getDetalhe(ocorrenciaId, id);
      expect(res.body).toEqual(detalhe.body);
      for (const estudante of res.body.estudantes) expect(estudante).not.toHaveProperty('codigoEscolar');
      expect(JSON.stringify(res.body)).not.toMatch(/@sisto|hash-ficticio|TESTE-/);
    });
  }

  it('o detalhe é lido na MESMA transação da gravação', async () => {
    await comunicar(O_ABERTA, corpo());
    expect(mocks.$transaction).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Transação
// ---------------------------------------------------------------------------
describe('transação única SERIALIZABLE', () => {
  it('usa uma única transação serializável', async () => {
    const res = await comunicar(O_ACOMPANHAMENTO, corpo());
    expect(res.status).toBe(201);
    expect(mocks.$transaction).toHaveBeenCalledTimes(1);
    expect(mocks.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: 'Serializable' });
  });

  for (const ponto of ['comunicacao.create', 'ocorrencia.update', 'historicoOcorrencia.create', 'logAuditoria.create']) {
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
      const res = await comunicar(O_ABERTA, corpo());
      expect(res.status).toBe(500);
      expect(res.body).toEqual({ erro: 'Erro interno do servidor' });
      esperarNadaGravado();
    });
  }

  it('P2034 seguido de sucesso responde 201 (transação repetida, uma comunicação só)', async () => {
    mocks.$transaction.mockRejectedValueOnce(erroPrisma('P2034'));
    const res = await comunicar(O_ABERTA, corpo());
    expect(res.status).toBe(201);
    expect(mocks.$transaction).toHaveBeenCalledTimes(2);
    expect(banco.comunicacoes).toHaveLength(2);
    expect(banco.historicos).toHaveLength(1);
    expect(banco.logs).toHaveLength(1);
  });

  it('P2034 e, na repetição, a ocorrência já foi encerrada por outra operação: 409 de encerrada (status relido)', async () => {
    mocks.$transaction.mockImplementationOnce(async () => {
      Object.assign(ocorrenciaNoBanco(O_ACOMPANHAMENTO), { status: 'ENCERRADO' });
      throw erroPrisma('P2034');
    });
    const res = await comunicar(O_ACOMPANHAMENTO, corpo());
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ erro: MENSAGEM_OCORRENCIA_ENCERRADA_COMUNICACAO, codigo: CODIGOS_ERRO.OCORRENCIA_ENCERRADA });
    expect(banco.comunicacoes).toHaveLength(1);
    expect(banco.historicos).toHaveLength(0);
  });

  it('esgotadas as tentativas, responde 409 pedindo para tentar de novo', async () => {
    mocks.$transaction.mockRejectedValue(erroPrisma('P2034'));
    const res = await comunicar(O_ABERTA, corpo());
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ erro: MENSAGEM_CONFLITO_CONCORRENTE_COMUNICACAO, codigo: CODIGOS_ERRO.CONFLITO_CONCORRENTE });
    expect(mocks.$transaction).toHaveBeenCalledTimes(TENTATIVAS_TRANSACAO);
    esperarNadaGravado();
  });

  it('outro erro do banco não é repetido e responde 500', async () => {
    mocks.$transaction.mockRejectedValueOnce(erroPrisma('P1001'));
    const res = await comunicar(O_ABERTA, corpo());
    expect(res.status).toBe(500);
    expect(mocks.$transaction).toHaveBeenCalledTimes(1);
  });

  it('o service aceita db injetado', async () => {
    const db = { $transaction: async (op) => op(clientMock()) };
    const ocorrencia = await registrarComunicacao(
      String(O_TUTOR_RESPONSAVEL),
      corpo(),
      { id: ID_TUTOR, perfil: 'TUTOR' },
      { db },
    );
    expect(ocorrencia).toMatchObject({ id: O_TUTOR_RESPONSAVEL, status: 'EM_ACOMPANHAMENTO' });
    expect(ocorrencia.comunicacoes).toHaveLength(1);
  });
});
