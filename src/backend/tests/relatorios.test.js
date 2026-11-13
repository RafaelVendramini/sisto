// Testes de GET /relatorios (Issue #88, RF13, UC05, RN14, RN17, RN19) —
// somente dados fictícios (RN05).
// Não dependem do banco: src/lib/prisma.js é substituído por um "banco" em
// memória que AVALIA o `where` gerado pelo service (AND, OR, igualdade, `in`,
// `gte`/`lte`, `some` em listas e filtro em relação 1:1) e implementa
// `count` e `groupBy`. Operadores ou argumentos não previstos fazem o mock
// falhar (em vez de ignorar). Todas as operações são anotadas, para provar
// que a contagem é feita no banco (sem ler ocorrências) e que nada é gravado.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';

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

const linhas = (modelo) => banco[TABELA[modelo]];

function relacionado(modelo, registro, campo) {
  const [tipo, alvo, fk] = RELACOES[modelo][campo];
  if (tipo === 'um') {
    return registro[fk] == null ? null : linhas(alvo).find((r) => r.id === registro[fk]) ?? null;
  }
  return linhas(alvo).filter((r) => r[fk] === registro.id);
}

const comparavel = (v) => (v instanceof Date ? v.getTime() : v);

/** Avalia um `where` do Prisma sobre um registro. */
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
    if (!(chave in registro)) throw new Error(`mock: campo inexistente ${modelo}.${chave}`);
    const valor = comparavel(registro[chave]);
    if (condicao !== null && typeof condicao === 'object' && !(condicao instanceof Date)) {
      return Object.entries(condicao).every(([operador, alvo]) => {
        if (operador === 'in') return alvo.includes(registro[chave]);
        if (!(alvo instanceof Date)) throw new Error(`mock: ${operador} exige Date em ${modelo}.${chave}`);
        if (operador === 'gte') return valor >= comparavel(alvo);
        if (operador === 'lte') return valor <= comparavel(alvo);
        throw new Error(`mock: operador não suportado em ${modelo}.${chave}: ${operador}`);
      });
    }
    return valor === comparavel(condicao);
  });
}

function selecionar(modelo, registro, select) {
  if (!select) return { ...registro };
  return Object.fromEntries(
    Object.entries(select).map(([campo, valor]) => {
      if (valor !== true) throw new Error(`mock: select aninhado não previsto em ${modelo}.${campo}`);
      if (!(campo in registro)) throw new Error(`mock: campo inexistente ${modelo}.${campo}`);
      return [campo, registro[campo]];
    }),
  );
}

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
// Permissões (RN01 / UC05)
// ---------------------------------------------------------------------------
describe('GET /relatorios — permissões', () => {
  it('só GESTAO e PEDAGOGICO têm acesso', () => {
    expect(PERFIS_RELATORIOS).toEqual(['GESTAO', 'PEDAGOGICO']);
  });

  it.each([
    ['GESTAO', ID_GESTAO],
    ['PEDAGOGICO', ID_PEDAGOGICO],
  ])('%s → 200 (vê todas as ocorrências)', async (_perfil, id) => {
    const resposta = await getRelatorio({ tipo: 'periodo', ...PERIODO_OUTUBRO }, id);
    expect(resposta.status).toBe(200);
    expect(resposta.body.total).toBe(5);
  });

  it.each([
    ['PROFESSOR', ID_PROFESSOR],
    ['TUTOR', ID_TUTOR],
    ['TECNICO_ADMINISTRATIVO', ID_TECNICO],
  ])('%s → 403, sem consultar ocorrências', async (_perfil, id) => {
    const resposta = await getRelatorio({ tipo: 'periodo', ...PERIODO_OUTUBRO }, id);
    expect(resposta.status).toBe(403);
    expect(resposta.body).toEqual({ erro: MENSAGEM_PERFIL_SEM_PERMISSAO });
    expect(operacoesDoRelatorio()).toEqual([]);
  });

  it('o 403 de perfil vem antes da validação dos parâmetros', async () => {
    const resposta = await getRelatorio({ tipo: 'xyz' }, ID_PROFESSOR);
    expect(resposta.status).toBe(403);
  });

  it('sem token → 401', async () => {
    const resposta = await getRelatorio({ tipo: 'periodo', ...PERIODO_OUTUBRO }, null);
    expect(resposta.status).toBe(401);
    expect(resposta.body).toEqual({ erro: MENSAGEM_NAO_AUTENTICADO });
    expect(operacoes).toEqual([]);
  });

  it('token inválido → 401', async () => {
    const resposta = await request(app)
      .get('/relatorios')
      .query({ tipo: 'periodo', ...PERIODO_OUTUBRO })
      .set('Authorization', 'Bearer token.invalido.ficticio');
    expect(resposta.status).toBe(401);
  });

  it('troca de senha pendente (mesmo Gestão) → 403', async () => {
    const resposta = await getRelatorio({ tipo: 'periodo', ...PERIODO_OUTUBRO }, ID_TROCA_PENDENTE);
    expect(resposta.status).toBe(403);
    expect(resposta.body).toEqual({ erro: MENSAGEM_TROCA_SENHA_OBRIGATORIA });
    expect(operacoesDoRelatorio()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Contagens (RF13, RN14)
// ---------------------------------------------------------------------------
describe('GET /relatorios — contagens', () => {
  it('tipo periodo: só o total do intervalo, linhas vazias', async () => {
    const resposta = await getRelatorio({ tipo: 'periodo', ...PERIODO_OUTUBRO });
    expect(resposta.status).toBe(200);
    expect(resposta.body).toEqual({
      tipo: 'periodo',
      dataInicio: '2026-10-01',
      dataFim: '2026-10-31',
      total: 5,
      linhas: [],
    });
  });

  it('tipo turma: uma linha por turma da ocorrência, ordem alfabética do rótulo', async () => {
    const resposta = await getRelatorio({ tipo: 'turma', ...PERIODO_OUTUBRO }, ID_PEDAGOGICO);
    expect(resposta.status).toBe(200);
    expect(resposta.body).toEqual({
      tipo: 'turma',
      dataInicio: '2026-10-01',
      dataFim: '2026-10-31',
      total: 5,
      linhas: [
        { id: TURMA_1A, rotulo: ROTULO_1A, quantidade: 3 },
        { id: TURMA_6A, rotulo: ROTULO_6A, quantidade: 2 },
      ],
    });
  });

  it('tipo categoria: uma linha por categoria, ordem alfabética do rótulo', async () => {
    const resposta = await getRelatorio({ tipo: 'categoria', ...PERIODO_OUTUBRO });
    expect(resposta.status).toBe(200);
    expect(resposta.body).toEqual({
      tipo: 'categoria',
      dataInicio: '2026-10-01',
      dataFim: '2026-10-31',
      total: 5,
      linhas: [
        { id: CAT_CONFLITOS, rotulo: 'Conflitos', quantidade: 2 },
        { id: CAT_INDISCIPLINA, rotulo: 'Indisciplina', quantidade: 3 },
      ],
    });
  });

  it('ocorrência com vários estudantes conta uma vez', async () => {
    // Só a ocorrência 1 (três estudantes) no dia 01/10.
    const dia = { dataInicio: '2026-10-01', dataFim: '2026-10-01' };
    for (const tipo of TIPOS_RELATORIO) {
      const resposta = await getRelatorio({ tipo, ...dia });
      expect(resposta.status).toBe(200);
      expect(resposta.body.total).toBe(1);
      if (tipo !== 'periodo') expect(resposta.body.linhas.map((l) => l.quantidade)).toEqual([1]);
    }
  });

  it('ocorrências nos três status entram na contagem', async () => {
    const status = new Set(banco.ocorrencias.filter((o) => o.id <= 4 || o.id === 7).map((o) => o.status));
    expect([...status].sort()).toEqual(['ABERTO', 'EM_ACOMPANHAMENTO', 'ENCERRADO']);
    // Muda todas para um único status e confere que o total não depende dele.
    for (const unico of ['ABERTO', 'EM_ACOMPANHAMENTO', 'ENCERRADO']) {
      banco.ocorrencias.forEach((o) => (o.status = unico));
      const resposta = await getRelatorio({ tipo: 'periodo', ...PERIODO_OUTUBRO });
      expect(resposta.body.total).toBe(5);
    }
  });

  it('o tipo turma usa a turma da ocorrência, mesmo que o estudante tenha mudado de turma (RN14)', async () => {
    // O estudante da ocorrência 2 (turma 6º A) está hoje na 1º A.
    expect(banco.estudantes.find((e) => e.id === ID_ESTUDANTE_MUDOU).turma_id).toBe(TURMA_1A);
    const antes = await getRelatorio({ tipo: 'turma', ...PERIODO_OUTUBRO });
    // Todos os estudantes trocam de turma de novo: o relatório não muda.
    banco.estudantes.forEach((e) => (e.turma_id = TURMA_SEM_OCORRENCIA));
    const depois = await getRelatorio({ tipo: 'turma', ...PERIODO_OUTUBRO });
    expect(depois.body).toEqual(antes.body);
    expect(depois.body.linhas.find((l) => l.id === TURMA_6A).quantidade).toBe(2);
  });

  it('sem linhas com zero: turmas e categorias sem ocorrência no intervalo não aparecem', async () => {
    const turma = await getRelatorio({ tipo: 'turma', ...PERIODO_OUTUBRO });
    const categoria = await getRelatorio({ tipo: 'categoria', ...PERIODO_OUTUBRO });
    const idsTurma = turma.body.linhas.map((l) => l.id);
    const idsCategoria = categoria.body.linhas.map((l) => l.id);
    expect(idsTurma).not.toContain(TURMA_SEM_OCORRENCIA);
    expect(idsTurma).not.toContain(TURMA_FORA_DO_PERIODO);
    expect(idsCategoria).not.toContain(CAT_SEM_OCORRENCIA);
    expect(idsCategoria).not.toContain(CAT_FORA_DO_PERIODO);
    for (const l of [...turma.body.linhas, ...categoria.body.linhas]) expect(l.quantidade).toBeGreaterThan(0);
  });

  it('intervalo sem ocorrências: total 0 e nenhuma linha', async () => {
    const vazio = { dataInicio: '2026-12-01', dataFim: '2026-12-31' };
    for (const tipo of TIPOS_RELATORIO) {
      const resposta = await getRelatorio({ tipo, ...vazio });
      expect(resposta.status).toBe(200);
      expect(resposta.body).toEqual({ tipo, ...vazio, total: 0, linhas: [] });
    }
  });

  it('ordem alfabética em pt-BR (acentos) e, no empate do rótulo, pelo id', async () => {
    banco.categorias.push(
      { id: 10, nome: 'Ética', descricao: null },
      { id: 11, nome: 'Furto', descricao: null },
      { id: 12, nome: 'evasão', descricao: null },
    );
    const extra = (id, categoria) => ({
      ...banco.ocorrencias[0],
      id,
      categoria_id: categoria,
      data_hora: new Date('2026-10-05T12:00:00.000Z'),
    });
    banco.ocorrencias.push(extra(20, 11), extra(21, 10), extra(22, 12));
    const resposta = await getRelatorio({ tipo: 'categoria', ...PERIODO_OUTUBRO });
    expect(resposta.body.linhas.map((l) => l.rotulo)).toEqual([
      'Conflitos',
      'Ética',
      'evasão',
      'Furto',
      'Indisciplina',
    ]);
  });
});

// ---------------------------------------------------------------------------
// Limites do período em São Paulo (RN17)
// ---------------------------------------------------------------------------
describe('GET /relatorios — limites do período em São Paulo', () => {
  it('as duas pontas entram (00:00:00.000 do início e 23:59:59.999 do fim)', async () => {
    // Ocorrências 1 (ponta inicial) e 2 (ponta final) estão no total de 5.
    const soPontas = await getRelatorio({ tipo: 'periodo', dataInicio: '2026-10-01', dataFim: '2026-10-01' });
    expect(soPontas.body.total).toBe(1); // ocorrência 1
    const ultimoDia = await getRelatorio({ tipo: 'periodo', dataInicio: '2026-10-31', dataFim: '2026-10-31' });
    expect(ultimoDia.body.total).toBe(1); // ocorrência 2
  });

  it('o instante anterior ao início e o posterior ao fim ficam de fora', async () => {
    const setembro = await getRelatorio({ tipo: 'categoria', dataInicio: '2026-09-30', dataFim: '2026-09-30' });
    expect(setembro.body.total).toBe(1); // ocorrência 5 (30/09 23:59:59.999 em SP)
    expect(setembro.body.linhas).toEqual([{ id: CAT_FORA_DO_PERIODO, rotulo: 'Ameaça', quantidade: 1 }]);
    const novembro = await getRelatorio({ tipo: 'periodo', dataInicio: '2026-11-01', dataFim: '2026-11-01' });
    expect(novembro.body.total).toBe(1); // ocorrência 6 (01/11 00:00 em SP)
  });

  it('23h30 de São Paulo (02h30 UTC do dia seguinte) conta no dia de São Paulo', async () => {
    const dia10 = await getRelatorio({ tipo: 'turma', dataInicio: '2026-10-10', dataFim: '2026-10-10' });
    expect(dia10.body.total).toBe(1);
    expect(dia10.body.linhas).toEqual([{ id: TURMA_1A, rotulo: ROTULO_1A, quantidade: 1 }]);
    const dia11 = await getRelatorio({ tipo: 'turma', dataInicio: '2026-10-11', dataFim: '2026-10-11' });
    expect(dia11.body).toEqual({ tipo: 'turma', dataInicio: '2026-10-11', dataFim: '2026-10-11', total: 0, linhas: [] });
  });
});

// ---------------------------------------------------------------------------
// Validação (400)
// ---------------------------------------------------------------------------
describe('GET /relatorios — validação (400)', () => {
  it.each([
    ['tipo ausente', { ...PERIODO_OUTUBRO }],
    ['tipo vazio', { tipo: '', ...PERIODO_OUTUBRO }],
    ['tipo inexistente', { tipo: 'estudante', ...PERIODO_OUTUBRO }],
    ['tipo em maiúsculas', { tipo: 'PERIODO', ...PERIODO_OUTUBRO }],
    ['tipo repetido', { tipo: ['turma', 'categoria'], ...PERIODO_OUTUBRO }],
  ])('%s', async (_caso, query) => {
    const resposta = await getRelatorio(query);
    expect(resposta.status).toBe(400);
    expect(resposta.body).toEqual({ erro: MENSAGEM_TIPO_RELATORIO_INVALIDO });
    expect(operacoesDoRelatorio()).toEqual([]);
  });

  it.each([
    ['dataInicio ausente', { dataFim: '2026-10-31' }, MENSAGENS_PERIODO.dataInicioObrigatoria],
    ['dataFim ausente', { dataInicio: '2026-10-01' }, MENSAGENS_PERIODO.dataFimObrigatoria],
    ['as duas ausentes', {}, MENSAGENS_PERIODO.dataInicioObrigatoria],
    ['dataInicio vazia', { dataInicio: '', dataFim: '2026-10-31' }, MENSAGENS_PERIODO.dataInicioInvalida],
    ['dataInicio fora do formato', { dataInicio: '01/10/2026', dataFim: '2026-10-31' }, MENSAGENS_PERIODO.dataInicioInvalida],
    ['dataInicio com hora', { dataInicio: '2026-10-01T00:00:00Z', dataFim: '2026-10-31' }, MENSAGENS_PERIODO.dataInicioInvalida],
    ['dataFim inexistente', { dataInicio: '2026-02-01', dataFim: '2026-02-30' }, MENSAGENS_PERIODO.dataFimInvalida],
    ['dataFim fora do formato', { dataInicio: '2026-10-01', dataFim: '2026-10-1' }, MENSAGENS_PERIODO.dataFimInvalida],
    ['dataFim repetida', { dataInicio: '2026-10-01', dataFim: ['2026-10-30', '2026-10-31'] }, MENSAGENS_PERIODO.dataFimInvalida],
    ['dataInicio posterior a dataFim', { dataInicio: '2026-11-01', dataFim: '2026-10-31' }, MENSAGENS_PERIODO.intervaloInvalido],
  ])('%s', async (_caso, datas, mensagem) => {
    const resposta = await getRelatorio({ tipo: 'turma', ...datas });
    expect(resposta.status).toBe(400);
    expect(resposta.body).toEqual({ erro: mensagem });
    expect(operacoesDoRelatorio()).toEqual([]);
  });

  it('dataInicio igual a dataFim é válido', async () => {
    const resposta = await getRelatorio({ tipo: 'periodo', dataInicio: '2026-10-15', dataFim: '2026-10-15' });
    expect(resposta.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Dados pessoais, gravação e desempenho
// ---------------------------------------------------------------------------
describe('GET /relatorios — sem dados pessoais, sem gravação, contagem no banco', () => {
  it('a resposta não contém dados pessoais nem textos das ocorrências', async () => {
    for (const tipo of TIPOS_RELATORIO) {
      const resposta = await getRelatorio({ tipo, ...PERIODO_OUTUBRO });
      expect(Object.keys(resposta.body).sort()).toEqual(['dataFim', 'dataInicio', 'linhas', 'tipo', 'total']);
      for (const linha of resposta.body.linhas) {
        expect(Object.keys(linha).sort()).toEqual(['id', 'quantidade', 'rotulo']);
      }
      const texto = JSON.stringify(resposta.body);
      const proibidos = [
        ...banco.estudantes.flatMap((e) => [e.nome_completo, e.codigo_escolar]),
        ...banco.usuarios.flatMap((u) => [u.nome, u.email]),
        ...banco.ocorrencias.flatMap((o) => [o.descricao, o.local]),
        'Estudante',
        'TESTE-',
        '@',
      ];
      for (const valor of proibidos) expect(texto).not.toContain(valor);
    }
  });

  it('a leitura não grava histórico nem auditoria (nenhuma escrita)', async () => {
    for (const tipo of TIPOS_RELATORIO) {
      await getRelatorio({ tipo, ...PERIODO_OUTUBRO });
    }
    expect(banco.historicos).toEqual([]);
    expect(banco.logs).toEqual([]);
    expect(operacoes.filter((o) => /\.(create|update|delete|upsert)/.test(o) || o === '$transaction')).toEqual([]);
  });

  it('conta no banco (count/groupBy), sem carregar ocorrências nem estudantes', async () => {
    await getRelatorio({ tipo: 'periodo', ...PERIODO_OUTUBRO });
    expect(operacoesDoRelatorio()).toEqual(['ocorrencia.count']);

    operacoes = [];
    await getRelatorio({ tipo: 'turma', ...PERIODO_OUTUBRO });
    expect(operacoesDoRelatorio()).toEqual(['ocorrencia.groupBy', 'turma.findMany']);

    operacoes = [];
    await getRelatorio({ tipo: 'categoria', ...PERIODO_OUTUBRO });
    expect(operacoesDoRelatorio()).toEqual(['ocorrencia.groupBy', 'categoria.findMany']);

    operacoes = [];
    await getRelatorio({ tipo: 'turma', dataInicio: '2026-12-01', dataFim: '2026-12-31' });
    expect(operacoesDoRelatorio()).toEqual(['ocorrencia.groupBy']); // sem grupos, não lê turmas
  });
});

// ---------------------------------------------------------------------------
// Visibilidade (RF14 / RN19) e rótulo — service direto
// ---------------------------------------------------------------------------
describe('gerarRelatorio — visibilidade e rótulo', () => {
  it('a contagem passa por filtroVisibilidadeOcorrencias (perfil com visibilidade restrita conta só o que vê)', async () => {
    // A rota barra o Professor (403); aqui o service é chamado direto para
    // provar que a contagem respeitaria a matriz se ela mudar.
    const db = clientMock();
    const professor = { id: ID_PROFESSOR, perfil: 'PROFESSOR' };
    const periodo = await gerarRelatorio({ tipo: 'periodo', ...PERIODO_OUTUBRO }, professor, { db });
    expect(periodo.total).toBe(1); // só a ocorrência 7, que ele registrou
    const categoria = await gerarRelatorio({ tipo: 'categoria', ...PERIODO_OUTUBRO }, professor, { db });
    expect(categoria.linhas).toEqual([{ id: CAT_CONFLITOS, rotulo: 'Conflitos', quantidade: 1 }]);
    const gestao = await gerarRelatorio({ tipo: 'periodo', ...PERIODO_OUTUBRO }, { id: ID_GESTAO, perfil: 'GESTAO' }, { db });
    expect(gestao.total).toBe(5);
  });

  it('sem usuário autenticado o service falha fechado', async () => {
    await expect(gerarRelatorio({ tipo: 'periodo', ...PERIODO_OUTUBRO }, undefined, { db: clientMock() })).rejects.toThrow();
  });

  it('rótulo da turma: nome, etapa e ano letivo', () => {
    expect(rotuloTurma({ nome: '6º A', etapa: 'Ensino Fundamental', ano_letivo: 2026 })).toBe(ROTULO_6A);
  });
});
