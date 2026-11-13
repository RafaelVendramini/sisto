// QA — testes complementares dos filtros e da paginação do GET /ocorrencias
// (Issue #86 — RF11, RF14, UC03, RN01, RN14, RN19) — somente dados fictícios
// (RN05). Cobrem lacunas de ocorrencias-filtros.test.js: filtros combinados
// com TODAS as condições da RN19 (encaminhamento ao usuário, responsável pelo
// acompanhamento, tutoria), a propriedade "filtro nunca amplia nem corta
// indevidamente" para os 5 perfis, paginação de perfil restrito e parâmetros
// com colchetes/protótipo na query. Mesmo "banco" em memória do arquivo do
// dev (avalia o `where` gerado pelo service).
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
// Cenário extra (QA): condições da RN19 além de "registrou" e "tutoria"
// ---------------------------------------------------------------------------

/** Encaminhamento fictício da ocorrência ao usuário destinatário. */
function encaminharA(ocorrenciaId, destinatarioUsuarioId, perfil) {
  banco.encaminhamentos.push({
    id: banco.encaminhamentos.length + 1,
    ocorrencia_id: ocorrenciaId,
    destinatario_perfil: perfil,
    destinatario_usuario_id: destinatarioUsuarioId,
    registrado_por_id: ID_GESTAO,
    data_hora: new Date('2026-10-12T18:00:00.000Z'),
    observacao: null,
  });
}

/**
 * Acrescenta `n` ocorrências fictícias a partir de `idInicial`, 1 por minuto
 * (ordem desc = ids desc), com o estudante sem tutor.
 */
function lote(idInicial, n, { prof, turma = 3, categoria = 2, status = 'ABERTO', inicioMs }) {
  for (let i = 0; i < n; i += 1) {
    const id = idInicial + i;
    banco.ocorrencias.push(
      ocorrencia({ id, iso: new Date(inicioMs + i * 60_000).toISOString(), turma, categoria, status, prof }),
    );
    banco.ocorrenciasEstudantes.push({ ocorrencia_id: id, estudante_id: E_SEM_TUTOR });
  }
}

function cenarioRn19Completo() {
  // O2 (do Professor B) encaminhada ao Professor como usuário destinatário.
  encaminharA(2, ID_PROFESSOR, 'PROFESSOR');
  // O3 (do Professor) encaminhada ao Técnico-administrativo.
  encaminharA(3, ID_TECNICO, 'TECNICO_ADMINISTRATIVO');
  // O4 (do Professor B) acompanhada pelo Tutor.
  const o4 = banco.ocorrencias.find((o) => o.id === 4);
  o4.responsavel_acompanhamento_id = ID_TUTOR;
  o4.status = 'EM_ACOMPANHAMENTO';
  // O7: mista — estudante tutorado + estudante sem tutor, de outro profissional.
  banco.ocorrencias.push(
    ocorrencia({ id: 7, iso: '2026-10-05T15:00:00.000Z', turma: 2, categoria: 2, status: 'ABERTO', prof: ID_PROFESSOR_B }),
  );
  banco.ocorrenciasEstudantes.push(
    { ocorrencia_id: 7, estudante_id: E_TUTORADO },
    { ocorrencia_id: 7, estudante_id: E_SEM_TUTOR },
  );
}
// Ordem geral com O7: 6, 4, 3, 2, 1, 5, 7.

const TODOS_OS_USUARIOS = [ID_GESTAO, ID_PEDAGOGICO, ID_PROFESSOR, ID_TUTOR, ID_PROFESSOR_B, ID_TECNICO];

describe('QA #86 — filtros com as demais condições da RN19', () => {
  beforeEach(cenarioRn19Completo);

  it('Professor destinatário de encaminhamento: o filtro por outro profissional devolve só a encaminhada', async () => {
    expect(ids(await consultar('', ID_PROFESSOR))).toEqual([3, 2, 1]);
    const res = await consultar(`profissionalResponsavelId=${ID_PROFESSOR_B}`, ID_PROFESSOR);
    expect(ids(res)).toEqual([2]); // O4 e O7 também são do Professor B, mas não são visíveis
    expect(res.body.total).toBe(1);
    expect(ids(await consultar('turmaId=1', ID_PROFESSOR))).toEqual([2, 1]);
    expect(ids(await consultar('status=EM_ACOMPANHAMENTO', ID_PROFESSOR))).toEqual([2]);
    expect(ids(await consultar('estudanteId=2', ID_PROFESSOR))).toEqual([3, 2]);
  });

  it('Tutor responsável pelo acompanhamento: filtros devolvem a acompanhada e nada além', async () => {
    expect(ids(await consultar('', ID_TUTOR))).toEqual([4, 1, 5, 7]);
    expect(ids(await consultar(`profissionalResponsavelId=${ID_PROFESSOR_B}`, ID_TUTOR))).toEqual([4, 7]);
    expect(ids(await consultar('turmaId=1', ID_TUTOR))).toEqual([4, 1]);
    // O3 envolve E_MUDOU_TURMA mas não é visível ao Tutor.
    expect(ids(await consultar(`estudanteId=${E_MUDOU_TURMA}`, ID_TUTOR))).toEqual([4]);
  });

  it('Tutor filtrando por estudante que NÃO tutora: só as ocorrências visíveis por outra condição', async () => {
    // E_SEM_TUTOR está em O2, O3, O5, O6 e O7; ao Tutor só O5 (registrou) e O7 (mista, tutorado).
    const res = await consultar(`estudanteId=${E_SEM_TUTOR}`, ID_TUTOR);
    expect(ids(res)).toEqual([5, 7]);
    expect(res.body.total).toBe(2);
  });

  it('Técnico-administrativo destinatário de encaminhamento: filtra a encaminhada', async () => {
    expect(ids(await consultar(`profissionalResponsavelId=${ID_PROFESSOR}`, ID_TECNICO))).toEqual([3]);
    expect(ids(await consultar('status=ENCERRADO', ID_TECNICO))).toEqual([3]);
    expect(ids(await consultar('categoriaId=2', ID_TECNICO))).toEqual([]);
  });

  // Propriedade: para qualquer usuário e qualquer combinação de filtros, o
  // resultado é EXATAMENTE (visíveis ao usuário) ∩ (resultado da Gestão com os
  // mesmos filtros), na mesma ordem — o filtro nunca amplia (RN19) nem corta
  // ocorrências visíveis que o atendem.
  const CONSULTAS = [
    'turmaId=1',
    'turmaId=2',
    'turmaId=3',
    'categoriaId=1',
    'categoriaId=2',
    'status=ABERTO',
    'status=EM_ACOMPANHAMENTO',
    'status=ENCERRADO',
    `estudanteId=${E_TUTORADO}`,
    `estudanteId=${E_SEM_TUTOR}`,
    `estudanteId=${E_MUDOU_TURMA}`,
    `profissionalResponsavelId=${ID_PROFESSOR}`,
    `profissionalResponsavelId=${ID_PROFESSOR_B}`,
    `profissionalResponsavelId=${ID_TUTOR}`,
    `profissionalResponsavelId=${ID_TECNICO}`,
    'dataInicio=2026-10-09&dataFim=2026-10-10',
    'dataFim=2026-10-09',
    'dataInicio=2026-10-11',
    `turmaId=1&profissionalResponsavelId=${ID_PROFESSOR_B}`,
    `estudanteId=${E_SEM_TUTOR}&categoriaId=2&dataFim=2026-10-31`,
  ];

  for (const usuarioId of TODOS_OS_USUARIOS) {
    it(`usuário ${usuarioId}: filtrado = visíveis ∩ filtrado da Gestão, para ${CONSULTAS.length} combinações`, async () => {
      const visiveis = new Set(ids(await consultar('', usuarioId)));
      for (const query of CONSULTAS) {
        const gestao = ids(await consultar(query, ID_GESTAO));
        const res = await consultar(query, usuarioId);
        expect(res.status, query).toBe(200);
        const esperado = gestao.filter((id) => visiveis.has(id));
        expect(ids(res), `${query} (usuário ${usuarioId})`).toEqual(esperado);
        expect(res.body.total, query).toBe(esperado.length);
      }
    });
  }
});

// ---------------------------------------------------------------------------
// Paginação de perfil restrito (RN19 + paginação)
// ---------------------------------------------------------------------------
describe('QA #86 — paginação com visibilidade restrita', () => {
  const BASE_SET = Date.UTC(2026, 8, 1, 12);

  it('Professor: total, páginas e página além da última contam só as visíveis, sem vazar as de outro profissional', async () => {
    lote(201, 45, { prof: ID_PROFESSOR, inicioMs: BASE_SET });
    lote(301, 30, { prof: ID_PROFESSOR_B, inicioMs: BASE_SET + 30_000 }); // intercaladas no tempo

    const paginas = [];
    for (const pagina of [1, 2, 3, 4]) {
      const res = await consultar(`turmaId=3&pagina=${pagina}`, ID_PROFESSOR);
      expect(res.status).toBe(200);
      expect(res.body.total).toBe(45);
      expect(res.body.pagina).toBe(pagina);
      paginas.push(ids(res));
    }
    expect(paginas.map((p) => p.length)).toEqual([20, 20, 5, 0]);
    const todas = paginas.flat();
    expect(todas).toEqual(Array.from({ length: 45 }, (_, i) => 245 - i));
    expect(todas.some((id) => id >= 301)).toBe(false);
  });

  it('Gestão com o mesmo filtro vê as 75 + O6 (o filtro não restringe por perfil)', async () => {
    lote(201, 45, { prof: ID_PROFESSOR, inicioMs: BASE_SET });
    lote(301, 30, { prof: ID_PROFESSOR_B, inicioMs: BASE_SET + 30_000 });
    const res = await consultar('turmaId=3&pagina=4', ID_GESTAO);
    expect(res.body.total).toBe(76);
    expect(res.body.itens).toHaveLength(16);
  });

  it('filtro + período + página 2 mantêm a ordem (data/hora desc, id desc) sem repetir itens', async () => {
    const base = Date.UTC(2026, 8, 10, 12); // 10/09/2026 09h00 em SP
    lote(201, 30, { prof: ID_PROFESSOR, inicioMs: base });
    const q = 'estudanteId=2&dataInicio=2026-09-10&dataFim=2026-09-10';
    const p1 = await consultar(q, ID_PROFESSOR);
    const p2 = await consultar(`${q}&pagina=2`, ID_PROFESSOR);
    expect(p1.body.total).toBe(30);
    expect([...ids(p1), ...ids(p2)]).toEqual(Array.from({ length: 30 }, (_, i) => 230 - i));
  });
});

// ---------------------------------------------------------------------------
// RF14: os 5 perfis usam os filtros; validação igual para todos
// ---------------------------------------------------------------------------
describe('QA #86 — perfis e validação', () => {
  for (const usuarioId of [ID_GESTAO, ID_PEDAGOGICO, ID_PROFESSOR, ID_TUTOR, ID_TECNICO]) {
    it(`usuário ${usuarioId}: 200 com todos os filtros juntos e 400 com qualquer parâmetro inválido`, async () => {
      const todos =
        'estudanteId=2&turmaId=2&categoriaId=1&status=ENCERRADO&dataInicio=2026-10-01&dataFim=2026-10-31' +
        `&profissionalResponsavelId=${ID_PROFESSOR}&pagina=1`;
      const ok = await consultar(todos, usuarioId);
      expect(ok.status).toBe(200);
      expect(Object.keys(ok.body).sort()).toEqual(['itens', 'pagina', 'tamanhoPagina', 'total']);

      mocks.$transaction.mockClear();
      for (const query of [
        'turmaId=x',
        'status=FECHADO',
        'dataInicio=2026-10-31&dataFim=2026-10-01',
        'pagina=0',
        'profissionalResponsavelId=-3',
      ]) {
        const res = await consultar(query, usuarioId);
        expect(res.status, query).toBe(400);
        expect(typeof res.body.erro).toBe('string');
        expect(res.body.erro.length).toBeGreaterThan(0);
      }
      expect(mocks.$transaction).not.toHaveBeenCalled();
    });
  }

  it('usuário bloqueado com filtros válidos: 401 (não chega a listar)', async () => {
    banco.usuarios.find((u) => u.id === ID_PROFESSOR).status = 'BLOQUEADO';
    const res = await consultar('turmaId=1', ID_PROFESSOR);
    expect(res.status).toBe(401);
    expect(res.body).not.toHaveProperty('itens');
  });

  it('valores válidos com codificação percentual são aceitos (%31 = "1", %5F = "_")', async () => {
    expect(ids(await consultar('turmaId=%31'))).toEqual([4, 2, 1]);
    expect(ids(await consultar('status=EM%5FACOMPANHAMENTO'))).toEqual([2]);
    expect(ids(await consultar('dataInicio=2026%2D10%2D09&dataFim=2026-10-09'))).toEqual([1]);
  });

  it('parâmetros com colchetes ou de protótipo não viram operador nem ampliam a visibilidade', async () => {
    const visiveisProfessor = ids(await consultar('', ID_PROFESSOR));
    for (const query of [
      'turmaId[gt]=0',
      'status[not]=ABERTO',
      'profissionalResponsavelId[in]=5',
      '__proto__[status]=ENCERRADO',
      'constructor[prototype][turmaId]=1',
      'pagina[]=2',
    ]) {
      const res = await consultar(query, ID_PROFESSOR);
      expect([200, 400], query).toContain(res.status);
      if (res.status === 200) {
        // Ignorado como parâmetro desconhecido: mesmo resultado sem filtro.
        expect(ids(res), query).toEqual(visiveisProfessor);
        expect(res.body.pagina).toBe(1);
      }
    }
    // Nada contaminou o protótipo.
    expect({}.status).toBeUndefined();
    expect({}.turmaId).toBeUndefined();
  });
});
