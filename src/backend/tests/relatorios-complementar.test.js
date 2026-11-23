// QA da Issue #88 — casos complementares de GET /relatorios (RF13, RF14,
// UC05, RN01, RN09, RN14, RN17, RN19). Somente dados fictícios (RN05).
// Reaproveita o mesmo "banco" em memória de relatorios.test.js, que AVALIA o
// `where` real gerado pelo service (inclusive filtroVisibilidadeOcorrencias)
// e implementa count/groupBy.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { criarBancoEmMemoria } from './apoio/bancoEmMemoria.js';

let banco;
/** Operações feitas no client ("modelo.operacao"), em ordem. */
let operacoes;

// ---------------------------------------------------------------------------
// "Banco" em memória
// ---------------------------------------------------------------------------

const TABELA = {
  usuario: 'usuarios',
  turma: 'turmas',
  categoria: 'categorias',
  estudante: 'estudantes',
  ocorrencia: 'ocorrencias',
  ocorrenciaEstudante: 'ocorrenciasEstudantes',
  encaminhamento: 'encaminhamentos',
  historicoOcorrencia: 'historicos',
  logAuditoria: 'logs',
};

// Relações: ['um', modelo, campo FK] ou ['muitos', modelo, campo FK no filho].
const RELACOES = {
  ocorrencia: {
    turma: ['um', 'turma', 'turma_id'],
    categoria: ['um', 'categoria', 'categoria_id'],
    estudantes: ['muitos', 'ocorrenciaEstudante', 'ocorrencia_id'],
    encaminhamentos: ['muitos', 'encaminhamento', 'ocorrencia_id'],
  },
  ocorrenciaEstudante: {
    ocorrencia: ['um', 'ocorrencia', 'ocorrencia_id'],
    estudante: ['um', 'estudante', 'estudante_id'],
  },
};

// Avaliação do where e do select: tests/apoio/bancoEmMemoria.js (Issue #129),
// sem select aninhado (as leituras do relatório não pedem relações no select).
const { linhas, corresponde, selecionar } = criarBancoEmMemoria({
  obterBanco: () => banco,
  tabelas: TABELA,
  relacoes: RELACOES,
  selectAninhado: false,
});

function verificarArgs(modelo, operacao, args, permitidos) {
  const extras = Object.keys(args ?? {}).filter((k) => !permitidos.includes(k));
  if (extras.length > 0) throw new Error(`mock: argumento não previsto em ${modelo}.${operacao}: ${extras}`);
}

function delegado(modelo) {
  const anotar = (operacao) => operacoes.push(`${modelo}.${operacao}`);
  const filtrar = (where) => linhas(modelo).filter((r) => corresponde(modelo, r, where));
  const proibida = (operacao) => async () => {
    anotar(operacao);
    throw new Error(`mock: ${modelo}.${operacao} não deveria ser chamado por uma leitura`);
  };
  return {
    findUnique: async (args) => {
      anotar('findUnique');
      verificarArgs(modelo, 'findUnique', args, ['where', 'select']);
      const [r] = filtrar(args.where);
      return r ? selecionar(modelo, r, args.select) : null;
    },
    findMany: async (args = {}) => {
      anotar('findMany');
      verificarArgs(modelo, 'findMany', args, ['where', 'select']);
      return filtrar(args.where).map((r) => selecionar(modelo, r, args.select));
    },
    count: async (args = {}) => {
      anotar('count');
      verificarArgs(modelo, 'count', args, ['where']);
      return filtrar(args.where).length;
    },
    groupBy: async (args) => {
      anotar('groupBy');
      verificarArgs(modelo, 'groupBy', args, ['by', 'where', '_count']);
      if (args.by.length !== 1 || JSON.stringify(args._count) !== '{"_all":true}') {
        throw new Error('mock: groupBy só com um campo e _count: { _all: true }');
      }
      const [campo] = args.by;
      const grupos = new Map();
      for (const r of filtrar(args.where)) grupos.set(r[campo], (grupos.get(r[campo]) ?? 0) + 1);
      // Ordem "do banco" propositalmente diferente da esperada (id desc).
      return [...grupos.entries()]
        .sort(([a], [b]) => b - a)
        .map(([valor, quantidade]) => ({ [campo]: valor, _count: { _all: quantidade } }));
    },
    create: proibida('create'),
    createMany: proibida('createMany'),
    update: proibida('update'),
    updateMany: proibida('updateMany'),
    delete: proibida('delete'),
    deleteMany: proibida('deleteMany'),
    upsert: proibida('upsert'),
  };
}

const clientMock = () => Object.fromEntries(Object.keys(TABELA).map((m) => [m, delegado(m)]));

vi.mock('../src/lib/prisma.js', () => ({
  default: new Proxy(
    {},
    {
      get(_alvo, prop) {
        if (prop === '$transaction') {
          return async () => {
            operacoes.push('$transaction');
            throw new Error('mock: transação não prevista em uma leitura de relatório');
          };
        }
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
const { MENSAGENS_PERIODO } = await import('../src/services/periodo.js');
const {
  MENSAGEM_TIPO_RELATORIO_INVALIDO,
  PERFIS_RELATORIOS,
  TIPOS_RELATORIO,
  gerarRelatorio,
  rotuloTurma,
} = await import('../src/services/relatorios.js');

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

// Turmas: 1 e 2 com ocorrências no período; 3 sem nenhuma; 4 só fora do período.
// Rótulos em ordem alfabética: turma 2 ("1º A ...") antes da turma 1 ("6º A ...").
const TURMA_6A = 1;
const TURMA_1A = 2;
const TURMA_SEM_OCORRENCIA = 3;
const TURMA_FORA_DO_PERIODO = 4;

// Categorias: em ordem alfabética, Conflitos (2) antes de Indisciplina (1).
const CAT_INDISCIPLINA = 1;
const CAT_CONFLITOS = 2;
const CAT_SEM_OCORRENCIA = 3;
const CAT_FORA_DO_PERIODO = 4;

const ID_ESTUDANTE_MUDOU = 1; // estava na 6º A; hoje está na 1º A
const ID_ESTUDANTE_6A = 2;
const ID_ESTUDANTE_1A = 3;

const PERIODO_OUTUBRO = { dataInicio: '2026-10-01', dataFim: '2026-10-31' };

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
  const ocorrencia = (id, iso, turma, categoria, status, extra = {}) => ({
    id,
    data_hora: new Date(iso),
    local: `Local fictício ${id}`,
    turma_id: turma,
    categoria_id: categoria,
    descricao: `Descrição fictícia da ocorrência ${id}.`,
    demais_envolvidos: null,
    testemunhas: null,
    providencias_imediatas: null,
    observacoes: null,
    profissional_responsavel_id: ID_GESTAO,
    responsavel_acompanhamento_id: null,
    status,
    data_encerramento: status === 'ENCERRADO' ? new Date('2026-10-20T12:00:00.000Z') : null,
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
    ],
    turmas: [
      { id: TURMA_6A, nome: '6º A', etapa: 'Ensino Fundamental', ano_letivo: 2026 },
      { id: TURMA_1A, nome: '1º A', etapa: 'Ensino Médio', ano_letivo: 2026 },
      { id: TURMA_SEM_OCORRENCIA, nome: '7º B', etapa: 'Ensino Fundamental', ano_letivo: 2026 },
      { id: TURMA_FORA_DO_PERIODO, nome: '9º A', etapa: 'Ensino Fundamental', ano_letivo: 2025 },
    ],
    categorias: [
      { id: CAT_INDISCIPLINA, nome: 'Indisciplina', descricao: 'Descrição fictícia.' },
      { id: CAT_CONFLITOS, nome: 'Conflitos', descricao: null },
      { id: CAT_SEM_OCORRENCIA, nome: 'Bullying', descricao: null },
      { id: CAT_FORA_DO_PERIODO, nome: 'Ameaça', descricao: null },
    ],
    estudantes: [
      { id: ID_ESTUDANTE_MUDOU, nome_completo: 'Estudante Fictício Alfa', codigo_escolar: 'TESTE-0001', turma_id: TURMA_1A, tutor_id: ID_TUTOR },
      { id: ID_ESTUDANTE_6A, nome_completo: 'Estudante Fictício Beta', codigo_escolar: 'TESTE-0002', turma_id: TURMA_6A, tutor_id: null },
      { id: ID_ESTUDANTE_1A, nome_completo: 'Estudante Fictício Gama', codigo_escolar: 'TESTE-0003', turma_id: TURMA_1A, tutor_id: null },
    ],
    ocorrencias: [
      // 01/10 00:00:00.000 em SP (ponta inicial), três estudantes: conta 1.
      ocorrencia(1, '2026-10-01T03:00:00.000Z', TURMA_6A, CAT_INDISCIPLINA, 'ABERTO'),
      // 31/10 23:59:59.999 em SP (ponta final); estudante que depois mudou de turma.
      ocorrencia(2, '2026-11-01T02:59:59.999Z', TURMA_6A, CAT_CONFLITOS, 'EM_ACOMPANHAMENTO', {
        responsavel_acompanhamento_id: ID_PEDAGOGICO,
      }),
      ocorrencia(3, '2026-10-15T15:00:00.000Z', TURMA_1A, CAT_INDISCIPLINA, 'ENCERRADO'),
      // 10/10 23h30 em SP = 11/10 02h30 UTC.
      ocorrencia(4, '2026-10-11T02:30:00.000Z', TURMA_1A, CAT_INDISCIPLINA, 'ABERTO'),
      // Registrada pelo professor (usada no teste de visibilidade).
      ocorrencia(7, '2026-10-20T13:00:00.000Z', TURMA_1A, CAT_CONFLITOS, 'ABERTO', {
        profissional_responsavel_id: ID_PROFESSOR,
      }),
      // Fora do período: 30/09 23:59:59.999 e 01/11 00:00:00.000 em SP.
      ocorrencia(5, '2026-10-01T02:59:59.999Z', TURMA_FORA_DO_PERIODO, CAT_FORA_DO_PERIODO, 'ABERTO'),
      ocorrencia(6, '2026-11-01T03:00:00.000Z', TURMA_FORA_DO_PERIODO, CAT_FORA_DO_PERIODO, 'ENCERRADO'),
    ],
    ocorrenciasEstudantes: [
      { ocorrencia_id: 1, estudante_id: ID_ESTUDANTE_MUDOU },
      { ocorrencia_id: 1, estudante_id: ID_ESTUDANTE_6A },
      { ocorrencia_id: 1, estudante_id: ID_ESTUDANTE_1A },
      { ocorrencia_id: 2, estudante_id: ID_ESTUDANTE_MUDOU },
      { ocorrencia_id: 3, estudante_id: ID_ESTUDANTE_1A },
      { ocorrencia_id: 4, estudante_id: ID_ESTUDANTE_1A },
      { ocorrencia_id: 7, estudante_id: ID_ESTUDANTE_1A },
      { ocorrencia_id: 5, estudante_id: ID_ESTUDANTE_6A },
      { ocorrencia_id: 6, estudante_id: ID_ESTUDANTE_6A },
    ],
    encaminhamentos: [],
    historicos: [],
    logs: [],
  };
}

const ROTULO_6A = '6º A — Ensino Fundamental (2026)';
const ROTULO_1A = '1º A — Ensino Médio (2026)';

beforeEach(() => {
  process.env.JWT_SECRET = SEGREDO_TESTE;
  banco = montarBanco();
  operacoes = [];
});

afterEach(() => {
  delete process.env.JWT_SECRET;
});

function token(id) {
  const u = banco.usuarios.find((x) => x.id === id);
  return jwt.sign({ id, perfil: u.perfil }, SEGREDO_TESTE, { algorithm: 'HS256', expiresIn: '8h' });
}

function getRelatorio(query, usuarioId = ID_GESTAO) {
  const req = request(app).get('/relatorios').query(query);
  return usuarioId ? req.set('Authorization', `Bearer ${token(usuarioId)}`) : req;
}

/** Operações feitas pelo relatório (sem a leitura do usuário pela autenticação). */
const operacoesDoRelatorio = () => operacoes.filter((o) => o !== 'usuario.findUnique');

// ---------------------------------------------------------------------------
// Autenticação e perfil lidos do banco (RN01, RN09)
// ---------------------------------------------------------------------------
describe('GET /relatorios (QA) — sessão e perfil', () => {
  it('usuário Gestão INATIVO → 401, sem consultar ocorrências', async () => {
    banco.usuarios.find((u) => u.id === ID_GESTAO).status = 'INATIVO';
    const resposta = await getRelatorio({ tipo: 'periodo', ...PERIODO_OUTUBRO });
    expect(resposta.status).toBe(401);
    expect(operacoesDoRelatorio()).toEqual([]);
  });

  it('vale o perfil do banco, não o do token: token Gestão de quem hoje é Professor → 403', async () => {
    const t = token(ID_GESTAO);
    banco.usuarios.find((u) => u.id === ID_GESTAO).perfil = 'PROFESSOR';
    const resposta = await request(app)
      .get('/relatorios')
      .query({ tipo: 'periodo', ...PERIODO_OUTUBRO })
      .set('Authorization', `Bearer ${t}`);
    expect(resposta.status).toBe(403);
    expect(resposta.body).toEqual({ erro: MENSAGEM_PERFIL_SEM_PERMISSAO });
    expect(operacoesDoRelatorio()).toEqual([]);
  });

  it('token Professor de quem hoje é Pedagógico → 200', async () => {
    const t = token(ID_PROFESSOR);
    banco.usuarios.find((u) => u.id === ID_PROFESSOR).perfil = 'PEDAGOGICO';
    const resposta = await request(app)
      .get('/relatorios')
      .query({ tipo: 'periodo', ...PERIODO_OUTUBRO })
      .set('Authorization', `Bearer ${t}`);
    expect(resposta.status).toBe(200);
    expect(resposta.body.total).toBe(5);
  });

  const proibidos = [
    ['PROFESSOR', ID_PROFESSOR],
    ['TUTOR', ID_TUTOR],
    ['TECNICO_ADMINISTRATIVO', ID_TECNICO],
  ];
  it.each(proibidos.flatMap(([p, id]) => TIPOS_RELATORIO.map((tipo) => [p, tipo, id])))(
    '%s com tipo %s → 403',
    async (_perfil, tipo, id) => {
      const resposta = await getRelatorio({ tipo, ...PERIODO_OUTUBRO }, id);
      expect(resposta.status).toBe(403);
      expect(operacoesDoRelatorio()).toEqual([]);
    },
  );

  it.each(['post', 'put', 'patch', 'delete'])('%s /relatorios (Gestão) → 404, nada é gravado', async (metodo) => {
    const resposta = await request(app)
      [metodo]('/relatorios')
      .set('Authorization', `Bearer ${token(ID_GESTAO)}`)
      .send({ tipo: 'periodo' });
    expect(resposta.status).toBe(404);
    expect(operacoesDoRelatorio()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Contagens (RF13, RN14)
// ---------------------------------------------------------------------------
describe('GET /relatorios (QA) — contagens', () => {
  it('o total é o mesmo nos três tipos e é a soma das linhas', async () => {
    const totais = [];
    for (const tipo of TIPOS_RELATORIO) {
      const { body } = await getRelatorio({ tipo, ...PERIODO_OUTUBRO });
      totais.push(body.total);
      if (tipo !== 'periodo') expect(body.linhas.reduce((s, l) => s + l.quantidade, 0)).toBe(body.total);
    }
    expect(new Set(totais).size).toBe(1);
  });

  it('ocorrência com estudantes de várias turmas conta só na turma de referência (RN14)', async () => {
    // Ocorrência 1 (turma 6º A) envolve estudantes que hoje estão na 1º A e na 6º A.
    const { body } = await getRelatorio({ tipo: 'turma', dataInicio: '2026-10-01', dataFim: '2026-10-01' });
    expect(body.total).toBe(1);
    expect(body.linhas).toEqual([{ id: TURMA_6A, rotulo: ROTULO_6A, quantidade: 1 }]);
  });

  it('turmas com o mesmo nome e etapa em anos letivos diferentes são linhas distintas', async () => {
    banco.turmas.push({ id: 8, nome: '6º A', etapa: 'Ensino Fundamental', ano_letivo: 2025 });
    banco.ocorrencias.push({ ...banco.ocorrencias[0], id: 30, turma_id: 8, data_hora: new Date('2026-10-05T12:00:00.000Z') });
    const { body } = await getRelatorio({ tipo: 'turma', ...PERIODO_OUTUBRO });
    expect(body.total).toBe(6);
    expect(body.linhas).toEqual([
      { id: TURMA_1A, rotulo: ROTULO_1A, quantidade: 3 },
      { id: 8, rotulo: '6º A — Ensino Fundamental (2025)', quantidade: 1 },
      { id: TURMA_6A, rotulo: ROTULO_6A, quantidade: 2 },
    ]);
  });

  it('ordem natural pela rota: "6º A" antes de "10º A" (decisão do Rafael, 12/11/2026)', async () => {
    banco.turmas.push({ id: 9, nome: '10º A', etapa: 'Ensino Fundamental', ano_letivo: 2026 });
    banco.ocorrencias.push({ ...banco.ocorrencias[0], id: 31, turma_id: 9, data_hora: new Date('2026-10-06T12:00:00.000Z') });
    const { body } = await getRelatorio({ tipo: 'turma', ...PERIODO_OUTUBRO });
    expect(body.linhas.map((l) => l.id)).toEqual([TURMA_1A, TURMA_6A, 9]);
  });

  it('parâmetros fora do contrato (filtros do GET /ocorrencias) são ignorados', async () => {
    const base = await getRelatorio({ tipo: 'categoria', ...PERIODO_OUTUBRO });
    const comExtras = await getRelatorio({
      tipo: 'categoria',
      ...PERIODO_OUTUBRO,
      turmaId: String(TURMA_6A),
      categoriaId: String(CAT_CONFLITOS),
      status: 'ABERTO',
      estudanteId: String(ID_ESTUDANTE_1A),
      pagina: '2',
    });
    expect(comExtras.status).toBe(200);
    expect(comExtras.body).toEqual(base.body);
  });

  it('faixa técnica completa (0001-01-01 a 9999-12-31) conta todas as ocorrências', async () => {
    const resposta = await getRelatorio({ tipo: 'periodo', dataInicio: '0001-01-01', dataFim: '9999-12-31' });
    expect(resposta.status).toBe(200);
    expect(resposta.body.total).toBe(banco.ocorrencias.length);
  });

  it('linhas com tipos corretos e em ordem alfabética do rótulo', async () => {
    const { body } = await getRelatorio({ tipo: 'categoria', ...PERIODO_OUTUBRO });
    const rotulos = body.linhas.map((l) => l.rotulo);
    expect(rotulos).toEqual([...rotulos].sort((a, b) => a.localeCompare(b, 'pt-BR', { numeric: true })));
    for (const l of body.linhas) {
      expect(typeof l.rotulo).toBe('string');
      expect(Number.isInteger(l.id)).toBe(true);
      expect(Number.isInteger(l.quantidade)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Período em São Paulo (RN17)
// ---------------------------------------------------------------------------
describe('GET /relatorios (QA) — período em São Paulo', () => {
  it('dia de início do horário de verão de 2018 (04/11, sem meia-noite) usa o deslocamento real', async () => {
    banco.ocorrencias.push(
      // 03/11/2018 23h00 em SP (-03:00) — fica no dia 03/11.
      { ...banco.ocorrencias[0], id: 40, data_hora: new Date('2018-11-04T02:00:00.000Z') },
      // 04/11/2018 01h00 em SP (-02:00) — primeiro instante do dia.
      { ...banco.ocorrencias[0], id: 41, data_hora: new Date('2018-11-04T03:00:00.000Z') },
      // 04/11/2018 23h59 em SP (-02:00) = 05/11 01h59 UTC — ainda no dia 04/11.
      { ...banco.ocorrencias[0], id: 42, data_hora: new Date('2018-11-05T01:59:00.000Z') },
    );
    const dia3 = await getRelatorio({ tipo: 'periodo', dataInicio: '2018-11-03', dataFim: '2018-11-03' });
    expect(dia3.body.total).toBe(1);
    const dia4 = await getRelatorio({ tipo: 'periodo', dataInicio: '2018-11-04', dataFim: '2018-11-04' });
    expect(dia4.body.total).toBe(2);
  });

  it('virada de ano: 31/12 23h59 em SP (02h59 UTC de 01/01) conta no ano anterior', async () => {
    banco.ocorrencias.push({ ...banco.ocorrencias[0], id: 50, data_hora: new Date('2027-01-01T02:59:00.000Z') });
    const r2026 = await getRelatorio({ tipo: 'periodo', dataInicio: '2026-12-31', dataFim: '2026-12-31' });
    const r2027 = await getRelatorio({ tipo: 'periodo', dataInicio: '2027-01-01', dataFim: '2027-01-01' });
    expect(r2026.body.total).toBe(1);
    expect(r2027.body.total).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Validação (400)
// ---------------------------------------------------------------------------
describe('GET /relatorios (QA) — validação (400)', () => {
  it.each([
    ['tipo com espaços', { tipo: ' turma', ...PERIODO_OUTUBRO }, MENSAGEM_TIPO_RELATORIO_INVALIDO],
    ['tipo com colchetes (tipo[]=)', { 'tipo[]': 'turma', ...PERIODO_OUTUBRO }, MENSAGEM_TIPO_RELATORIO_INVALIDO],
    ['tipo e datas inválidos: valida o tipo primeiro', { tipo: 'x', dataInicio: 'x', dataFim: 'y' }, MENSAGEM_TIPO_RELATORIO_INVALIDO],
    ['ano 0000', { tipo: 'periodo', dataInicio: '0000-12-31', dataFim: '2026-10-31' }, MENSAGENS_PERIODO.dataInicioInvalida],
    ['ano com 5 dígitos', { tipo: 'periodo', dataInicio: '2026-10-01', dataFim: '10000-01-01' }, MENSAGENS_PERIODO.dataFimInvalida],
    ['29/02 em ano não bissexto', { tipo: 'periodo', dataInicio: '2027-02-29', dataFim: '2027-03-01' }, MENSAGENS_PERIODO.dataInicioInvalida],
    ['mês 13', { tipo: 'periodo', dataInicio: '2026-13-01', dataFim: '2026-12-31' }, MENSAGENS_PERIODO.dataInicioInvalida],
    ['dia 00', { tipo: 'periodo', dataInicio: '2026-10-00', dataFim: '2026-10-31' }, MENSAGENS_PERIODO.dataInicioInvalida],
    ['data com espaço no fim', { tipo: 'periodo', dataInicio: '2026-10-01 ', dataFim: '2026-10-31' }, MENSAGENS_PERIODO.dataInicioInvalida],
    ['dataInicio inválida e dataFim ausente', { tipo: 'periodo', dataInicio: 'abc' }, MENSAGENS_PERIODO.dataInicioInvalida],
    ['dataFim vazia', { tipo: 'categoria', dataInicio: '2026-10-01', dataFim: '' }, MENSAGENS_PERIODO.dataFimInvalida],
    ['intervalo invertido entre anos', { tipo: 'turma', dataInicio: '2027-01-01', dataFim: '2026-12-31' }, MENSAGENS_PERIODO.intervaloInvalido],
  ])('%s', async (_caso, query, mensagem) => {
    const resposta = await getRelatorio(query);
    expect(resposta.status).toBe(400);
    expect(resposta.body).toEqual({ erro: mensagem });
    expect(operacoesDoRelatorio()).toEqual([]);
  });

  it('29/02 em ano bissexto é válido', async () => {
    const resposta = await getRelatorio({ tipo: 'periodo', dataInicio: '2028-02-29', dataFim: '2028-02-29' });
    expect(resposta.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Visibilidade (RF14 / RN19) — service direto
// ---------------------------------------------------------------------------
describe('gerarRelatorio (QA) — visibilidade se a matriz mudar', () => {
  it('Tutor: conta as dos tutorados (vínculo atual), as que acompanha e as encaminhadas a ele, uma vez cada', async () => {
    const db = clientMock();
    const tutor = { id: ID_TUTOR, perfil: 'TUTOR' };
    // O tutor tutora o estudante "Alfa", envolvido nas ocorrências 1 e 2.
    let r = await gerarRelatorio({ tipo: 'turma', ...PERIODO_OUTUBRO }, tutor, { db });
    expect(r.total).toBe(2);
    expect(r.linhas).toEqual([{ id: TURMA_6A, rotulo: ROTULO_6A, quantidade: 2 }]);

    // Passa a acompanhar a 3 e recebe encaminhamento da 4; também acompanha e
    // recebe encaminhamento da 1 (já visível pela tutoria): conta uma vez.
    banco.ocorrencias.find((o) => o.id === 3).responsavel_acompanhamento_id = ID_TUTOR;
    banco.ocorrencias.find((o) => o.id === 1).responsavel_acompanhamento_id = ID_TUTOR;
    banco.encaminhamentos.push(
      { id: 1, ocorrencia_id: 4, destinatario_usuario_id: ID_TUTOR },
      { id: 2, ocorrencia_id: 1, destinatario_usuario_id: ID_TUTOR },
    );
    r = await gerarRelatorio({ tipo: 'periodo', ...PERIODO_OUTUBRO }, tutor, { db });
    expect(r.total).toBe(4);

    // Troca de tutor: o anterior deixa de ver pela tutoria (RN19).
    banco.estudantes.find((e) => e.id === ID_ESTUDANTE_MUDOU).tutor_id = null;
    r = await gerarRelatorio({ tipo: 'categoria', ...PERIODO_OUTUBRO }, tutor, { db });
    expect(r.total).toBe(3); // 1 (acompanha), 3 (acompanha), 4 (encaminhada)
    expect(r.linhas).toEqual([{ id: CAT_INDISCIPLINA, rotulo: 'Indisciplina', quantidade: 3 }]);
  });

  it('Técnico-administrativo: só as que registrou', async () => {
    banco.ocorrencias.find((o) => o.id === 3).profissional_responsavel_id = ID_TECNICO;
    const r = await gerarRelatorio(
      { tipo: 'turma', ...PERIODO_OUTUBRO },
      { id: ID_TECNICO, perfil: 'TECNICO_ADMINISTRATIVO' },
      { db: clientMock() },
    );
    expect(r.total).toBe(1);
    expect(r.linhas).toEqual([{ id: TURMA_1A, rotulo: ROTULO_1A, quantidade: 1 }]);
  });

  it('Pedagógico vê o mesmo que a Gestão nos três tipos', async () => {
    const db = clientMock();
    for (const tipo of TIPOS_RELATORIO) {
      const g = await gerarRelatorio({ tipo, ...PERIODO_OUTUBRO }, { id: ID_GESTAO, perfil: 'GESTAO' }, { db });
      const p = await gerarRelatorio({ tipo, ...PERIODO_OUTUBRO }, { id: ID_PEDAGOGICO, perfil: 'PEDAGOGICO' }, { db });
      expect(p).toEqual(g);
    }
  });
});
