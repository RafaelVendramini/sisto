// Testes COMPLEMENTARES (QA) de POST /ocorrencias/{id}/comunicacoes (Issue #51,
// UC02, RF09, RN08, RN16, RN17, RN19, RNF04) — somente dados fictícios (RN05).
// Cobrem o que ocorrencias-comunicacao.test.js não cobre: sequência com
// encaminhamento, perda de vínculo do Tutor, usuário bloqueado, datas extremas,
// textos com quebras de linha/emojis/acentos, GET logo depois, vazamento de
// dados, tipos estranhos no JSON e concorrência (P2034).
// O "banco" em memória é o mesmo de ocorrencias-comunicacao.test.js (cópia).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';

const mocks = vi.hoisted(() => ({
  $transaction: vi.fn(),
}));

let banco;

// ---------------------------------------------------------------------------
// "Banco" em memória com avaliação de where/select/orderBy
// ---------------------------------------------------------------------------

const TABELA = {
  usuario: 'usuarios',
  turma: 'turmas',
  categoria: 'categorias',
  estudante: 'estudantes',
  ocorrencia: 'ocorrencias',
  ocorrenciaEstudante: 'ocorrenciasEstudantes',
  encaminhamento: 'encaminhamentos',
  comunicacao: 'comunicacoes',
  providencia: 'providencias',
  historicoOcorrencia: 'historicos',
  logAuditoria: 'logs',
};

const RELACOES = {
  ocorrencia: {
    turma: ['um', 'turma', 'turma_id'],
    categoria: ['um', 'categoria', 'categoria_id'],
    profissional_responsavel: ['um', 'usuario', 'profissional_responsavel_id'],
    responsavel_acompanhamento: ['um', 'usuario', 'responsavel_acompanhamento_id'],
    estudantes: ['muitos', 'ocorrenciaEstudante', 'ocorrencia_id'],
    encaminhamentos: ['muitos', 'encaminhamento', 'ocorrencia_id'],
  },
  ocorrenciaEstudante: {
    ocorrencia: ['um', 'ocorrencia', 'ocorrencia_id'],
    estudante: ['um', 'estudante', 'estudante_id'],
  },
  estudante: {
    turma: ['um', 'turma', 'turma_id'],
    tutor: ['um', 'usuario', 'tutor_id'],
  },
  encaminhamento: {
    destinatario_usuario: ['um', 'usuario', 'destinatario_usuario_id'],
    registrado_por: ['um', 'usuario', 'registrado_por_id'],
  },
  comunicacao: { registrado_por: ['um', 'usuario', 'registrado_por_id'] },
  providencia: { registrado_por: ['um', 'usuario', 'registrado_por_id'] },
};

const linhas = (modelo) => banco[TABELA[modelo]];

function relacionado(modelo, registro, campo) {
  const [tipo, alvo, fk] = RELACOES[modelo][campo];
  if (tipo === 'um') {
    return registro[fk] == null ? null : linhas(alvo).find((r) => r.id === registro[fk]) ?? null;
  }
  return linhas(alvo).filter((r) => r[fk] === registro.id);
}

function corresponde(modelo, registro, where = {}) {
  return Object.entries(where).every(([chave, condicao]) => {
    if (chave === 'AND') return condicao.every((w) => corresponde(modelo, registro, w));
    if (chave === 'OR') return condicao.some((w) => corresponde(modelo, registro, w));
    const relacao = RELACOES[modelo]?.[chave];
    if (relacao) {
      const [tipo, alvo] = relacao;
      if (tipo === 'muitos') {
        const operadores = Object.keys(condicao);
        if (operadores.length !== 1 || operadores[0] !== 'some') {
          throw new Error(`mock: operador de lista não suportado em ${modelo}.${chave}`);
        }
        return relacionado(modelo, registro, chave).some((f) => corresponde(alvo, f, condicao.some));
      }
      const pai = relacionado(modelo, registro, chave);
      return pai !== null && corresponde(alvo, pai, condicao);
    }
    if (condicao !== null && typeof condicao === 'object' && !(condicao instanceof Date)) {
      const operadores = Object.keys(condicao);
      if (operadores.length !== 1 || operadores[0] !== 'in') {
        throw new Error(`mock: operador não suportado em ${modelo}.${chave}`);
      }
      return condicao.in.includes(registro[chave]);
    }
    if (!(chave in registro)) throw new Error(`mock: campo inexistente ${modelo}.${chave}`);
    return registro[chave] === condicao;
  });
}

function contarRelacoes(select) {
  return Object.values(select ?? {}).reduce(
    (total, valor) => (valor && typeof valor === 'object' ? total + 1 + contarRelacoes(valor.select) : total),
    0,
  );
}

function selecionar(modelo, registro, select) {
  if (!select) return { ...registro };
  return Object.fromEntries(
    Object.entries(select).map(([campo, valor]) => {
      if (valor === true) {
        if (!(campo in registro)) throw new Error(`mock: campo inexistente ${modelo}.${campo}`);
        return [campo, registro[campo]];
      }
      const [tipo, alvo] = RELACOES[modelo][campo];
      const rel = relacionado(modelo, registro, campo);
      if (tipo === 'muitos') return [campo, rel.map((r) => selecionar(alvo, r, valor.select))];
      return [campo, rel === null ? null : selecionar(alvo, rel, valor.select)];
    }),
  );
}

function valorOrdenacao(modelo, registro, especificacao) {
  const [[campo, direcao]] = Object.entries(especificacao);
  if (typeof direcao === 'object') {
    const [, alvo] = RELACOES[modelo][campo];
    return valorOrdenacao(alvo, relacionado(modelo, registro, campo), direcao);
  }
  const valor = registro[campo];
  return { valor: valor instanceof Date ? valor.getTime() : valor, direcao };
}

function ordenar(modelo, registros, orderBy) {
  if (!orderBy) return registros;
  const criterios = Array.isArray(orderBy) ? orderBy : [orderBy];
  return [...registros].sort((a, b) => {
    for (const criterio of criterios) {
      const va = valorOrdenacao(modelo, a, criterio);
      const vb = valorOrdenacao(modelo, b, criterio);
      if (va.valor === vb.valor) continue;
      const menor = va.valor < vb.valor ? -1 : 1;
      return va.direcao === 'desc' ? -menor : menor;
    }
    return 0;
  });
}

/** Momento fictício preenchido pelo "banco" (@default(now())). */
const AGORA_BANCO = new Date('2026-10-28T13:00:00.000Z');

const DEFAULTS = {
  encaminhamento: () => ({ data_hora: AGORA_BANCO, observacao: null, destinatario_usuario_id: null }),
  historicoOcorrencia: () => ({ descricao: null, data_hora: AGORA_BANCO }),
  logAuditoria: () => ({ data_hora: AGORA_BANCO }),
};

function inserir(modelo, data) {
  const tabela = linhas(modelo);
  const registro = { ...(DEFAULTS[modelo]?.() ?? {}), ...data };
  if (modelo !== 'ocorrenciaEstudante') registro.id = Math.max(0, ...tabela.map((r) => r.id)) + 1;
  tabela.push(registro);
  return registro;
}

/** Operações de escrita feitas na transação ("modelo.operacao"), em ordem. */
let escritas;

function delegado(modelo) {
  const anotar = (args) => {
    if (contarRelacoes(args?.select) > 2) {
      throw new Error(`mock: mais de 2 relações numa consulta de ${modelo} (aviso do pg)`);
    }
  };
  const buscar = (args = {}) =>
    ordenar(modelo, linhas(modelo).filter((r) => corresponde(modelo, r, args.where)), args.orderBy);
  return {
    findMany: async (args) => {
      anotar(args);
      return buscar(args).map((r) => selecionar(modelo, r, args?.select));
    },
    findFirst: async (args) => {
      anotar(args);
      const [r] = buscar(args);
      return r ? selecionar(modelo, r, args.select) : null;
    },
    findUnique: async (args) => {
      anotar(args);
      const [r] = buscar(args);
      return r ? selecionar(modelo, r, args.select) : null;
    },
    create: async ({ data, select }) => {
      anotar({ select });
      escritas.push(`${modelo}.create`);
      return selecionar(modelo, inserir(modelo, data), select);
    },
    createMany: async ({ data }) => {
      escritas.push(`${modelo}.createMany`);
      data.forEach((d) => inserir(modelo, d));
      return { count: data.length };
    },
    update: async ({ where, data, select }) => {
      anotar({ select });
      escritas.push(`${modelo}.update`);
      const [r] = buscar({ where });
      if (!r) throw Object.assign(new Error('mock: registro não encontrado'), { code: 'P2025' });
      Object.assign(r, data);
      return selecionar(modelo, r, select);
    },
  };
}

function clientMock() {
  return Object.fromEntries(Object.keys(TABELA).map((m) => [m, delegado(m)]));
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
  MENSAGEM_TEXTO_CARACTERE_INVALIDO,
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

const encaminhar = (ocorrenciaId, corpoEnc, usuarioId = ID_GESTAO) =>
  request(app)
    .post(`/ocorrencias/${ocorrenciaId}/encaminhamentos`)
    .set('Authorization', `Bearer ${token(usuarioId)}`)
    .send(corpoEnc);
const getLista = (usuarioId) =>
  request(app).get('/ocorrencias').set('Authorization', `Bearer ${token(usuarioId)}`);
const acoesHistorico = (ocorrenciaId) =>
  banco.historicos.filter((h) => h.ocorrencia_id === ocorrenciaId).map((h) => h.acao);

/** Faz a PRIMEIRA chamada de $transaction falhar com P2034 (sem executar a operação). */
function p2034NaPrimeiraTentativa() {
  const original = mocks.$transaction.getMockImplementation();
  let primeira = true;
  mocks.$transaction.mockImplementation(async (op, opcoes) => {
    if (primeira) {
      primeira = false;
      throw erroPrisma('P2034');
    }
    return original(op, opcoes);
  });
}

// ---------------------------------------------------------------------------
// Sequência com encaminhamento (#49) na mesma ocorrência
// ---------------------------------------------------------------------------
describe('QA — comunicação e encaminhamento na mesma ocorrência', () => {
  it('comunicação -> encaminhamento -> comunicação: histórico na ordem e status coerente', async () => {
    const r1 = await comunicar(O_ABERTA, corpo(), ID_GESTAO);
    expect(r1.status).toBe(201);
    expect(r1.body.status).toBe('ABERTO');

    const r2 = await encaminhar(O_ABERTA, {
      destinatarioPerfil: 'EQUIPE_PEDAGOGICA',
      responsavelAcompanhamentoId: ID_TUTOR,
    });
    expect(r2.status).toBe(201);
    expect(r2.body.status).toBe('EM_ACOMPANHAMENTO');
    // O detalhe do encaminhamento já traz a comunicação anterior.
    expect(r2.body.comunicacoes).toHaveLength(1);

    // Agora o ID_TUTOR é o responsável (RN19) e passa a poder registrar.
    const r3 = await comunicar(O_ABERTA, corpo({ meio: 'Reunião presencial' }), ID_TUTOR);
    expect(r3.status).toBe(201);
    expect(r3.body.status).toBe('EM_ACOMPANHAMENTO');
    expect(r3.body.comunicacoes.map((c) => c.meio)).toEqual(['Telefone', 'Reunião presencial']);

    expect(acoesHistorico(O_ABERTA)).toEqual([
      ACOES_HISTORICO.COMUNICACAO_REGISTRADA,
      ACOES_HISTORICO.ENCAMINHAMENTO_REGISTRADO,
      ACOES_HISTORICO.STATUS_ALTERADO,
      ACOES_HISTORICO.RESPONSAVEL_DEFINIDO,
      ACOES_HISTORICO.COMUNICACAO_REGISTRADA,
    ]);
    // ids crescentes = ordem de gravação
    const ids = banco.historicos.map((h) => h.id);
    expect(ids).toEqual([...ids].sort((a, b) => a - b));
    expect(banco.logs.map((l) => [l.usuario_id, l.acao, l.recurso])).toEqual([
      [ID_GESTAO, ACOES_AUDITORIA.COMUNICACAO_REGISTRADA, 'ocorrencias/1'],
      [ID_GESTAO, ACOES_AUDITORIA.ENCAMINHAMENTO_REGISTRADO, 'ocorrencias/1'],
      [ID_TUTOR, ACOES_AUDITORIA.COMUNICACAO_REGISTRADA, 'ocorrencias/1'],
    ]);
    expect(ocorrenciaNoBanco(O_ABERTA)).toMatchObject({
      status: 'EM_ACOMPANHAMENTO',
      responsavel_acompanhamento_id: ID_TUTOR,
    });
  });

  it('encaminhamento -> comunicação: a comunicação não altera status nem responsável', async () => {
    const enc = await encaminhar(O_ABERTA, { destinatarioPerfil: 'GESTAO', responsavelAcompanhamentoId: ID_TUTOR_2 });
    expect(enc.status).toBe(201);
    const com = await comunicar(O_ABERTA, corpo(), ID_PEDAGOGICO);
    expect(com.status).toBe(201);
    expect(com.body.status).toBe('EM_ACOMPANHAMENTO');
    expect(com.body.encaminhamentos).toHaveLength(2);
    expect(com.body.comunicacoes).toHaveLength(1);
    expect(ocorrenciaNoBanco(O_ABERTA)).toMatchObject({
      status: 'EM_ACOMPANHAMENTO',
      responsavel_acompanhamento_id: ID_TUTOR_2,
    });
    expect(acoesHistorico(O_ABERTA)).toEqual([
      ACOES_HISTORICO.ENCAMINHAMENTO_REGISTRADO,
      ACOES_HISTORICO.STATUS_ALTERADO,
      ACOES_HISTORICO.RESPONSAVEL_DEFINIDO,
      ACOES_HISTORICO.COMUNICACAO_REGISTRADA,
    ]);
  });

  it('Tutor sem acesso (404) passa a ter acesso ao virar destinatário do encaminhamento', async () => {
    const antes = await comunicar(O_ABERTA, corpo(), ID_TUTOR);
    expect(antes.status).toBe(404);
    const enc = await encaminhar(O_ABERTA, {
      destinatarioPerfil: 'TUTOR',
      destinatarioUsuarioId: ID_TUTOR,
      responsavelAcompanhamentoId: ID_TUTOR_2,
    });
    expect(enc.status).toBe(201);
    const depois = await comunicar(O_ABERTA, corpo(), ID_TUTOR);
    expect(depois.status).toBe(201);
  });

  it('Tutor que deixa de ser o responsável (troca pelo encaminhamento) perde o acesso: 404', async () => {
    expect((await comunicar(O_TUTOR_RESPONSAVEL, corpo(), ID_TUTOR)).status).toBe(201);
    const enc = await encaminhar(O_TUTOR_RESPONSAVEL, {
      destinatarioPerfil: 'GESTAO',
      responsavelAcompanhamentoId: ID_TUTOR_2,
    });
    expect(enc.status).toBe(201);
    const depois = await comunicar(O_TUTOR_RESPONSAVEL, corpo(), ID_TUTOR);
    expect(depois.status).toBe(404);
    expect(depois.body).toEqual({ erro: MENSAGEM_OCORRENCIA_NAO_ENCONTRADA });
    expect(banco.comunicacoes.filter((c) => c.ocorrencia_id === O_TUTOR_RESPONSAVEL)).toHaveLength(1);
  });

  it('comunicação e encaminhamento simultâneos (com P2034 no primeiro): ambos gravados, status coerente', async () => {
    p2034NaPrimeiraTentativa();
    const [com, enc] = await Promise.all([
      comunicar(O_ABERTA, corpo(), ID_GESTAO),
      encaminhar(O_ABERTA, { destinatarioPerfil: 'GESTAO', responsavelAcompanhamentoId: ID_TUTOR_2 }),
    ]);
    expect([com.status, enc.status]).toEqual([201, 201]);
    expect(banco.comunicacoes.filter((c) => c.ocorrencia_id === O_ABERTA)).toHaveLength(1);
    expect(banco.encaminhamentos.filter((e) => e.ocorrencia_id === O_ABERTA)).toHaveLength(2);
    expect(ocorrenciaNoBanco(O_ABERTA).status).toBe('EM_ACOMPANHAMENTO');
    expect(acoesHistorico(O_ABERTA).filter((a) => a === ACOES_HISTORICO.COMUNICACAO_REGISTRADA)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// RN19 — perda de vínculo e encaminhamento sem usuário
// ---------------------------------------------------------------------------
describe('QA — visibilidade do Tutor (RN19)', () => {
  it('Tutor que perdeu a tutoria do estudante (troca de tutor) passa a receber 404', async () => {
    expect((await comunicar(O_TUTOR_TUTORADO, corpo(), ID_TUTOR)).status).toBe(201);
    // Troca de tutor fictícia: o Estudante Fictício Alfa passa ao ID_TUTOR_2.
    banco.estudantes.find((e) => e.id === 1).tutor_id = ID_TUTOR_2;
    const qtd = banco.comunicacoes.length;

    const res = await comunicar(O_TUTOR_TUTORADO, corpo(), ID_TUTOR);
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ erro: MENSAGEM_OCORRENCIA_NAO_ENCONTRADA });
    expect(banco.comunicacoes).toHaveLength(qtd);

    // O novo tutor passa a registrar.
    expect((await comunicar(O_TUTOR_TUTORADO, corpo(), ID_TUTOR_2)).status).toBe(201);
  });

  it('encaminhamento à equipe (sem usuário destinatário) não dá acesso ao Tutor', async () => {
    // O_ABERTA já tem encaminhamento à GESTAO sem usuário; acrescenta um à equipe pedagógica.
    banco.encaminhamentos.push({
      id: 50, ocorrencia_id: O_ABERTA, destinatario_perfil: 'EQUIPE_PEDAGOGICA', destinatario_usuario_id: null,
      registrado_por_id: ID_GESTAO, data_hora: data('2026-10-01T11:00:00.000Z'), observacao: null,
    });
    const r1 = await comunicar(O_ABERTA, corpo(), ID_TUTOR);
    const r2 = await comunicar(O_ABERTA, corpo(), ID_TUTOR_2);
    expect([r1.status, r2.status]).toEqual([404, 404]);
    expect(banco.comunicacoes).toHaveLength(1);
  });

  it('linha legada de encaminhamento com perfil TUTOR e sem usuário não dá acesso a nenhum Tutor', async () => {
    banco.encaminhamentos.push({
      id: 51, ocorrencia_id: O_ABERTA, destinatario_perfil: 'TUTOR', destinatario_usuario_id: null,
      registrado_por_id: ID_GESTAO, data_hora: data('2026-10-01T11:00:00.000Z'), observacao: null,
    });
    expect((await comunicar(O_ABERTA, corpo(), ID_TUTOR)).status).toBe(404);
    expect((await comunicar(O_ABERTA, corpo(), ID_TUTOR_2)).status).toBe(404);
  });

  it('ser destinatário de OUTRA ocorrência não dá acesso a esta', async () => {
    // ID_TUTOR é destinatário da O_TUTOR_DESTINATARIO (5), não da O_ABERTA (1).
    expect((await comunicar(O_TUTOR_DESTINATARIO, corpo(), ID_TUTOR)).status).toBe(201);
    expect((await comunicar(O_ABERTA, corpo(), ID_TUTOR)).status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Autenticação: usuário bloqueado e perfil lido do banco
// ---------------------------------------------------------------------------
describe('QA — autenticação (RN09) e perfil atual (RN01/RF14)', () => {
  const comToken = (tk, ocorrenciaId) =>
    request(app)
      .post(`/ocorrencias/${ocorrenciaId}/comunicacoes`)
      .set('Authorization', `Bearer ${tk}`)
      .send(corpo());

  for (const [rotulo, id] of [['TUTOR', ID_TUTOR], ['GESTAO', ID_GESTAO], ['PEDAGOGICO', ID_PEDAGOGICO]]) {
    it(`${rotulo} bloqueado com token ainda válido recebe 401 sem gravar`, async () => {
      const tk = token(id);
      banco.usuarios.find((u) => u.id === id).status = 'BLOQUEADO';
      bancoInicial = structuredClone(banco);
      const res = await comToken(tk, O_TUTOR_RESPONSAVEL);
      expect(res.status).toBe(401);
      expect(res.body).toEqual({ erro: MENSAGEM_NAO_AUTENTICADO });
      expect(mocks.$transaction).not.toHaveBeenCalled();
      esperarNadaGravado();
    });
  }

  it('token com segredo diferente: 401', async () => {
    const tk = jwt.sign({ id: ID_GESTAO, perfil: 'GESTAO' }, 'outro-segredo-ficticio-com-mais-de-32-caracteres', {
      algorithm: 'HS256',
      expiresIn: '8h',
    });
    const res = await comToken(tk, O_ABERTA);
    expect(res.status).toBe(401);
    esperarNadaGravado();
  });

  it('perfil vem do banco: TUTOR rebaixado a PROFESSOR depois do login recebe 403', async () => {
    const tk = token(ID_TUTOR);
    banco.usuarios.find((u) => u.id === ID_TUTOR).perfil = 'PROFESSOR';
    bancoInicial = structuredClone(banco);
    const res = await comToken(tk, O_TUTOR_RESPONSAVEL);
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ erro: MENSAGEM_PERFIL_SEM_PERMISSAO });
    esperarNadaGravado();
  });

  it('perfil vem do banco: PROFESSOR promovido a PEDAGOGICO depois do login registra (201)', async () => {
    const tk = token(ID_PROFESSOR);
    banco.usuarios.find((u) => u.id === ID_PROFESSOR).perfil = 'PEDAGOGICO';
    const res = await comToken(tk, O_ACOMPANHAMENTO);
    expect(res.status).toBe(201);
    expect(banco.comunicacoes.at(-1).registrado_por_id).toBe(ID_PROFESSOR);
  });

  it('métodos não previstos em /comunicacoes (GET/PUT/DELETE/PATCH) respondem 404 sem gravar', async () => {
    for (const metodo of ['get', 'put', 'delete', 'patch']) {
      const res = await request(app)[metodo](`/ocorrencias/${O_ABERTA}/comunicacoes`)
        .set('Authorization', `Bearer ${token(ID_GESTAO)}`)
        .send(corpo());
      expect(res.status, metodo).toBe(404);
    }
    esperarNadaGravado();
  });
});

// ---------------------------------------------------------------------------
// RN17 — datas extremas e fusos
// ---------------------------------------------------------------------------
describe('QA — RN17: datas antigas, fusos extremos e "agora"', () => {
  const agora = new Date('2026-10-26T12:00:00.000Z');
  const relogio = () => agora;
  const validar = (dataHora) => validarComunicacao(corpo({ dataHora }), { agora: relogio });

  it('ano 0001 (UTC) é aceito e gravado; 1900 com -03:00 é convertido para UTC', async () => {
    const r1 = await comunicar(O_ABERTA, corpo({ dataHora: '0001-01-01T00:00:00Z' }));
    expect(r1.status).toBe(201);
    expect(banco.comunicacoes.at(-1).data_hora.toISOString()).toBe('0001-01-01T00:00:00.000Z');
    const r2 = await comunicar(O_ABERTA, corpo({ dataHora: '1900-01-01T00:00:00-03:00' }));
    expect(r2.status).toBe(201);
    expect(banco.comunicacoes.at(-1).data_hora.toISOString()).toBe('1900-01-01T03:00:00.000Z');
    // Ordem por data no detalhe: 0001 antes de 1900.
    expect(r2.body.comunicacoes.map((c) => c.dataHora)).toEqual([
      '0001-01-01T00:00:00.000Z',
      '1900-01-01T03:00:00.000Z',
    ]);
  });

  for (const valor of ['0000-01-01T00:00:00Z', '0001-01-01T00:00:00+14:00', '10000-01-01T00:00:00Z', '-0001-01-01T00:00:00Z']) {
    it(`"${valor}" (fora do gravável): 400 data inválida sem transação`, async () => {
      const res = await comunicar(O_ABERTA, corpo({ dataHora: valor }));
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ erro: MENSAGEM_DATA_HORA_INVALIDA });
      expect(mocks.$transaction).not.toHaveBeenCalled();
    });
  }

  it('fuso +14:00: mesmo instante do servidor aceita (dia seguinte no relógio local); +5min01s recusa', () => {
    expect(validar('2026-10-27T02:00:00+14:00').dataHora.toISOString()).toBe('2026-10-26T12:00:00.000Z');
    expect(validar('2026-10-27T02:05:00+14:00').dataHora.toISOString()).toBe('2026-10-26T12:05:00.000Z');
    expect(() => validar('2026-10-27T02:05:01+14:00')).toThrow(MENSAGEM_DATA_HORA_COMUNICACAO_FUTURA);
  });

  it('fuso -12:00: limite exato aceita; 1 ms a mais recusa', () => {
    expect(validar('2026-10-26T00:05:00-12:00').dataHora.toISOString()).toBe('2026-10-26T12:05:00.000Z');
    expect(() => validar('2026-10-26T00:05:00.001-12:00')).toThrow(MENSAGEM_DATA_HORA_COMUNICACAO_FUTURA);
  });

  it('fuso inválido (+24:00, +14:60, sem dois-pontos) responde 400 data inválida', () => {
    for (const v of ['2026-10-26T09:00:00+24:00', '2026-10-26T09:00:00+14:60', '2026-10-26T09:00:00-0300']) {
      expect(() => validar(v), v).toThrow(MENSAGEM_DATA_HORA_INVALIDA);
    }
  });

  it('pela API: data exatamente "agora" (UTC e em -03:00) é aceita', async () => {
    const agoraUtc = new Date().toISOString();
    expect((await comunicar(O_ABERTA, corpo({ dataHora: agoraUtc }))).status).toBe(201);

    const t = new Date(Date.now() - 3 * 60 * 60 * 1000); // relógio de parede em -03:00
    const local = `${t.toISOString().slice(0, 19)}-03:00`;
    expect((await comunicar(O_ABERTA, corpo({ dataHora: local }))).status).toBe(201);
  });

  it('pela API: 6 minutos à frente em +14:00 é recusado (400) sem gravar', async () => {
    const t = new Date(Date.now() + 6 * 60 * 1000 + 14 * 60 * 60 * 1000);
    const res = await comunicar(O_ABERTA, corpo({ dataHora: `${t.toISOString().slice(0, 19)}+14:00` }));
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ erro: MENSAGEM_DATA_HORA_COMUNICACAO_FUTURA });
    esperarNadaGravado();
  });

  it('data futura é recusada mesmo em ocorrência ENCERRADO ou inexistente (400 antes de 409/404)', async () => {
    const futura = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const r1 = await comunicar(O_ENCERRADA, corpo({ dataHora: futura }));
    const r2 = await comunicar(ID_INEXISTENTE, corpo({ dataHora: futura }));
    expect([r1.status, r2.status]).toEqual([400, 400]);
  });
});

// ---------------------------------------------------------------------------
// Textos: quebras de linha, acentos (NFC), emojis e tamanho combinado
// ---------------------------------------------------------------------------
describe('QA — textos livres (RN16)', () => {
  it('quebras de linha internas são preservadas; só as pontas são aparadas', async () => {
    const descricao = '\n  Linha 1 fictícia.\nLinha 2 fictícia.\r\n\tLinha 3 fictícia.  \n';
    const res = await comunicar(O_ABERTA, corpo({ descricao, meio: 'Telefone\n(fixo)' }));
    expect(res.status).toBe(201);
    const nova = banco.comunicacoes.at(-1);
    expect(nova.descricao).toBe('Linha 1 fictícia.\nLinha 2 fictícia.\r\n\tLinha 3 fictícia.');
    expect(nova.meio).toBe('Telefone\n(fixo)');
    expect(res.body.comunicacoes.at(-1).descricao).toBe(nova.descricao);
  });

  it('acentos decompostos (NFD): 150 "é"/"ç" decompostos (300 unidades) são aceitos e gravados em NFC', async () => {
    const res = await comunicar(O_ABERTA, corpo({ destinatario: 'é'.repeat(150), meio: 'ç'.repeat(150) }));
    expect(res.status).toBe(201);
    const nova = banco.comunicacoes.at(-1);
    expect(nova.destinatario).toBe('é'.repeat(150));
    expect(nova.meio).toBe('ç'.repeat(150));
  });

  it('151 "é" decompostos: 400 (conta depois do NFC)', async () => {
    const res = await comunicar(O_ABERTA, corpo({ destinatario: 'é'.repeat(151) }));
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ erro: MENSAGEM_COMUNICACAO_DESTINATARIO_LONGO });
  });

  it('emojis e acentos são gravados e devolvidos sem alteração', async () => {
    const descricao = 'Família fictícia avisada \u{1F4DE}✅ — ação concluída. Ñandú, Ærø, 日本語.';
    const destinatario = 'Avó fictícia \u{1F475}';
    const res = await comunicar(O_ABERTA, corpo({ destinatario, descricao }));
    expect(res.status).toBe(201);
    expect(res.body.comunicacoes.at(-1)).toMatchObject({ destinatario, descricao });
  });

  // Comportamento ATUAL: o limite conta unidades UTF-16 (String.length), como
  // o local da #45 e o maxLength do HTML; um emoji fora do BMP conta 2.
  it('limite com emojis: 75 emojis (150 unidades UTF-16) aceitos; 76 recusados', async () => {
    const r1 = await comunicar(O_ABERTA, corpo({ destinatario: '\u{1F600}'.repeat(75) }));
    expect(r1.status).toBe(201);
    const r2 = await comunicar(O_ABERTA, corpo({ destinatario: '\u{1F600}'.repeat(76) }));
    expect(r2.status).toBe(400);
    expect(r2.body).toEqual({ erro: MENSAGEM_COMUNICACAO_DESTINATARIO_LONGO });
  });

  it('tamanho máximo combinado (150 + 150 + 5000, com acentos) é aceito e devolvido inteiro', async () => {
    const c = corpo({ destinatario: 'á'.repeat(150), meio: 'ç'.repeat(150), descricao: 'ã'.repeat(5000) });
    const res = await comunicar(O_ABERTA, c);
    expect(res.status).toBe(201);
    expect(res.body.comunicacoes.at(-1)).toMatchObject({
      destinatario: c.destinatario,
      meio: c.meio,
      descricao: c.descricao,
    });
  });

  it('todos os campos acima do limite ao mesmo tempo: 400 do primeiro (destinatario), sem gravar', async () => {
    const res = await comunicar(
      O_ABERTA,
      corpo({ destinatario: 'd'.repeat(151), meio: 'm'.repeat(151), descricao: 'x'.repeat(5001) }),
    );
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ erro: MENSAGEM_COMUNICACAO_DESTINATARIO_LONGO });
    esperarNadaGravado();
  });

  it('texto só com espaços Unicode (NBSP, ideográfico, em-space) é tratado como vazio: 400', async () => {
    const res = await comunicar(O_ABERTA, corpo({ meio: ' 　 ' }));
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ erro: MENSAGEM_COMUNICACAO_MEIO_OBRIGATORIO });
  });

  // Regressão (achado do QA, preexistente da #45): o PostgreSQL não aceita
  // U+0000 em colunas de texto (erro 22021 → 500); a validação recusa com 400.
  it('caractere nulo (U+0000) é recusado com 400 antes do banco', async () => {
    const res = await comunicar(O_ABERTA, corpo({ descricao: 'Contato fictício\u0000com nulo.' }));
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ erro: MENSAGEM_TEXTO_CARACTERE_INVALIDO });
    expect(mocks.$transaction).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// GET logo depois
// ---------------------------------------------------------------------------
describe('QA — GET /ocorrencias e /ocorrencias/{id} logo depois', () => {
  it('detalhe ordena as comunicações pela data do contato (não pela ordem de registro), id desempata', async () => {
    // Já existe a comunicação 1 em 2026-10-03T14:00Z na O_ACOMPANHAMENTO.
    await comunicar(O_ACOMPANHAMENTO, corpo({ meio: 'Depois', dataHora: '2026-10-05T10:00:00Z' }));
    await comunicar(O_ACOMPANHAMENTO, corpo({ meio: 'Antes', dataHora: '2026-10-02T10:00:00Z' }));
    await comunicar(O_ACOMPANHAMENTO, corpo({ meio: 'Mesmo instante', dataHora: '2026-10-03T11:00:00-03:00' }));
    const det = await getDetalhe(O_ACOMPANHAMENTO, ID_PEDAGOGICO);
    expect(det.status).toBe(200);
    expect(det.body.comunicacoes.map((c) => c.meio)).toEqual(['Antes', 'Telefone', 'Mesmo instante', 'Depois']);
    expect(det.body.comunicacoes.map((c) => c.id)).toEqual([3, 1, 4, 2]);
  });

  it('Tutor vê a comunicação no GET do detalhe; a lista continua com o status inalterado', async () => {
    const com = await comunicar(O_TUTOR_TUTORADO, corpo(), ID_TUTOR);
    expect(com.status).toBe(201);
    const det = await getDetalhe(O_TUTOR_TUTORADO, ID_TUTOR);
    expect(det.body.comunicacoes).toHaveLength(1);
    expect(det.body).toEqual(com.body);
    const lista = await getLista(ID_TUTOR);
    expect(lista.status).toBe(200);
    const itens = Array.isArray(lista.body) ? lista.body : lista.body.ocorrencias ?? lista.body.itens;
    const item = itens.find((o) => o.id === O_TUTOR_TUTORADO);
    expect(item).toBeDefined();
    expect(item.status).toBe('ABERTO');
  });

  it('Tutor sem acesso continua sem ver a ocorrência no GET depois de outro registrar comunicação', async () => {
    expect((await comunicar(O_ABERTA, corpo(), ID_GESTAO)).status).toBe(201);
    expect((await getDetalhe(O_ABERTA, ID_TUTOR)).status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Vazamento de dados na resposta e nos erros
// ---------------------------------------------------------------------------
describe('QA — resposta e erros sem dados indevidos', () => {
  it('201 não traz e-mail, hash, status/perfil de usuários nem chaves internas', async () => {
    for (const [id, ocorrenciaId] of [[ID_GESTAO, O_ACOMPANHAMENTO], [ID_TUTOR, O_TUTOR_RESPONSAVEL]]) {
      const res = await comunicar(ocorrenciaId, corpo(), id);
      expect(res.status).toBe(201);
      const texto = JSON.stringify(res.body);
      expect(texto).not.toMatch(/@sisto|hash|senha|"ATIVO"|troca_senha|registrado_por_id|ocorrencia_id/);
      for (const c of res.body.comunicacoes) {
        expect(Object.keys(c).sort()).toEqual(['dataHora', 'descricao', 'destinatario', 'id', 'meio', 'registradoPor']);
        expect(Object.keys(c.registradoPor).sort()).toEqual(['id', 'nome']);
      }
    }
  });

  it('erros têm só { erro } e não ecoam o conteúdo enviado', async () => {
    const segredo = 'Conteúdo fictício sigiloso 123';
    const respostas = [
      await comunicar(O_ABERTA, corpo({ destinatario: `${segredo}${'x'.repeat(200)}` })),
      await comunicar(O_ABERTA, corpo({ dataHora: segredo })),
      await comunicar(O_ENCERRADA, corpo({ descricao: segredo })),
      await comunicar(ID_INEXISTENTE, corpo({ descricao: segredo })),
      await comunicar(O_ABERTA, corpo({ descricao: segredo }), ID_PROFESSOR),
    ];
    expect(respostas.map((r) => r.status)).toEqual([400, 400, 409, 404, 403]);
    for (const r of respostas) {
      expect(Object.keys(r.body)).toEqual(['erro']);
      expect(r.text).not.toContain('sigiloso');
    }
    esperarNadaGravado();
  });
});

// ---------------------------------------------------------------------------
// JSON com tipos estranhos
// ---------------------------------------------------------------------------
describe('QA — corpo com tipos estranhos', () => {
  const enviarBruto = (texto, tipo = 'application/json') =>
    request(app)
      .post(`/ocorrencias/${O_ABERTA}/comunicacoes`)
      .set('Authorization', `Bearer ${token(ID_GESTAO)}`)
      .set('Content-Type', tipo)
      .send(texto);

  for (const bruto of ['null', '"texto"', '123', 'true', '[]', '[{"destinatario":"x"}]']) {
    it(`corpo JSON ${bruto}: 400 em JSON, sem gravar`, async () => {
      const res = await enviarBruto(bruto);
      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('erro');
      esperarNadaGravado();
    });
  }

  it('Content-Type text/plain (corpo não lido): 400 corpo inválido', async () => {
    const res = await enviarBruto(JSON.stringify(CORPO), 'text/plain');
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ erro: MENSAGEM_CORPO_COMUNICACAO_INVALIDO });
  });

  it('sem corpo: 400 corpo inválido', async () => {
    const res = await request(app)
      .post(`/ocorrencias/${O_ABERTA}/comunicacoes`)
      .set('Authorization', `Bearer ${token(ID_GESTAO)}`);
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ erro: MENSAGEM_CORPO_COMUNICACAO_INVALIDO });
  });

  it('campos dentro de "__proto__" não são lidos (400 destinatario obrigatório)', async () => {
    const res = await enviarBruto(`{"__proto__": ${JSON.stringify(CORPO)}}`);
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ erro: MENSAGEM_COMUNICACAO_DESTINATARIO_OBRIGATORIO });
    esperarNadaGravado();
  });

  for (const [rotulo, valor] of [
    ['objeto', { iso: '2026-10-20T14:30:00Z' }],
    ['array', ['2026-10-20T14:30:00Z']],
    ['booleano', true],
    ['com espaços nas pontas', ' 2026-10-20T14:30:00Z '],
    ['timestamp em texto', '1760000000000'],
  ]) {
    it(`dataHora ${rotulo}: 400 data inválida`, async () => {
      const res = await comunicar(O_ABERTA, corpo({ dataHora: valor }));
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ erro: MENSAGEM_DATA_HORA_INVALIDA });
    });
  }

  it('número gigante em descricao (1e400 no JSON) é tratado como tipo inválido: 400', async () => {
    const texto = JSON.stringify(CORPO).replace(/"descricao":"[^"]*"/, '"descricao":1e400');
    const res = await enviarBruto(texto);
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ erro: MENSAGEM_DESCRICAO_OBRIGATORIA });
  });

  it('campos duplicados no JSON: vale o último (comportamento do JSON.parse)', async () => {
    const texto =
      '{"destinatario":"Primeiro fictício","destinatario":"Último fictício","meio":"Telefone",' +
      '"descricao":"Contato fictício.","dataHora":"2026-10-20T14:30:00Z"}';
    const res = await enviarBruto(texto);
    expect(res.status).toBe(201);
    expect(banco.comunicacoes.at(-1).destinatario).toBe('Último fictício');
  });
});

// ---------------------------------------------------------------------------
// Concorrência (P2034)
// ---------------------------------------------------------------------------
describe('QA — duas comunicações simultâneas', () => {
  it('com P2034 na primeira tentativa de uma delas, as duas são gravadas (201/201)', async () => {
    p2034NaPrimeiraTentativa();
    const [r1, r2] = await Promise.all([
      comunicar(O_ABERTA, corpo({ meio: 'Telefone' }), ID_GESTAO),
      comunicar(O_ABERTA, corpo({ meio: 'E-mail' }), ID_PEDAGOGICO),
    ]);
    expect([r1.status, r2.status]).toEqual([201, 201]);
    expect(mocks.$transaction).toHaveBeenCalledTimes(3);
    const gravadas = banco.comunicacoes.filter((c) => c.ocorrencia_id === O_ABERTA);
    expect(gravadas.map((c) => c.meio).sort()).toEqual(['E-mail', 'Telefone']);
    expect(acoesHistorico(O_ABERTA)).toEqual([
      ACOES_HISTORICO.COMUNICACAO_REGISTRADA,
      ACOES_HISTORICO.COMUNICACAO_REGISTRADA,
    ]);
    expect(banco.logs).toHaveLength(2);
    expect(ocorrenciaNoBanco(O_ABERTA).status).toBe('ABERTO');
  });

  it('P2034 duas vezes e sucesso na terceira tentativa: 201 com uma comunicação só', async () => {
    mocks.$transaction.mockRejectedValueOnce(erroPrisma('P2034')).mockRejectedValueOnce(erroPrisma('P2034'));
    const res = await comunicar(O_ABERTA, corpo());
    expect(res.status).toBe(201);
    expect(mocks.$transaction).toHaveBeenCalledTimes(3);
    expect(banco.comunicacoes.filter((c) => c.ocorrencia_id === O_ABERTA)).toHaveLength(1);
    expect(banco.historicos).toHaveLength(1);
  });

  it('encerramento concorrente na 1ª tentativa (P2034): 409 de encerrada, nada gravado', async () => {
    mocks.$transaction.mockImplementationOnce(async () => {
      ocorrenciaNoBanco(O_ABERTA).status = 'ENCERRADO';
      throw erroPrisma('P2034');
    });
    const res = await comunicar(O_ABERTA, corpo());
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ erro: MENSAGEM_OCORRENCIA_ENCERRADA_COMUNICACAO });
    expect(banco.comunicacoes.filter((c) => c.ocorrencia_id === O_ABERTA)).toHaveLength(0);
  });
});
