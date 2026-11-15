// Testes dos filtros e da paginação do GET /ocorrencias (Issue #86 — RF11,
// RF14, UC03, RN01, RN02, RN14, RN17, RN19) — somente dados fictícios (RN05).
// Não dependem do banco: src/lib/prisma.js é substituído por um "banco" em
// memória que AVALIA o `where` gerado pelo service (AND, OR, igualdade, `in`,
// `gte`/`lte` em datas, `some` em listas e filtro em relação 1:1), com
// `count`, `skip` e `take`. Operadores não previstos fazem o mock falhar.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';

const mocks = vi.hoisted(() => ({ $transaction: vi.fn() }));

let banco;
/** Consultas feitas DENTRO da transação ("modelo.operacao"), em ordem. */
let consultasTx;
/** `where` recebido pelo count de ocorrências (o mesmo do findMany). */
let whereContagem;

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
};

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
  estudante: { turma: ['um', 'turma', 'turma_id'] },
};

const linhas = (modelo) => banco[TABELA[modelo]];
const comoNumero = (v) => (v instanceof Date ? v.getTime() : v);

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
    if (!(chave in registro)) throw new Error(`mock: campo inexistente ${modelo}.${chave}`);
    const valor = registro[chave];
    if (condicao !== null && typeof condicao === 'object' && !(condicao instanceof Date)) {
      return Object.entries(condicao).every(([operador, alvo]) => {
        if (operador === 'in') return alvo.includes(valor);
        if (operador === 'gte') {
          if (!(alvo instanceof Date)) throw new Error('mock: gte espera Date');
          return comoNumero(valor) >= alvo.getTime();
        }
        if (operador === 'lte') {
          if (!(alvo instanceof Date)) throw new Error('mock: lte espera Date');
          return comoNumero(valor) <= alvo.getTime();
        }
        throw new Error(`mock: operador ${operador} não suportado em ${modelo}.${chave}`);
      });
    }
    return comoNumero(valor) === comoNumero(condicao);
  });
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
  return { valor: comoNumero(registro[campo]), direcao };
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

function delegado(modelo, emTransacao) {
  const anotar = (operacao) => {
    if (emTransacao) consultasTx.push(`${modelo}.${operacao}`);
  };
  const buscar = (args = {}) =>
    ordenar(modelo, linhas(modelo).filter((r) => corresponde(modelo, r, args.where)), args.orderBy);
  return {
    findMany: async (args = {}) => {
      anotar('findMany');
      const inicio = args.skip ?? 0;
      const fim = args.take === undefined ? undefined : inicio + args.take;
      return buscar(args).slice(inicio, fim).map((r) => selecionar(modelo, r, args.select));
    },
    count: async (args = {}) => {
      anotar('count');
      if (modelo === 'ocorrencia') whereContagem = args.where;
      return buscar(args).length;
    },
    findFirst: async (args = {}) => {
      anotar('findFirst');
      const [r] = buscar(args);
      return r ? selecionar(modelo, r, args.select) : null;
    },
    findUnique: async (args = {}) => {
      anotar('findUnique');
      const [r] = buscar(args);
      return r ? selecionar(modelo, r, args.select) : null;
    },
  };
}

function clientMock(emTransacao) {
  return Object.fromEntries(Object.keys(TABELA).map((m) => [m, delegado(m, emTransacao)]));
}

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
const {
  MENSAGEM_FILTRO_CATEGORIA_INVALIDO,
  MENSAGEM_FILTRO_ESTUDANTE_INVALIDO,
  MENSAGEM_FILTRO_PROFISSIONAL_INVALIDO,
  MENSAGEM_FILTRO_STATUS_INVALIDO,
  MENSAGEM_FILTRO_TURMA_INVALIDO,
  MENSAGEM_PAGINA_INVALIDA,
  STATUS_OCORRENCIA,
  TAMANHO_PAGINA_OCORRENCIAS,
  condicoesFiltrosOcorrencias,
  filtroVisibilidadeOcorrencias,
  validarFiltrosOcorrencias,
} = await import('../src/services/ocorrencias.js');
const { MENSAGENS_PERIODO } = await import('../src/services/periodo.js');

// ---------------------------------------------------------------------------
// Cenário fictício
// ---------------------------------------------------------------------------

const SEGREDO_TESTE = 'segredo-ficticio-de-teste-com-mais-de-32-caracteres';
const ID_GESTAO = 1;
const ID_PEDAGOGICO = 2;
const ID_PROFESSOR = 3;
const ID_TUTOR = 4;
const ID_PROFESSOR_B = 5;
const ID_TECNICO = 6;

const E_TUTORADO = 1; // turma 1, tutor ID_TUTOR
const E_SEM_TUTOR = 2; // turma 2
const E_MUDOU_TURMA = 3; // estava na turma 1 na O4; hoje está na turma 2

// Datas pensadas para as bordas dos dias de São Paulo (UTC-03:00):
// O1 = 23h30 de 09/10 em SP (02h30 UTC de 10/10);
// O2 = 00:00:00.000 de 10/10 em SP; O3 = 23:59:59.999 de 10/10 em SP;
// O4 = 00:00:00.000 de 11/10 em SP; O5 = 23:59:59.999 de 08/10 em SP.
const OCORRENCIAS = [
  { id: 1, iso: '2026-10-10T02:30:00.000Z', turma: 1, categoria: 1, status: 'ABERTO', prof: ID_PROFESSOR, est: [E_TUTORADO] },
  { id: 2, iso: '2026-10-10T03:00:00.000Z', turma: 1, categoria: 2, status: 'EM_ACOMPANHAMENTO', prof: ID_PROFESSOR_B, est: [E_SEM_TUTOR], resp: ID_PEDAGOGICO },
  { id: 3, iso: '2026-10-11T02:59:59.999Z', turma: 2, categoria: 1, status: 'ENCERRADO', prof: ID_PROFESSOR, est: [E_SEM_TUTOR, E_MUDOU_TURMA] },
  { id: 4, iso: '2026-10-11T03:00:00.000Z', turma: 1, categoria: 1, status: 'ABERTO', prof: ID_PROFESSOR_B, est: [E_MUDOU_TURMA] },
  { id: 5, iso: '2026-10-09T02:59:59.999Z', turma: 2, categoria: 2, status: 'ABERTO', prof: ID_TUTOR, est: [E_SEM_TUTOR] },
  { id: 6, iso: '2026-10-12T15:00:00.000Z', turma: 3, categoria: 1, status: 'ABERTO', prof: ID_TECNICO, est: [E_SEM_TUTOR] },
];
// Ordem geral (data/hora desc): 6, 4, 3, 2, 1, 5.

function usuario(id, perfil) {
  return {
    id,
    nome: `Usuário Fictício ${id}`,
    email: `usuario${id}@sisto.exemplo`,
    senha_hash: 'hash-ficticio',
    perfil,
    status: 'ATIVO',
    troca_senha_obrigatoria: false,
    senha_alterada_em: null,
  };
}

function ocorrencia({ id, iso, turma, categoria, status, prof, resp = null }) {
  return {
    id,
    data_hora: new Date(iso),
    local: `Local fictício ${id}`,
    turma_id: turma,
    categoria_id: categoria,
    descricao: `Descrição fictícia ${id}.`,
    profissional_responsavel_id: prof,
    responsavel_acompanhamento_id: resp,
    status,
    data_encerramento: null,
  };
}

function montarBanco() {
  return {
    usuarios: [
      usuario(ID_GESTAO, 'GESTAO'),
      usuario(ID_PEDAGOGICO, 'PEDAGOGICO'),
      usuario(ID_PROFESSOR, 'PROFESSOR'),
      usuario(ID_TUTOR, 'TUTOR'),
      usuario(ID_PROFESSOR_B, 'PROFESSOR'),
      usuario(ID_TECNICO, 'TECNICO_ADMINISTRATIVO'),
    ],
    turmas: [
      { id: 1, nome: '6º A', etapa: 'Ensino Fundamental', ano_letivo: 2026 },
      { id: 2, nome: '7º B', etapa: 'Ensino Fundamental', ano_letivo: 2026 },
      { id: 3, nome: '1º A', etapa: 'Ensino Médio', ano_letivo: 2026 },
    ],
    categorias: [
      { id: 1, nome: 'Indisciplina' },
      { id: 2, nome: 'Conflitos' },
    ],
    estudantes: [
      { id: E_TUTORADO, nome_completo: 'Estudante Fictício Alfa', turma_id: 1, tutor_id: ID_TUTOR },
      { id: E_SEM_TUTOR, nome_completo: 'Estudante Fictício Beta', turma_id: 2, tutor_id: null },
      { id: E_MUDOU_TURMA, nome_completo: 'Estudante Fictício Gama', turma_id: 2, tutor_id: null },
    ],
    ocorrencias: OCORRENCIAS.map(ocorrencia),
    ocorrenciasEstudantes: OCORRENCIAS.flatMap((o) =>
      o.est.map((estudanteId) => ({ ocorrencia_id: o.id, estudante_id: estudanteId })),
    ),
    encaminhamentos: [],
  };
}

/** Acrescenta `n` ocorrências fictícias (ids a partir de 101), 1 por hora. */
function acrescentarOcorrencias(n, extra = {}) {
  for (let i = 0; i < n; i += 1) {
    const id = 101 + i;
    banco.ocorrencias.push(
      ocorrencia({
        id,
        iso: new Date(Date.UTC(2026, 8, 1, 12) + i * 3_600_000).toISOString(),
        turma: 3,
        categoria: 2,
        status: 'ABERTO',
        prof: ID_PROFESSOR_B,
        ...extra,
      }),
    );
    banco.ocorrenciasEstudantes.push({ ocorrencia_id: id, estudante_id: E_SEM_TUTOR });
  }
}

beforeEach(() => {
  process.env.JWT_SECRET = SEGREDO_TESTE;
  banco = montarBanco();
  consultasTx = [];
  whereContagem = undefined;
  mocks.$transaction.mockReset();
  mocks.$transaction.mockImplementation(async (operacao) => operacao(clientMock(true)));
});

afterEach(() => {
  delete process.env.JWT_SECRET;
});

function token(id) {
  const u = banco.usuarios.find((x) => x.id === id);
  return jwt.sign({ id, perfil: u.perfil }, SEGREDO_TESTE, { algorithm: 'HS256', expiresIn: '8h' });
}

/** GET /ocorrencias com a query string já montada (ex.: "turmaId=1&status=ABERTO"). */
const consultar = (query, usuarioId = ID_GESTAO) =>
  request(app)
    .get(`/ocorrencias${query ? `?${query}` : ''}`)
    .set('Authorization', `Bearer ${token(usuarioId)}`);

const ids = (res) => res.body.itens.map((o) => o.id);

// ---------------------------------------------------------------------------
// Validação da query string (função pura)
// ---------------------------------------------------------------------------
describe('validarFiltrosOcorrencias', () => {
  it('sem parâmetros: nenhum filtro e página 1', () => {
    expect(validarFiltrosOcorrencias({})).toEqual({
      estudanteId: undefined,
      turmaId: undefined,
      categoriaId: undefined,
      status: undefined,
      inicio: null,
      fim: null,
      profissionalResponsavelId: undefined,
      pagina: 1,
    });
    expect(validarFiltrosOcorrencias(undefined).pagina).toBe(1);
  });

  it('converte todos os parâmetros válidos (período em UTC, dias de São Paulo)', () => {
    expect(
      validarFiltrosOcorrencias({
        estudanteId: '7',
        turmaId: '2',
        categoriaId: '3',
        status: 'EM_ACOMPANHAMENTO',
        dataInicio: '2026-10-01',
        dataFim: '2026-10-31',
        profissionalResponsavelId: '2147483647',
        pagina: '4',
        outroParametro: 'ignorado',
      }),
    ).toEqual({
      estudanteId: 7,
      turmaId: 2,
      categoriaId: 3,
      status: 'EM_ACOMPANHAMENTO',
      inicio: new Date('2026-10-01T03:00:00.000Z'),
      fim: new Date('2026-11-01T02:59:59.999Z'),
      profissionalResponsavelId: 2147483647,
      pagina: 4,
    });
  });

  it('valores técnicos do status (Seção 11) e tamanho fixo de 20', () => {
    expect(STATUS_OCORRENCIA).toEqual(['ABERTO', 'EM_ACOMPANHAMENTO', 'ENCERRADO']);
    expect(TAMANHO_PAGINA_OCORRENCIAS).toBe(20);
  });

  it('condicoesFiltrosOcorrencias: só os filtros presentes; turma da OCORRÊNCIA e quem registrou', () => {
    expect(condicoesFiltrosOcorrencias(validarFiltrosOcorrencias({}))).toEqual({});
    const inicio = new Date('2026-10-01T03:00:00.000Z');
    expect(
      condicoesFiltrosOcorrencias(
        validarFiltrosOcorrencias({
          estudanteId: '1',
          turmaId: '2',
          categoriaId: '3',
          status: 'ABERTO',
          dataInicio: '2026-10-01',
          profissionalResponsavelId: '4',
        }),
      ),
    ).toEqual({
      estudantes: { some: { estudante_id: 1 } },
      turma_id: 2,
      categoria_id: 3,
      status: 'ABERTO',
      profissional_responsavel_id: 4,
      data_hora: { gte: inicio },
    });
    expect(condicoesFiltrosOcorrencias(validarFiltrosOcorrencias({ dataFim: '2026-10-01' }))).toEqual({
      data_hora: { lte: new Date('2026-10-02T02:59:59.999Z') },
    });
  });
});

// ---------------------------------------------------------------------------
// Formato da resposta e paginação
// ---------------------------------------------------------------------------
describe('GET /ocorrencias — formato paginado', () => {
  it('responde { itens, total, pagina, tamanhoPagina } com itens no formato resumido da #47', async () => {
    const res = await consultar('');
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(['itens', 'pagina', 'tamanhoPagina', 'total']);
    expect(res.body).toMatchObject({ total: 6, pagina: 1, tamanhoPagina: 20 });
    expect(ids(res)).toEqual([6, 4, 3, 2, 1, 5]);
    expect(res.body.itens.find((o) => o.id === 3)).toEqual({
      id: 3,
      dataHora: '2026-10-11T02:59:59.999Z',
      local: 'Local fictício 3',
      status: 'ENCERRADO',
      turma: { id: 2, nome: '7º B', etapa: 'Ensino Fundamental', anoLetivo: 2026 },
      categoria: { id: 1, nome: 'Indisciplina' },
      profissionalResponsavel: { id: ID_PROFESSOR, nome: `Usuário Fictício ${ID_PROFESSOR}` },
      estudantes: [
        { id: E_SEM_TUTOR, nomeCompleto: 'Estudante Fictício Beta' },
        { id: E_MUDOU_TURMA, nomeCompleto: 'Estudante Fictício Gama' },
      ],
    });
  });

  it('20 por página, total correto e página além da última com itens vazio (200)', async () => {
    acrescentarOcorrencias(39); // 6 + 39 = 45
    const p1 = await consultar('');
    const p2 = await consultar('pagina=2');
    const p3 = await consultar('pagina=3');
    const p4 = await consultar('pagina=4');
    for (const [res, pagina, quantidade] of [[p1, 1, 20], [p2, 2, 20], [p3, 3, 5], [p4, 4, 0]]) {
      expect(res.status).toBe(200);
      expect(res.body.total).toBe(45);
      expect(res.body.pagina).toBe(pagina);
      expect(res.body.tamanhoPagina).toBe(20);
      expect(res.body.itens).toHaveLength(quantidade);
    }
    // As páginas juntas dão a lista inteira, na ordem, sem repetir nem pular.
    const todas = [...ids(p1), ...ids(p2), ...ids(p3)];
    expect(new Set(todas).size).toBe(45);
    const datas = [...p1.body.itens, ...p2.body.itens, ...p3.body.itens].map((o) => Date.parse(o.dataHora));
    expect([...datas].sort((a, b) => b - a)).toEqual(datas);
    expect(ids(p3).slice(-1)).toEqual([101]); // a mais antiga fica no fim
  });

  it('desempate por id desc mantém a ordem entre páginas (mesma data/hora)', async () => {
    banco.ocorrencias = [];
    banco.ocorrenciasEstudantes = [];
    acrescentarOcorrencias(25);
    for (const o of banco.ocorrencias) o.data_hora = new Date('2026-10-01T12:00:00.000Z');
    const p1 = await consultar('');
    const p2 = await consultar('pagina=2');
    expect([...ids(p1), ...ids(p2)]).toEqual(Array.from({ length: 25 }, (_, i) => 125 - i));
  });

  it('página além da última consulta só a contagem; página enorme (maior Int) também', async () => {
    for (const pagina of ['2', '2147483647']) {
      consultasTx = [];
      const res = await consultar(`pagina=${pagina}`);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ itens: [], total: 6, pagina: Number(pagina), tamanhoPagina: 20 });
      expect(consultasTx).toEqual(['ocorrencia.count']);
    }
  });

  it('o total é o das ocorrências que atendem aos filtros, não o da página', async () => {
    acrescentarOcorrencias(30); // turma 3
    const res = await consultar('turmaId=3');
    expect(res.body.total).toBe(31); // 30 novas + O6
    expect(res.body.itens).toHaveLength(20);
    const p2 = await consultar('turmaId=3&pagina=2');
    expect(p2.body.itens).toHaveLength(11);
  });

  it('lê numa transação REPEATABLE READ: contagem, página, profissionais e estudantes (sem N+1)', async () => {
    acrescentarOcorrencias(30);
    await consultar('pagina=2');
    expect(consultasTx).toEqual([
      'ocorrencia.count',
      'ocorrencia.findMany',
      'usuario.findMany',
      'ocorrenciaEstudante.findMany',
    ]);
    expect(mocks.$transaction).toHaveBeenCalledTimes(1);
    expect(mocks.$transaction.mock.calls[0][1]).toEqual({ isolationLevel: 'RepeatableRead' });
  });

  it('parâmetros desconhecidos são ignorados', async () => {
    const res = await consultar('ordem=asc&tamanhoPagina=100');
    expect(res.status).toBe(200);
    expect(res.body.tamanhoPagina).toBe(20);
    expect(ids(res)).toEqual([6, 4, 3, 2, 1, 5]);
  });
});

// ---------------------------------------------------------------------------
// Cada filtro isolado e combinações
// ---------------------------------------------------------------------------
describe('GET /ocorrencias — filtros (RF11)', () => {
  it.each([
    ['estudanteId=1', [1]],
    ['estudanteId=3', [4, 3]],
    ['turmaId=1', [4, 2, 1]],
    ['turmaId=2', [3, 5]],
    ['categoriaId=2', [2, 5]],
    ['status=ABERTO', [6, 4, 1, 5]],
    ['status=EM_ACOMPANHAMENTO', [2]],
    ['status=ENCERRADO', [3]],
    [`profissionalResponsavelId=${ID_PROFESSOR_B}`, [4, 2]],
    [`profissionalResponsavelId=${ID_PROFESSOR}`, [3, 1]],
  ])('%s devolve só as ocorrências que o atendem', async (query, esperado) => {
    const res = await consultar(query);
    expect(res.status).toBe(200);
    expect(ids(res)).toEqual(esperado);
    expect(res.body.total).toBe(esperado.length);
  });

  it('turmaId usa a turma DA OCORRÊNCIA (RN14): o estudante que mudou de turma não altera o resultado', async () => {
    // O4 foi registrada na turma 1 com E_MUDOU_TURMA, que hoje é da turma 2.
    expect(ids(await consultar('turmaId=1'))).toEqual([4, 2, 1]);
    expect(ids(await consultar('turmaId=2'))).toEqual([3, 5]);
    for (const novaTurma of [1, 3]) {
      banco.estudantes.find((e) => e.id === E_MUDOU_TURMA).turma_id = novaTurma;
      expect(ids(await consultar('turmaId=1'))).toEqual([4, 2, 1]);
      expect(ids(await consultar('turmaId=2'))).toEqual([3, 5]);
      expect(ids(await consultar('turmaId=3'))).toEqual([6]);
    }
  });

  it('combinação de filtros com E lógico', async () => {
    expect(ids(await consultar('turmaId=1&categoriaId=1'))).toEqual([4, 1]);
    expect(ids(await consultar('turmaId=1&status=ABERTO&dataInicio=2026-10-10'))).toEqual([4]);
    expect(ids(await consultar('estudanteId=2&categoriaId=1'))).toEqual([6, 3]);
    expect(ids(await consultar(`profissionalResponsavelId=${ID_PROFESSOR}&status=ABERTO`))).toEqual([1]);
    expect(
      ids(await consultar('estudanteId=2&turmaId=2&categoriaId=1&status=ENCERRADO&dataInicio=2026-10-10&dataFim=2026-10-10')),
    ).toEqual([3]);
    // Filtros que não se cruzam: lista vazia.
    const vazio = await consultar('turmaId=3&status=ENCERRADO');
    expect(vazio.body).toEqual({ itens: [], total: 0, pagina: 1, tamanhoPagina: 20 });
  });

  it('id válido de registro inexistente devolve lista vazia (200)', async () => {
    for (const parametro of ['estudanteId', 'turmaId', 'categoriaId', 'profissionalResponsavelId']) {
      const res = await consultar(`${parametro}=999`);
      expect(res.status, parametro).toBe(200);
      expect(res.body).toEqual({ itens: [], total: 0, pagina: 1, tamanhoPagina: 20 });
    }
  });
});

// ---------------------------------------------------------------------------
// Período no horário de São Paulo (RN17)
// ---------------------------------------------------------------------------
describe('GET /ocorrencias — período em dias de São Paulo, pontas incluídas', () => {
  it('23h30 de São Paulo (02h30 UTC do dia seguinte) entra no dia de São Paulo', async () => {
    // O1: 2026-10-10T02:30Z = 09/10 às 23h30 em SP.
    expect(ids(await consultar('dataInicio=2026-10-09&dataFim=2026-10-09'))).toEqual([1]);
    expect(ids(await consultar('dataInicio=2026-10-10&dataFim=2026-10-10'))).not.toContain(1);
  });

  it('00:00:00.000 e 23:59:59.999 do dia entram; o instante seguinte não', async () => {
    // O2 = 00:00 de 10/10 e O3 = 23:59:59.999 de 10/10 (SP); O4 = 00:00 de 11/10.
    expect(ids(await consultar('dataInicio=2026-10-10&dataFim=2026-10-10'))).toEqual([3, 2]);
    expect(ids(await consultar('dataInicio=2026-10-08&dataFim=2026-10-08'))).toEqual([5]);
  });

  it('só dataInicio ou só dataFim', async () => {
    expect(ids(await consultar('dataInicio=2026-10-11'))).toEqual([6, 4]);
    expect(ids(await consultar('dataFim=2026-10-09'))).toEqual([1, 5]);
  });

  it('intervalo de vários dias inclui as duas pontas inteiras', async () => {
    expect(ids(await consultar('dataInicio=2026-10-09&dataFim=2026-10-11'))).toEqual([4, 3, 2, 1]);
    expect(ids(await consultar('dataInicio=2026-10-01&dataFim=2026-10-31'))).toEqual([6, 4, 3, 2, 1, 5]);
  });

  it('o filtro vai ao banco como gte/lte em UTC sobre data_hora (data do fato)', async () => {
    await consultar('dataInicio=2026-10-10&dataFim=2026-10-10');
    expect(whereContagem.AND[0]).toEqual({
      data_hora: {
        gte: new Date('2026-10-10T03:00:00.000Z'),
        lte: new Date('2026-10-11T02:59:59.999Z'),
      },
    });
  });
});

// ---------------------------------------------------------------------------
// Visibilidade (RN19): nenhum filtro amplia o que o perfil vê
// ---------------------------------------------------------------------------
describe('GET /ocorrencias — filtros sempre limitados pela RN19', () => {
  it('o where é sempre { AND: [filtros, filtroVisibilidadeOcorrencias] }', async () => {
    for (const usuarioId of [ID_GESTAO, ID_PROFESSOR, ID_TUTOR]) {
      await consultar(`turmaId=1&profissionalResponsavelId=${ID_PROFESSOR_B}`, usuarioId);
      const u = banco.usuarios.find((x) => x.id === usuarioId);
      expect(whereContagem).toEqual({
        AND: [
          { turma_id: 1, profissional_responsavel_id: ID_PROFESSOR_B },
          filtroVisibilidadeOcorrencias({ id: u.id, perfil: u.perfil }),
        ],
      });
    }
    // Sem filtros também (o AND com objeto vazio não restringe).
    await consultar('', ID_PROFESSOR);
    expect(whereContagem).toEqual({
      AND: [{}, filtroVisibilidadeOcorrencias({ id: ID_PROFESSOR, perfil: 'PROFESSOR' })],
    });
  });

  it('Professor filtrando por turma não recebe ocorrências de outros profissionais', async () => {
    const res = await consultar('turmaId=1', ID_PROFESSOR);
    expect(ids(res)).toEqual([1]); // O2 e O4 são da turma 1, mas de outro profissional
    expect(res.body.total).toBe(1);
  });

  it('Professor filtrando por outro profissional recebe lista vazia', async () => {
    const res = await consultar(`profissionalResponsavelId=${ID_PROFESSOR_B}`, ID_PROFESSOR);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ itens: [], total: 0, pagina: 1, tamanhoPagina: 20 });
  });

  it('Tutor filtrando por turma ou profissional só vê as visíveis a ele', async () => {
    // Visíveis ao tutor: O5 (registrou) e O1 (estudante sob sua tutoria).
    expect(ids(await consultar('', ID_TUTOR))).toEqual([1, 5]);
    expect(ids(await consultar('turmaId=1', ID_TUTOR))).toEqual([1]);
    expect(ids(await consultar('turmaId=2', ID_TUTOR))).toEqual([5]);
    expect(ids(await consultar(`profissionalResponsavelId=${ID_PROFESSOR}`, ID_TUTOR))).toEqual([1]);
    expect(ids(await consultar(`profissionalResponsavelId=${ID_PROFESSOR_B}`, ID_TUTOR))).toEqual([]);
    expect((await consultar('estudanteId=2', ID_TUTOR)).body.total).toBe(1); // só O5
  });

  it('Técnico-administrativo e Pedagógico: mesma regra (o Pedagógico vê todas)', async () => {
    expect(ids(await consultar(`profissionalResponsavelId=${ID_PROFESSOR}`, ID_TECNICO))).toEqual([]);
    expect(ids(await consultar('turmaId=3', ID_TECNICO))).toEqual([6]);
    expect(ids(await consultar(`profissionalResponsavelId=${ID_PROFESSOR}`, ID_PEDAGOGICO))).toEqual([3, 1]);
  });

  it('o total do Professor conta só as visíveis (paginação não revela as demais)', async () => {
    acrescentarOcorrencias(30); // de outro profissional
    const res = await consultar('', ID_PROFESSOR);
    expect(res.body.total).toBe(2);
    expect(ids(res)).toEqual([3, 1]);
  });
});

// ---------------------------------------------------------------------------
// Validação: 400 com mensagem clara, sem consultar o banco
// ---------------------------------------------------------------------------
describe('GET /ocorrencias — parâmetros inválidos (400)', () => {
  const IDS_INVALIDOS = ['abc', '0', '-1', '1.5', '01', '1e3', '%201', '', '2147483648', '99999999999'];
  const PARAMETROS_ID = [
    ['estudanteId', MENSAGEM_FILTRO_ESTUDANTE_INVALIDO],
    ['turmaId', MENSAGEM_FILTRO_TURMA_INVALIDO],
    ['categoriaId', MENSAGEM_FILTRO_CATEGORIA_INVALIDO],
    ['profissionalResponsavelId', MENSAGEM_FILTRO_PROFISSIONAL_INVALIDO],
  ];

  async function esperar400(query, mensagem) {
    const res = await consultar(query);
    expect(res.status, query).toBe(400);
    expect(res.body, query).toEqual({ erro: mensagem });
  }

  for (const [parametro, mensagem] of PARAMETROS_ID) {
    it(`${parametro}: não inteiro positivo, vazio, fora da faixa ou repetido`, async () => {
      for (const valor of IDS_INVALIDOS) await esperar400(`${parametro}=${valor}`, mensagem);
      await esperar400(`${parametro}=1&${parametro}=2`, mensagem);
      expect(mocks.$transaction).not.toHaveBeenCalled();
    });
  }

  it('status fora do enum (inclusive minúsculas, vazio e repetido)', async () => {
    for (const valor of ['aberto', 'FECHADO', 'ABERTO%20', '', 'Encerrado']) {
      await esperar400(`status=${valor}`, MENSAGEM_FILTRO_STATUS_INVALIDO);
    }
    await esperar400('status=ABERTO&status=ENCERRADO', MENSAGEM_FILTRO_STATUS_INVALIDO);
    expect(MENSAGEM_FILTRO_STATUS_INVALIDO).toContain('ABERTO, EM_ACOMPANHAMENTO, ENCERRADO');
    expect(mocks.$transaction).not.toHaveBeenCalled();
  });

  it('datas fora do formato AAAA-MM-DD ou inexistentes', async () => {
    const invalidas = ['2026-1-01', '01/10/2026', '20261001', '2026-02-30', '2026-13-01', '2026-10-01T00:00', '0000-01-01', ''];
    for (const valor of invalidas) {
      await esperar400(`dataInicio=${encodeURIComponent(valor)}`, MENSAGENS_PERIODO.dataInicioInvalida);
      await esperar400(`dataFim=${encodeURIComponent(valor)}`, MENSAGENS_PERIODO.dataFimInvalida);
    }
    await esperar400('dataInicio=2026-10-01&dataInicio=2026-10-02', MENSAGENS_PERIODO.dataInicioInvalida);
    expect(mocks.$transaction).not.toHaveBeenCalled();
  });

  it('dataInicio posterior a dataFim', async () => {
    await esperar400('dataInicio=2026-10-11&dataFim=2026-10-10', MENSAGENS_PERIODO.intervaloInvalido);
    // Mesmo dia é válido.
    expect((await consultar('dataInicio=2026-10-10&dataFim=2026-10-10')).status).toBe(200);
  });

  it('pagina inválida', async () => {
    for (const valor of ['0', '-1', 'abc', '1.5', '', '01', '2147483648']) {
      await esperar400(`pagina=${valor}`, MENSAGEM_PAGINA_INVALIDA);
    }
    await esperar400('pagina=1&pagina=2', MENSAGEM_PAGINA_INVALIDA);
    expect(mocks.$transaction).not.toHaveBeenCalled();
  });

  it('401 sem token, antes de validar a query', async () => {
    const res = await request(app).get('/ocorrencias?turmaId=abc');
    expect(res.status).toBe(401);
  });
});
