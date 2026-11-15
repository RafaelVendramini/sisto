// Testes de PATCH /ocorrencias/{id}/status — encerramento (Issue #82, UC04
// passo 3, RF10, RF12, RF14, RN04, RN08, RN17, RN19, RN22, RNF04) — somente
// dados fictícios (RN05).
// Não dependem do banco: src/lib/prisma.js é substituído por um "banco" em
// memória que AVALIA o `where` gerado pelo service (mesmo modelo de
// ocorrencias-providencia.test.js, com `count`). A transação do mock faz
// rollback (cópia do banco) quando a operação falha.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { CODIGOS_ERRO } from '../src/lib/erros.js';

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
  providencia: () => ({ data_hora: AGORA_BANCO }),
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
    count: async (args) => buscar(args).length,
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
  DESCRICAO_HISTORICO_ACOMPANHAMENTO_PARA_ENCERRADO,
  MENSAGEM_CONFLITO_CONCORRENTE_ENCERRAMENTO,
  MENSAGEM_CORPO_STATUS_INVALIDO,
  MENSAGEM_ENCERRAMENTO_SEM_PERMISSAO,
  MENSAGEM_ENCERRAMENTO_SEM_PROVIDENCIA,
  MENSAGEM_ID_OCORRENCIA_INVALIDO,
  MENSAGEM_OCORRENCIA_ABERTA_ENCERRAMENTO,
  MENSAGEM_OCORRENCIA_ENCERRADA_COMUNICACAO,
  MENSAGEM_OCORRENCIA_ENCERRADA_ENCAMINHAMENTO,
  MENSAGEM_OCORRENCIA_ENCERRADA_PROVIDENCIA,
  MENSAGEM_OCORRENCIA_JA_ENCERRADA,
  MENSAGEM_OCORRENCIA_NAO_ENCONTRADA,
  MENSAGEM_STATUS_INVALIDO,
  MENSAGEM_STATUS_SOMENTE_ENCERRADO,
  PERFIS_ENCERRAMENTO,
  encerrarOcorrencia,
  validarAlteracaoStatus,
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

// O ID_TUTOR NÃO vê as ocorrências 1, 2 e 9. Vê a 3 a 8, cada uma por UMA
// condição da RN19; só é o responsável pelo acompanhamento da 3 e da 6.
const O_ABERTA = 1; // registrada pelo Professor, sem vínculo com o ID_TUTOR
const O_ACOMPANHAMENTO = 2; // registrada pelo Professor; responsável: ID_TUTOR_2; com providência
const O_ENCERRADA = 3; // responsável: ID_TUTOR (ele a vê por ser o responsável)
const O_TUTOR_REGISTROU = 4; // ABERTO, profissional responsável: ID_TUTOR
const O_TUTOR_DESTINATARIO = 5; // EM_ACOMPANHAMENTO, encaminhada ao ID_TUTOR; responsável: ID_GESTAO; com providência
const O_TUTOR_RESPONSAVEL = 6; // EM_ACOMPANHAMENTO, responsável: ID_TUTOR; com providência
const O_TUTOR_TUTORADO = 7; // EM_ACOMPANHAMENTO, envolve tutorado do ID_TUTOR; responsável: ID_PEDAGOGICO; com providência
const O_ENCERRADA_TUTORADO = 8; // ENCERRADO, envolve tutorado do ID_TUTOR; responsável: ID_TUTOR_2
const O_SEM_PROVIDENCIA = 9; // EM_ACOMPANHAMENTO, responsável: ID_TUTOR_2; SEM providência

const data = (iso) => new Date(iso);
const DATA_ENCERRAMENTO_ANTIGA = data('2026-10-20T10:00:00.000Z');

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
  const providencia = (id, ocorrenciaId) => ({
    id,
    ocorrencia_id: ocorrenciaId,
    descricao: `Providência fictícia ${id}.`,
    registrado_por_id: ID_PEDAGOGICO,
    data_hora: data(`2026-10-0${ocorrenciaId}T12:00:00.000Z`),
  });
  const encerrada = { data_encerramento: DATA_ENCERRAMENTO_ANTIGA };

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
      ocorrencia(O_SEM_PROVIDENCIA, 'EM_ACOMPANHAMENTO', { responsavel_acompanhamento_id: ID_TUTOR_2 }),
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
      { ocorrencia_id: O_SEM_PROVIDENCIA, estudante_id: 2 },
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
      encaminhamento(9, O_SEM_PROVIDENCIA, 'GESTAO'),
    ],
    comunicacoes: [
      { id: 1, ocorrencia_id: O_ACOMPANHAMENTO, destinatario: 'Família fictícia', meio: 'Telefone', descricao: 'Contato fictício anterior.', registrado_por_id: ID_GESTAO, data_hora: data('2026-10-03T14:00:00.000Z') },
      // Comunicação não conta como providência (RN04).
      { id: 2, ocorrencia_id: O_SEM_PROVIDENCIA, destinatario: 'Família fictícia', meio: 'Telefone', descricao: 'Contato fictício.', registrado_por_id: ID_GESTAO, data_hora: data('2026-10-09T14:00:00.000Z') },
    ],
    providencias: [
      providencia(1, O_ACOMPANHAMENTO),
      providencia(2, O_ENCERRADA),
      providencia(3, O_TUTOR_DESTINATARIO),
      providencia(4, O_TUTOR_RESPONSAVEL),
      providencia(5, O_TUTOR_TUTORADO),
      providencia(6, O_ENCERRADA_TUTORADO),
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

const encerrar = (ocorrenciaId, corpo = CORPO, usuarioId = ID_GESTAO) => {
  const req = request(app).patch(`/ocorrencias/${ocorrenciaId}/status`);
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

const CORPO = Object.freeze({ status: 'ENCERRADO' });

/** Espera 200 com a ocorrência encerrada agora (entre `antes` e o fim da chamada). */
async function encerrarComSucesso(ocorrenciaId, usuarioId = ID_GESTAO) {
  const antes = Date.now();
  const res = await encerrar(ocorrenciaId, CORPO, usuarioId);
  const depois = Date.now();
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  expect(res.body.id).toBe(ocorrenciaId);
  expect(res.body.status).toBe('ENCERRADO');
  const momento = new Date(res.body.dataEncerramento).getTime();
  expect(momento).toBeGreaterThanOrEqual(antes);
  expect(momento).toBeLessThanOrEqual(depois);
  return res;
}

// ---------------------------------------------------------------------------
// Autenticação e permissões (rota)
// ---------------------------------------------------------------------------
describe('PATCH /ocorrencias/{id}/status — autenticação e perfis (Seção 4, RN22)', () => {
  it('PERFIS_ENCERRAMENTO são exatamente GESTAO, PEDAGOGICO e TUTOR', () => {
    expect([...PERFIS_ENCERRAMENTO].sort()).toEqual(['GESTAO', 'PEDAGOGICO', 'TUTOR']);
  });

  it('a mensagem do 403 do service é a mesma do 403 por perfil do middleware', () => {
    expect(MENSAGEM_ENCERRAMENTO_SEM_PERMISSAO).toBe(MENSAGEM_PERFIL_SEM_PERMISSAO);
  });

  it('sem token responde 401 sem gravar', async () => {
    const res = await encerrar(O_ACOMPANHAMENTO, CORPO, null);
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ erro: MENSAGEM_NAO_AUTENTICADO });
    expect(mocks.$transaction).not.toHaveBeenCalled();
    esperarNadaGravado();
  });

  it('token inválido responde 401 sem gravar', async () => {
    const res = await request(app)
      .patch(`/ocorrencias/${O_ACOMPANHAMENTO}/status`)
      .set('Authorization', 'Bearer token-ficticio-invalido')
      .send(CORPO);
    expect(res.status).toBe(401);
    esperarNadaGravado();
  });

  for (const [rotulo, id] of [
    ['PROFESSOR', ID_PROFESSOR],
    ['TECNICO_ADMINISTRATIVO', ID_TECNICO],
  ]) {
    it(`${rotulo} recebe 403 sem gravar`, async () => {
      const res = await encerrar(O_ACOMPANHAMENTO, CORPO, id);
      expect(res.status).toBe(403);
      expect(res.body).toEqual({ erro: MENSAGEM_PERFIL_SEM_PERMISSAO });
      expect(mocks.$transaction).not.toHaveBeenCalled();
      esperarNadaGravado();
    });

    it(`${rotulo} recebe 403 também com id inválido, corpo inválido e ocorrência inexistente`, async () => {
      const r1 = await encerrar('abc', CORPO, id);
      const r2 = await encerrar(O_ACOMPANHAMENTO, {}, id);
      const r3 = await encerrar(ID_INEXISTENTE, CORPO, id);
      expect([r1.status, r2.status, r3.status]).toEqual([403, 403, 403]);
      esperarNadaGravado();
    });
  }

  it('PROFESSOR que registrou a ocorrência também recebe 403 (RN22)', async () => {
    expect(ocorrenciaNoBanco(O_ACOMPANHAMENTO).profissional_responsavel_id).toBe(ID_PROFESSOR);
    const res = await encerrar(O_ACOMPANHAMENTO, CORPO, ID_PROFESSOR);
    expect(res.status).toBe(403);
    esperarNadaGravado();
  });

  it('troca de senha pendente responde 403 sem gravar', async () => {
    const res = await encerrar(O_ACOMPANHAMENTO, CORPO, ID_TROCA_PENDENTE);
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ erro: MENSAGEM_TROCA_SENHA_OBRIGATORIA, codigo: CODIGOS_ERRO.TROCA_SENHA_OBRIGATORIA });
    expect(mocks.$transaction).not.toHaveBeenCalled();
    esperarNadaGravado();
  });

  for (const [rotulo, id] of [['GESTAO', ID_GESTAO], ['PEDAGOGICO', ID_PEDAGOGICO]]) {
    it(`${rotulo} encerra qualquer ocorrência visível em acompanhamento, sem ser o responsável (200)`, async () => {
      for (const ocorrenciaId of [O_ACOMPANHAMENTO, O_TUTOR_DESTINATARIO, O_TUTOR_RESPONSAVEL, O_TUTOR_TUTORADO]) {
        await encerrarComSucesso(ocorrenciaId, id);
        expect(ocorrenciaNoBanco(ocorrenciaId).status).toBe('ENCERRADO');
      }
      expect(banco.historicos).toHaveLength(4);
      expect(banco.logs).toHaveLength(4);
    });
  }
});

// ---------------------------------------------------------------------------
// RN19/RN22 — Tutor
// ---------------------------------------------------------------------------
describe('RN19/RN22 — Tutor', () => {
  for (const [rotulo, ocorrenciaId] of [
    ['registrada pelo Professor, sem vínculo (aberta)', O_ABERTA],
    ['em acompanhamento por outro tutor', O_ACOMPANHAMENTO],
    ['sem providência, de outro tutor', O_SEM_PROVIDENCIA],
  ]) {
    it(`que não vê a ocorrência (${rotulo}): 404 igual à inexistente, sem gravar`, async () => {
      const res = await encerrar(ocorrenciaId, CORPO, ID_TUTOR);
      const inexistente = await encerrar(ID_INEXISTENTE, CORPO, ID_TUTOR);
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
      const res = await encerrar(ocorrenciaId, CORPO, ID_TUTOR);
      expect(res.status).toBe(403);
      expect(res.body).toEqual({ erro: MENSAGEM_PERFIL_SEM_PERMISSAO });
      esperarNadaGravado();
    });
  }

  it('o Tutor que vê sem ser o responsável consegue consultar o detalhe (o 403 não é falta de visibilidade)', async () => {
    const res = await getDetalhe(O_TUTOR_TUTORADO, ID_TUTOR);
    expect(res.status).toBe(200);
  });

  it('responsável pelo acompanhamento: 200, encerrada por ele', async () => {
    await encerrarComSucesso(O_TUTOR_RESPONSAVEL, ID_TUTOR);
    expect(banco.historicos[0].usuario_id).toBe(ID_TUTOR);
    expect(banco.logs[0].usuario_id).toBe(ID_TUTOR);
  });

  it('outro Tutor responsável pela ocorrência dele também encerra (200)', async () => {
    await encerrarComSucesso(O_ACOMPANHAMENTO, ID_TUTOR_2);
  });

  it('Tutor responsável por ocorrência sem providência: 409 (passa da permissão e para na RN04)', async () => {
    const res = await encerrar(O_SEM_PROVIDENCIA, CORPO, ID_TUTOR_2);
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ erro: MENSAGEM_ENCERRAMENTO_SEM_PROVIDENCIA, codigo: CODIGOS_ERRO.ENCERRAMENTO_SEM_PROVIDENCIA });
    esperarNadaGravado();
  });

  it('Tutor responsável por ocorrência ENCERRADO: 409', async () => {
    const res = await encerrar(O_ENCERRADA, CORPO, ID_TUTOR);
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ erro: MENSAGEM_OCORRENCIA_JA_ENCERRADA, codigo: CODIGOS_ERRO.OCORRENCIA_ENCERRADA });
    esperarNadaGravado();
  });

  it('o 404 do Tutor sem acesso usa o filtro de visibilidade na própria consulta', async () => {
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
    const res = await encerrar(O_ABERTA, CORPO, ID_TUTOR);
    expect(res.status).toBe(404);
    expect(consultas).toHaveLength(1);
    expect(consultas[0].AND[0]).toEqual({ id: O_ABERTA });
    expect(consultas[0].AND[1]).toHaveProperty('OR');
  });

  it('o service recusa o Tutor não responsável com 403 mesmo chamado direto', async () => {
    const db = { $transaction: (op, opcoes) => mocks.$transaction(op, opcoes) };
    await expect(
      encerrarOcorrencia(String(O_TUTOR_TUTORADO), CORPO, { id: ID_TUTOR, perfil: 'TUTOR' }, { db }),
    ).rejects.toMatchObject({ status: 403, message: MENSAGEM_ENCERRAMENTO_SEM_PERMISSAO });
    esperarNadaGravado();
  });
});

// ---------------------------------------------------------------------------
// id da URL
// ---------------------------------------------------------------------------
describe('id da URL', () => {
  for (const id of ['abc', '0', '-1', '1.5', '01', '2147483648']) {
    it(`id "${id}" responde 400 sem abrir transação`, async () => {
      const res = await encerrar(id);
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ erro: MENSAGEM_ID_OCORRENCIA_INVALIDO });
      expect(mocks.$transaction).not.toHaveBeenCalled();
    });
  }

  it('ocorrência inexistente responde 404 sem gravar', async () => {
    const res = await encerrar(ID_INEXISTENTE);
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ erro: MENSAGEM_OCORRENCIA_NAO_ENCONTRADA });
    esperarNadaGravado();
  });

  it('maior Int do PostgreSQL inexistente responde 404 (não 500)', async () => {
    const res = await encerrar('2147483647');
    expect(res.status).toBe(404);
  });

  it('id inválido vem antes do corpo inválido (400 do id)', async () => {
    const res = await encerrar('abc', {});
    expect(res.body).toEqual({ erro: MENSAGEM_ID_OCORRENCIA_INVALIDO });
  });
});

// ---------------------------------------------------------------------------
// Validação do corpo (sem banco)
// ---------------------------------------------------------------------------
describe('validação do corpo (400 antes de qualquer consulta)', () => {
  const casos = [
    ['corpo array', [], MENSAGEM_CORPO_STATUS_INVALIDO],
    ['corpo array com o valor', ['ENCERRADO'], MENSAGEM_CORPO_STATUS_INVALIDO],
    ['corpo vazio (status ausente)', {}, MENSAGEM_STATUS_INVALIDO],
    ['status ausente com outros campos', { situacao: 'ENCERRADO' }, MENSAGEM_STATUS_INVALIDO],
    ['status null', { status: null }, MENSAGEM_STATUS_INVALIDO],
    ['status número', { status: 3 }, MENSAGEM_STATUS_INVALIDO],
    ['status booleano', { status: true }, MENSAGEM_STATUS_INVALIDO],
    ['status array', { status: ['ENCERRADO'] }, MENSAGEM_STATUS_INVALIDO],
    ['status objeto', { status: { valor: 'ENCERRADO' } }, MENSAGEM_STATUS_INVALIDO],
    ['status vazio', { status: '' }, MENSAGEM_STATUS_INVALIDO],
    ['status minúsculo', { status: 'encerrado' }, MENSAGEM_STATUS_INVALIDO],
    ['status com espaços', { status: ' ENCERRADO ' }, MENSAGEM_STATUS_INVALIDO],
    ['status fora do enum', { status: 'FECHADO' }, MENSAGEM_STATUS_INVALIDO],
    ['status rótulo amigável', { status: 'Encerrado' }, MENSAGEM_STATUS_INVALIDO],
    ['status ABERTO', { status: 'ABERTO' }, MENSAGEM_STATUS_SOMENTE_ENCERRADO],
    ['status EM_ACOMPANHAMENTO', { status: 'EM_ACOMPANHAMENTO' }, MENSAGEM_STATUS_SOMENTE_ENCERRADO],
  ];

  for (const [rotulo, corpoEnviado, mensagem] of casos) {
    it(`${rotulo}: 400`, async () => {
      const res = await encerrar(O_ACOMPANHAMENTO, corpoEnviado);
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ erro: mensagem });
      expect(mocks.$transaction).not.toHaveBeenCalled();
      esperarNadaGravado();
    });
  }

  it('a mensagem para ABERTO/EM_ACOMPANHAMENTO é a da Issue', () => {
    expect(MENSAGEM_STATUS_SOMENTE_ENCERRADO).toBe('Só é possível alterar o status para encerrado.');
  });

  it('sem corpo (nenhum Content-Type) responde 400 sem gravar', async () => {
    const res = await request(app)
      .patch(`/ocorrencias/${O_ACOMPANHAMENTO}/status`)
      .set('Authorization', `Bearer ${token(ID_GESTAO)}`);
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('erro');
    esperarNadaGravado();
  });

  it('JSON malformado responde 400 sem gravar', async () => {
    const res = await request(app)
      .patch(`/ocorrencias/${O_ACOMPANHAMENTO}/status`)
      .set('Authorization', `Bearer ${token(ID_GESTAO)}`)
      .set('Content-Type', 'application/json')
      .send('{"status":');
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('erro');
    esperarNadaGravado();
  });

  it('corpo inválido em ocorrência inexistente, aberta, encerrada ou sem providência responde 400 (corpo vem antes do 404/409)', async () => {
    const respostas = await Promise.all(
      [ID_INEXISTENTE, O_ABERTA, O_ENCERRADA, O_SEM_PROVIDENCIA].map((id) => encerrar(id, { status: 'ABERTO' })),
    );
    expect(respostas.map((r) => r.status)).toEqual([400, 400, 400, 400]);
    for (const r of respostas) expect(r.body).toEqual({ erro: MENSAGEM_STATUS_SOMENTE_ENCERRADO });
    expect(mocks.$transaction).not.toHaveBeenCalled();
  });

  it('corpo inválido do Tutor que não vê ou não é o responsável responde 400 (corpo vem antes do 404/403)', async () => {
    const r1 = await encerrar(O_ABERTA, {}, ID_TUTOR);
    const r2 = await encerrar(O_TUTOR_TUTORADO, {}, ID_TUTOR);
    expect([r1.status, r2.status]).toEqual([400, 400]);
    expect(mocks.$transaction).not.toHaveBeenCalled();
  });

  it('validarAlteracaoStatus ignora campos fora do contrato', () => {
    expect(
      validarAlteracaoStatus({
        status: 'ENCERRADO',
        justificativa: 'Texto fictício',
        dataEncerramento: '2020-01-01T00:00:00Z',
        responsavelAcompanhamentoId: ID_TUTOR,
        id: 77,
      }),
    ).toEqual({ status: 'ENCERRADO' });
  });
});

// ---------------------------------------------------------------------------
// RN04 — fluxo de status e providência obrigatória
// ---------------------------------------------------------------------------
describe('RN04 — só a partir de "em acompanhamento" e com providência', () => {
  for (const [rotulo, id] of [['GESTAO', ID_GESTAO], ['PEDAGOGICO', ID_PEDAGOGICO]]) {
    it(`ABERTO: 409 sem gravar, não pula etapa (${rotulo})`, async () => {
      const res = await encerrar(O_ABERTA, CORPO, id);
      expect(res.status).toBe(409);
      expect(res.body).toEqual({ erro: MENSAGEM_OCORRENCIA_ABERTA_ENCERRAMENTO, codigo: CODIGOS_ERRO.OCORRENCIA_ABERTA });
      esperarNadaGravado();
    });

    it(`ENCERRADO: 409 sem gravar, sem reabertura nem nova data (${rotulo})`, async () => {
      const res = await encerrar(O_ENCERRADA, CORPO, id);
      expect(res.status).toBe(409);
      expect(res.body).toEqual({ erro: MENSAGEM_OCORRENCIA_JA_ENCERRADA, codigo: CODIGOS_ERRO.OCORRENCIA_ENCERRADA });
      expect(ocorrenciaNoBanco(O_ENCERRADA).data_encerramento).toEqual(DATA_ENCERRAMENTO_ANTIGA);
      esperarNadaGravado();
    });

    it(`EM_ACOMPANHAMENTO sem providência (só com comunicação): 409 sem gravar (${rotulo})`, async () => {
      const res = await encerrar(O_SEM_PROVIDENCIA, CORPO, id);
      expect(res.status).toBe(409);
      expect(res.body).toEqual({ erro: MENSAGEM_ENCERRAMENTO_SEM_PROVIDENCIA, codigo: CODIGOS_ERRO.ENCERRAMENTO_SEM_PROVIDENCIA });
      esperarNadaGravado();
    });
  }

  it('mensagens dos 409 são claras e a de sem providência orienta a registrar uma', () => {
    expect(MENSAGEM_OCORRENCIA_ABERTA_ENCERRAMENTO).toMatch(/acompanhamento/);
    expect(MENSAGEM_OCORRENCIA_ABERTA_ENCERRAMENTO).toMatch(/aberta/);
    expect(MENSAGEM_OCORRENCIA_JA_ENCERRADA).toMatch(/já está encerrada/);
    expect(MENSAGEM_ENCERRAMENTO_SEM_PROVIDENCIA).toMatch(/^Registre ao menos uma providência/);
  });

  it('os 409 trazem `codigo` estável, distinto por situação (Issue #72, D1)', async () => {
    const semProvidencia = await encerrar(O_SEM_PROVIDENCIA);
    expect(Object.keys(semProvidencia.body).sort()).toEqual(['codigo', 'erro']);
    expect(semProvidencia.body.codigo).toBe(CODIGOS_ERRO.ENCERRAMENTO_SEM_PROVIDENCIA);
    const aberta = await encerrar(O_ABERTA);
    expect(aberta.body.codigo).toBe(CODIGOS_ERRO.OCORRENCIA_ABERTA);
    const encerrada = await encerrar(O_ENCERRADA);
    expect(encerrada.body.codigo).toBe(CODIGOS_ERRO.OCORRENCIA_ENCERRADA);
    expect(new Set([semProvidencia, aberta, encerrada].map((r) => r.body.codigo)).size).toBe(3);
    esperarNadaGravado();
  });

  it('depois de registrar uma providência pela API, a mesma ocorrência encerra (200)', async () => {
    const r1 = await encerrar(O_SEM_PROVIDENCIA);
    expect(r1.status).toBe(409);
    const prov = await request(app)
      .post(`/ocorrencias/${O_SEM_PROVIDENCIA}/providencias`)
      .set('Authorization', `Bearer ${token(ID_PEDAGOGICO)}`)
      .send({ descricao: 'Providência fictícia registrada agora.' });
    expect(prov.status).toBe(201);
    await encerrarComSucesso(O_SEM_PROVIDENCIA);
  });

  it('a segunda tentativa de encerrar a mesma ocorrência responde 409', async () => {
    await encerrarComSucesso(O_ACOMPANHAMENTO);
    const res = await encerrar(O_ACOMPANHAMENTO);
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ erro: MENSAGEM_OCORRENCIA_JA_ENCERRADA, codigo: CODIGOS_ERRO.OCORRENCIA_ENCERRADA });
    expect(banco.historicos).toHaveLength(1);
    expect(banco.logs).toHaveLength(1);
  });

  it('a contagem de providências é feita na transação, só da ocorrência, depois da checagem de status', async () => {
    const contagens = [];
    mocks.$transaction.mockImplementationOnce(async (operacao) => {
      const tx = clientMock();
      const original = tx.providencia.count;
      tx.providencia.count = async (args) => {
        contagens.push(args);
        return original(args);
      };
      return operacao(tx);
    });
    await encerrarComSucesso(O_TUTOR_TUTORADO);
    expect(contagens).toEqual([{ where: { ocorrencia_id: O_TUTOR_TUTORADO } }]);
  });
});

// ---------------------------------------------------------------------------
// Gravação, data de encerramento (RN17), histórico (RN08) e auditoria (RNF04)
// ---------------------------------------------------------------------------
describe('gravação, histórico e auditoria', () => {
  it('muda só status e data_encerramento; responsável e demais campos mantidos', async () => {
    const antes = { ...ocorrenciaNoBanco(O_TUTOR_TUTORADO) };
    const res = await encerrarComSucesso(O_TUTOR_TUTORADO, ID_PEDAGOGICO);
    const depois = ocorrenciaNoBanco(O_TUTOR_TUTORADO);
    expect(depois).toEqual({
      ...antes,
      status: 'ENCERRADO',
      data_encerramento: new Date(res.body.dataEncerramento),
    });
    expect(depois.data_encerramento).toBeInstanceOf(Date);
  });

  it('grava, na ordem, update, histórico e auditoria com o usuário logado', async () => {
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
    const res = await encerrarComSucesso(O_ACOMPANHAMENTO, ID_PEDAGOGICO);
    expect(escritas).toEqual(['ocorrencia.update', 'historicoOcorrencia.create', 'logAuditoria.create']);
    expect(update).toEqual([
      {
        where: { id: O_ACOMPANHAMENTO },
        data: { status: 'ENCERRADO', data_encerramento: new Date(res.body.dataEncerramento) },
        select: { id: true },
      },
    ]);
    expect(banco.historicos).toEqual([
      {
        id: 1,
        ocorrencia_id: O_ACOMPANHAMENTO,
        usuario_id: ID_PEDAGOGICO,
        acao: 'status alterado',
        descricao: 'De em acompanhamento para encerrado',
        data_hora: AGORA_BANCO,
      },
    ]);
    expect(banco.logs).toEqual([
      {
        id: 1,
        usuario_id: ID_PEDAGOGICO,
        acao: 'ocorrência encerrada',
        recurso: `ocorrencias/${O_ACOMPANHAMENTO}`,
        data_hora: AGORA_BANCO,
      },
    ]);
  });

  it('constantes de histórico e auditoria são as esperadas', () => {
    expect(ACOES_HISTORICO.STATUS_ALTERADO).toBe('status alterado');
    expect(DESCRICAO_HISTORICO_ACOMPANHAMENTO_PARA_ENCERRADO).toBe('De em acompanhamento para encerrado');
    expect(ACOES_AUDITORIA.OCORRENCIA_ENCERRADA).toBe('ocorrência encerrada');
  });

  it('data_encerramento vem do relógio do servidor (agora injetado no service)', async () => {
    const MOMENTO = new Date('2026-11-12T15:30:00.000Z');
    const db = { $transaction: (op, opcoes) => mocks.$transaction(op, opcoes) };
    const ocorrencia = await encerrarOcorrencia(
      String(O_TUTOR_RESPONSAVEL),
      CORPO,
      { id: ID_TUTOR, perfil: 'TUTOR' },
      { db, agora: () => MOMENTO },
    );
    expect(ocorrencia).toMatchObject({ id: O_TUTOR_RESPONSAVEL, status: 'ENCERRADO', dataEncerramento: MOMENTO });
    expect(ocorrenciaNoBanco(O_TUTOR_RESPONSAVEL).data_encerramento).toEqual(MOMENTO);
  });

  it('dataEncerramento e responsável do corpo são ignorados (vêm do sistema); campos extras ignorados', async () => {
    const res = await encerrar(O_TUTOR_RESPONSAVEL, {
      status: 'ENCERRADO',
      dataEncerramento: '2020-01-01T00:00:00Z',
      data_encerramento: '2020-01-01T00:00:00Z',
      responsavelAcompanhamentoId: ID_GESTAO,
      justificativa: 'Justificativa fictícia que não é gravada.',
      usuarioId: ID_GESTAO,
      id: 50,
    }, ID_TUTOR);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(O_TUTOR_RESPONSAVEL);
    expect(res.body.dataEncerramento).not.toBe('2020-01-01T00:00:00.000Z');
    expect(new Date(res.body.dataEncerramento).getFullYear()).toBeGreaterThanOrEqual(2026);
    expect(ocorrenciaNoBanco(O_TUTOR_RESPONSAVEL).responsavel_acompanhamento_id).toBe(ID_TUTOR);
    expect(banco.historicos[0].usuario_id).toBe(ID_TUTOR);
    expect(JSON.stringify([banco.historicos, banco.logs])).not.toMatch(/Justificativa/);
  });

  it('RN08/RNF06: histórico e auditoria sem dados pessoais', async () => {
    await encerrarComSucesso(O_TUTOR_TUTORADO);
    const gravado = JSON.stringify([banco.historicos, banco.logs]);
    expect(gravado).not.toMatch(/Fictíci|@|TESTE-|Providência/);
  });

  it('não grava providência, comunicação nem encaminhamento', async () => {
    await encerrarComSucesso(O_ACOMPANHAMENTO);
    expect(banco.providencias).toEqual(bancoInicial.providencias);
    expect(banco.comunicacoes).toEqual(bancoInicial.comunicacoes);
    expect(banco.encaminhamentos).toEqual(bancoInicial.encaminhamentos);
  });
});

// ---------------------------------------------------------------------------
// Resposta 200 = detalhe do GET
// ---------------------------------------------------------------------------
describe('resposta 200 com o detalhe completo', () => {
  it('GESTAO: 200 igual ao GET /ocorrencias/{id} logo depois (com codigoEscolar e dataEncerramento)', async () => {
    const res = await encerrarComSucesso(O_ACOMPANHAMENTO, ID_GESTAO);
    const detalhe = await getDetalhe(O_ACOMPANHAMENTO, ID_GESTAO);
    expect(detalhe.status).toBe(200);
    expect(res.body).toEqual(detalhe.body);
    expect(detalhe.body.status).toBe('ENCERRADO');
    expect(detalhe.body.dataEncerramento).toBe(res.body.dataEncerramento);
    expect(res.body.estudantes[0]).toHaveProperty('codigoEscolar', 'TESTE-0002');
    expect(res.body.comunicacoes).toHaveLength(1);
    expect(res.body.encaminhamentos).toHaveLength(1);
    expect(res.body.providencias).toHaveLength(1);
    expect(res.body.responsavelAcompanhamento).toEqual({ id: ID_TUTOR_2, nome: `Usuário Fictício ${ID_TUTOR_2}` });
  });

  for (const [rotulo, id, ocorrenciaId] of [
    ['PEDAGOGICO', ID_PEDAGOGICO, O_TUTOR_TUTORADO],
    ['TUTOR responsável', ID_TUTOR, O_TUTOR_RESPONSAVEL],
  ]) {
    it(`${rotulo}: 200 igual ao GET e SEM codigoEscolar (RN20)`, async () => {
      const res = await encerrarComSucesso(ocorrenciaId, id);
      const detalhe = await getDetalhe(ocorrenciaId, id);
      expect(res.body).toEqual(detalhe.body);
      for (const estudante of res.body.estudantes) expect(estudante).not.toHaveProperty('codigoEscolar');
      expect(JSON.stringify(res.body)).not.toMatch(/@sisto|hash-ficticio|TESTE-/);
    });
  }

  it('o GET de uma ocorrência ainda não encerrada traz dataEncerramento null', async () => {
    const res = await getDetalhe(O_ACOMPANHAMENTO, ID_GESTAO);
    expect(res.body).toHaveProperty('dataEncerramento', null);
  });

  it('o detalhe é lido na MESMA transação da gravação', async () => {
    await encerrarComSucesso(O_ACOMPANHAMENTO);
    expect(mocks.$transaction).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Regressão: depois de encerrada (RN15, RN16, #81)
// ---------------------------------------------------------------------------
describe('regressão — depois de encerrada pelo PATCH', () => {
  const comAuth = (req, id = ID_GESTAO) => req.set('Authorization', `Bearer ${token(id)}`);

  it('encaminhamento, comunicação e providência respondem 409 sem gravar', async () => {
    await encerrarComSucesso(O_TUTOR_RESPONSAVEL);
    const depoisDoEncerramento = structuredClone(banco);

    const enc = await comAuth(request(app).post(`/ocorrencias/${O_TUTOR_RESPONSAVEL}/encaminhamentos`)).send({
      destinatarioPerfil: 'GESTAO',
    });
    expect(enc.status).toBe(409);
    expect(enc.body).toEqual({ erro: MENSAGEM_OCORRENCIA_ENCERRADA_ENCAMINHAMENTO, codigo: CODIGOS_ERRO.OCORRENCIA_ENCERRADA });

    const com = await comAuth(request(app).post(`/ocorrencias/${O_TUTOR_RESPONSAVEL}/comunicacoes`)).send({
      destinatario: 'Família fictícia',
      meio: 'Telefone',
      descricao: 'Contato fictício depois do encerramento.',
      dataHora: '2026-10-10T10:00:00.000Z',
    });
    expect(com.status).toBe(409);
    expect(com.body).toEqual({ erro: MENSAGEM_OCORRENCIA_ENCERRADA_COMUNICACAO, codigo: CODIGOS_ERRO.OCORRENCIA_ENCERRADA });

    const prov = await comAuth(request(app).post(`/ocorrencias/${O_TUTOR_RESPONSAVEL}/providencias`)).send({
      descricao: 'Providência fictícia depois do encerramento.',
    });
    expect(prov.status).toBe(409);
    expect(prov.body).toEqual({ erro: MENSAGEM_OCORRENCIA_ENCERRADA_PROVIDENCIA, codigo: CODIGOS_ERRO.OCORRENCIA_ENCERRADA });

    // Também o Tutor responsável (comunicação e providência).
    const provTutor = await comAuth(
      request(app).post(`/ocorrencias/${O_TUTOR_RESPONSAVEL}/providencias`),
      ID_TUTOR,
    ).send({ descricao: 'Providência fictícia do tutor.' });
    expect(provTutor.status).toBe(409);

    expect(banco).toEqual(depoisDoEncerramento);
  });
});

// ---------------------------------------------------------------------------
// Transação
// ---------------------------------------------------------------------------
describe('transação única SERIALIZABLE', () => {
  it('usa uma única transação serializável', async () => {
    await encerrarComSucesso(O_ACOMPANHAMENTO);
    expect(mocks.$transaction).toHaveBeenCalledTimes(1);
    expect(mocks.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: 'Serializable' });
  });

  for (const ponto of ['ocorrencia.update', 'historicoOcorrencia.create', 'logAuditoria.create']) {
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
      const res = await encerrar(O_ACOMPANHAMENTO);
      expect(res.status).toBe(500);
      expect(res.body).toEqual({ erro: 'Erro interno do servidor' });
      esperarNadaGravado();
    });
  }

  it('P2034 seguido de sucesso responde 200 (transação repetida, um histórico só)', async () => {
    mocks.$transaction.mockRejectedValueOnce(erroPrisma('P2034'));
    await encerrarComSucesso(O_ACOMPANHAMENTO);
    expect(mocks.$transaction).toHaveBeenCalledTimes(2);
    expect(banco.historicos).toHaveLength(1);
    expect(banco.logs).toHaveLength(1);
  });

  it('P2034 e, na repetição, outra operação já encerrou: 409 de já encerrada (status relido)', async () => {
    mocks.$transaction.mockImplementationOnce(async () => {
      Object.assign(ocorrenciaNoBanco(O_ACOMPANHAMENTO), { status: 'ENCERRADO', data_encerramento: DATA_ENCERRAMENTO_ANTIGA });
      throw erroPrisma('P2034');
    });
    const res = await encerrar(O_ACOMPANHAMENTO);
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ erro: MENSAGEM_OCORRENCIA_JA_ENCERRADA, codigo: CODIGOS_ERRO.OCORRENCIA_ENCERRADA });
    expect(banco.historicos).toHaveLength(0);
    expect(banco.logs).toHaveLength(0);
  });

  it('P2034 e, na repetição, uma providência concorrente já foi gravada: 200 (contagem relida)', async () => {
    mocks.$transaction.mockImplementationOnce(async () => {
      banco.providencias.push({
        id: 50,
        ocorrencia_id: O_SEM_PROVIDENCIA,
        descricao: 'Providência fictícia concorrente.',
        registrado_por_id: ID_PEDAGOGICO,
        data_hora: AGORA_BANCO,
      });
      throw erroPrisma('P2034');
    });
    await encerrarComSucesso(O_SEM_PROVIDENCIA);
    expect(mocks.$transaction).toHaveBeenCalledTimes(2);
  });

  it('P2034 e, na repetição, o Tutor deixou de ser o responsável (mas ainda vê): 403 (responsável relido)', async () => {
    ocorrenciaNoBanco(O_TUTOR_TUTORADO).responsavel_acompanhamento_id = ID_TUTOR;
    mocks.$transaction.mockImplementationOnce(async () => {
      Object.assign(ocorrenciaNoBanco(O_TUTOR_TUTORADO), { responsavel_acompanhamento_id: ID_PEDAGOGICO });
      throw erroPrisma('P2034');
    });
    const res = await encerrar(O_TUTOR_TUTORADO, CORPO, ID_TUTOR);
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ erro: MENSAGEM_PERFIL_SEM_PERMISSAO });
    expect(ocorrenciaNoBanco(O_TUTOR_TUTORADO).status).toBe('EM_ACOMPANHAMENTO');
  });

  it('esgotadas as tentativas (P2034 repetido), responde 409 pedindo para tentar de novo', async () => {
    mocks.$transaction.mockRejectedValue(erroPrisma('P2034'));
    const res = await encerrar(O_ACOMPANHAMENTO);
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ erro: MENSAGEM_CONFLITO_CONCORRENTE_ENCERRAMENTO, codigo: CODIGOS_ERRO.CONFLITO_CONCORRENTE });
    expect(MENSAGEM_CONFLITO_CONCORRENTE_ENCERRAMENTO).toMatch(/Tente novamente\.$/);
    expect(mocks.$transaction).toHaveBeenCalledTimes(3);
    esperarNadaGravado();
  });

  it('outro erro do banco não é repetido e responde 500', async () => {
    mocks.$transaction.mockRejectedValueOnce(erroPrisma('P1001'));
    const res = await encerrar(O_ACOMPANHAMENTO);
    expect(res.status).toBe(500);
    expect(mocks.$transaction).toHaveBeenCalledTimes(1);
  });

  it('o service aceita db injetado', async () => {
    const db = { $transaction: async (op) => op(clientMock()) };
    const ocorrencia = await encerrarOcorrencia(String(O_TUTOR_RESPONSAVEL), CORPO, { id: ID_TUTOR, perfil: 'TUTOR' }, { db });
    expect(ocorrencia).toMatchObject({ id: O_TUTOR_RESPONSAVEL, status: 'ENCERRADO' });
    expect(ocorrencia.dataEncerramento).toBeInstanceOf(Date);
  });
});
