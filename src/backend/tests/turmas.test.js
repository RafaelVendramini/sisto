// Testes de GET, POST e PUT /turmas (Issue #40) — somente dados fictícios (RN05).
// Não dependem do banco: src/lib/prisma.js é substituído por um "banco" em
// memória (usuários fictícios para a sessão, turmas e LogAuditoria).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';

const mocks = vi.hoisted(() => ({
  usuarioFindUnique: vi.fn(),
  turmaFindMany: vi.fn(),
  turmaFindUnique: vi.fn(),
  turmaCreate: vi.fn(),
  turmaUpdate: vi.fn(),
  logCreate: vi.fn(),
  $transaction: vi.fn(),
}));

vi.mock('../src/lib/prisma.js', () => ({
  default: {
    usuario: { findUnique: mocks.usuarioFindUnique },
    turma: {
      findMany: mocks.turmaFindMany,
      findUnique: mocks.turmaFindUnique,
      create: mocks.turmaCreate,
      update: mocks.turmaUpdate,
    },
    logAuditoria: { create: mocks.logCreate },
    $transaction: mocks.$transaction,
  },
}));

const { default: app } = await import('../src/app.js');
const { MENSAGEM_PERFIL_SEM_PERMISSAO, MENSAGEM_TROCA_SENHA_OBRIGATORIA } = await import(
  '../src/middlewares/autenticacao.js'
);
const { MENSAGEM_NAO_AUTENTICADO } = await import('../src/services/sessao.js');
const { ACOES_AUDITORIA } = await import('../src/services/auditoria.js');
const {
  MENSAGEM_TURMA_DUPLICADA,
  MENSAGEM_TURMA_NAO_ENCONTRADA,
  MENSAGEM_ID_TURMA_INVALIDO,
  MENSAGEM_NOME_TURMA_OBRIGATORIO,
  MENSAGEM_ETAPA_TURMA_OBRIGATORIA,
  MENSAGEM_ANO_LETIVO_INVALIDO,
  MENSAGEM_CORPO_TURMA_INVALIDO,
  MENSAGEM_CONFLITO_CONCORRENTE_TURMA,
  TAMANHO_MAXIMO_NOME_TURMA,
  TAMANHO_MAXIMO_ETAPA_TURMA,
  criarTurma,
} = await import('../src/services/turmas.js');

const SEGREDO_TESTE = 'segredo-ficticio-de-teste-com-mais-de-32-caracteres';
const PERFIS = ['PROFESSOR', 'TUTOR', 'GESTAO', 'PEDAGOGICO', 'TECNICO_ADMINISTRATIVO'];
const PERFIS_SEM_PERMISSAO = ['PROFESSOR', 'TUTOR', 'PEDAGOGICO', 'TECNICO_ADMINISTRATIVO'];
const ID_TROCA_PENDENTE = 6;
const EM = 'Ensino Médio';
const EF = 'Ensino Fundamental';

let usuarios;
let turmas;
let logs;
let proximoIdTurma;

function selecionar(registro, select) {
  if (!select) return { ...registro };
  return Object.fromEntries(
    Object.entries(select)
      .filter(([, incluir]) => incluir)
      .map(([campo]) => [campo, registro[campo]]),
  );
}

function erroPrisma(code) {
  const erro = new Error(`Erro fictício do Prisma (${code})`);
  erro.code = code;
  return erro;
}

/** Ordenação equivalente ao orderBy do service (ano desc, etapa, nome, id). */
function ordenar(lista) {
  return lista.sort(
    (a, b) =>
      b.ano_letivo - a.ano_letivo ||
      a.etapa.localeCompare(b.etapa) ||
      a.nome.localeCompare(b.nome) ||
      a.id - b.id,
  );
}

/** Client "Prisma" em memória usado pelo app e passado como tx nas transações. */
function clientMock() {
  return {
    usuario: { findUnique: mocks.usuarioFindUnique },
    turma: {
      findMany: mocks.turmaFindMany,
      findUnique: mocks.turmaFindUnique,
      create: mocks.turmaCreate,
      update: mocks.turmaUpdate,
    },
    logAuditoria: { create: mocks.logCreate },
  };
}

beforeEach(() => {
  process.env.JWT_SECRET = SEGREDO_TESTE;

  usuarios = PERFIS.map((perfil, i) => ({
    id: i + 1,
    perfil,
    status: 'ATIVO',
    troca_senha_obrigatoria: false,
    senha_alterada_em: null,
  }));
  usuarios.push({
    id: ID_TROCA_PENDENTE,
    perfil: 'GESTAO',
    status: 'ATIVO',
    troca_senha_obrigatoria: true,
    senha_alterada_em: null,
  });

  turmas = [
    { id: 1, nome: '1º A', etapa: EM, ano_letivo: 2025 },
    { id: 2, nome: '2º B', etapa: EM, ano_letivo: 2026 },
    { id: 3, nome: '1º A', etapa: EM, ano_letivo: 2026 },
    { id: 4, nome: '6º A', etapa: EF, ano_letivo: 2026 },
  ];
  proximoIdTurma = 5;
  logs = [];

  mocks.usuarioFindUnique.mockReset();
  mocks.usuarioFindUnique.mockImplementation(async ({ where, select }) => {
    const encontrado = usuarios.find((u) => u.id === where.id);
    return encontrado ? selecionar(encontrado, select) : null;
  });

  mocks.turmaFindMany.mockReset();
  mocks.turmaFindMany.mockImplementation(async ({ where, select, orderBy } = {}) => {
    let lista = [...turmas];
    if (where?.ano_letivo !== undefined) lista = lista.filter((t) => t.ano_letivo === where.ano_letivo);
    if (orderBy) ordenar(lista);
    return lista.map((t) => selecionar(t, select));
  });

  mocks.turmaFindUnique.mockReset();
  mocks.turmaFindUnique.mockImplementation(async ({ where, select }) => {
    const encontrada = turmas.find((t) => t.id === where.id);
    return encontrada ? selecionar(encontrada, select) : null;
  });

  mocks.turmaCreate.mockReset();
  mocks.turmaCreate.mockImplementation(async ({ data, select }) => {
    const registro = { id: proximoIdTurma++, ...data };
    turmas.push(registro);
    return selecionar(registro, select);
  });

  mocks.turmaUpdate.mockReset();
  mocks.turmaUpdate.mockImplementation(async ({ where, data, select }) => {
    const registro = turmas.find((t) => t.id === where.id);
    if (!registro) throw erroPrisma('P2025');
    Object.assign(registro, data);
    return selecionar(registro, select);
  });

  mocks.logCreate.mockReset();
  mocks.logCreate.mockImplementation(async ({ data }) => {
    logs.push(data);
    return { id: logs.length };
  });

  mocks.$transaction.mockReset();
  mocks.$transaction.mockImplementation(async (operacao) => operacao(clientMock()));
});

afterEach(() => {
  delete process.env.JWT_SECRET;
});

function tokenDoUsuario(id) {
  const usuario = usuarios.find((u) => u.id === id);
  return jwt.sign({ id, perfil: usuario.perfil }, SEGREDO_TESTE, {
    algorithm: 'HS256',
    expiresIn: '8h',
  });
}

function tokenDoPerfil(perfil) {
  return tokenDoUsuario(usuarios.find((u) => u.perfil === perfil).id);
}

function autenticar(req, perfil) {
  return perfil ? req.set('Authorization', `Bearer ${tokenDoPerfil(perfil)}`) : req;
}

const getTurmas = (perfil = 'GESTAO') => autenticar(request(app).get('/turmas'), perfil);
const postTurmas = (corpo, perfil = 'GESTAO') =>
  autenticar(request(app).post('/turmas'), perfil).send(corpo);
const putTurma = (id, corpo, perfil = 'GESTAO') =>
  autenticar(request(app).put(`/turmas/${id}`), perfil).send(corpo);

const TURMA_VALIDA = Object.freeze({ nome: '3º C', etapa: EM, anoLetivo: 2026 });

// ---------------------------------------------------------------------------
// GET /turmas
// ---------------------------------------------------------------------------
describe('GET /turmas', () => {
  it.each(PERFIS)(
    'responde 200 para o perfil %s, ordenada por ano letivo (desc), etapa e nome, em camelCase',
    async (perfil) => {
      const res = await getTurmas(perfil);
      expect(res.status).toBe(200);
      expect(res.body).toEqual([
        { id: 4, nome: '6º A', etapa: EF, anoLetivo: 2026 },
        { id: 3, nome: '1º A', etapa: EM, anoLetivo: 2026 },
        { id: 2, nome: '2º B', etapa: EM, anoLetivo: 2026 },
        { id: 1, nome: '1º A', etapa: EM, anoLetivo: 2025 },
      ]);
    },
  );

  it('pede ao banco a ordenação (ano letivo desc, etapa, nome, id), só com os campos da Seção 11', async () => {
    await getTurmas();
    expect(mocks.turmaFindMany).toHaveBeenCalledWith({
      select: { id: true, nome: true, etapa: true, ano_letivo: true },
      orderBy: [{ ano_letivo: 'desc' }, { etapa: 'asc' }, { nome: 'asc' }, { id: 'asc' }],
    });
  });

  it('lista vazia responde 200 com []', async () => {
    turmas = [];
    const res = await getTurmas('PROFESSOR');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('sem token responde 401', async () => {
    const res = await getTurmas(null);
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ erro: MENSAGEM_NAO_AUTENTICADO });
    expect(mocks.turmaFindMany).not.toHaveBeenCalled();
  });

  it('com troca de senha pendente responde 403 (RN10)', async () => {
    const res = await request(app)
      .get('/turmas')
      .set('Authorization', `Bearer ${tokenDoUsuario(ID_TROCA_PENDENTE)}`);
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ erro: MENSAGEM_TROCA_SENHA_OBRIGATORIA });
    expect(mocks.turmaFindMany).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// POST /turmas
// ---------------------------------------------------------------------------
describe('POST /turmas', () => {
  it('Gestão cadastra a turma: 201 com a turma criada (textos sem espaços nas pontas)', async () => {
    const res = await postTurmas({ nome: '  3º C  ', etapa: `  ${EM}  `, anoLetivo: 2026 });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ id: 5, nome: '3º C', etapa: EM, anoLetivo: 2026 });
    expect(turmas.at(-1)).toEqual({ id: 5, nome: '3º C', etapa: EM, ano_letivo: 2026 });
  });

  it('etapa é texto livre', async () => {
    const res = await postTurmas({ nome: 'Turma Fictícia', etapa: 'Etapa livre qualquer', anoLetivo: 2026 });
    expect(res.status).toBe(201);
    expect(res.body.etapa).toBe('Etapa livre qualquer');
  });

  it('ignora campos fora de { nome, etapa, anoLetivo } (ex.: id, ano_letivo)', async () => {
    const res = await postTurmas({ ...TURMA_VALIDA, id: 99, ano_letivo: 1999 });
    expect(res.status).toBe(201);
    expect(res.body.id).toBe(5);
    expect(mocks.turmaCreate.mock.calls[0][0].data).toEqual({ nome: '3º C', etapa: EM, ano_letivo: 2026 });
  });

  it('grava a criação no LogAuditoria com recurso turmas/<id>, sem nome nem etapa (RNF04)', async () => {
    const gestao = usuarios.find((u) => u.perfil === 'GESTAO');
    const res = await postTurmas(TURMA_VALIDA);
    expect(res.status).toBe(201);
    expect(logs).toEqual([
      { usuario_id: gestao.id, acao: ACOES_AUDITORIA.TURMA_CRIADA, recurso: `turmas/${res.body.id}` },
    ]);
    expect(JSON.stringify(logs)).not.toMatch(/3º C|Ensino/);
  });

  it('usa transação serializável', async () => {
    await postTurmas(TURMA_VALIDA);
    expect(mocks.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'Serializable',
    });
  });

  it.each(PERFIS_SEM_PERMISSAO)('perfil %s responde 403 e nada é gravado', async (perfil) => {
    const res = await postTurmas(TURMA_VALIDA, perfil);
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ erro: MENSAGEM_PERFIL_SEM_PERMISSAO });
    expect(mocks.turmaCreate).not.toHaveBeenCalled();
    expect(mocks.$transaction).not.toHaveBeenCalled();
    expect(logs).toHaveLength(0);
  });

  it('sem token responde 401', async () => {
    const res = await postTurmas(TURMA_VALIDA, null);
    expect(res.status).toBe(401);
    expect(mocks.turmaCreate).not.toHaveBeenCalled();
  });

  it('com troca de senha pendente responde 403', async () => {
    const res = await request(app)
      .post('/turmas')
      .set('Authorization', `Bearer ${tokenDoUsuario(ID_TROCA_PENDENTE)}`)
      .send(TURMA_VALIDA);
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ erro: MENSAGEM_TROCA_SENHA_OBRIGATORIA });
    expect(mocks.turmaCreate).not.toHaveBeenCalled();
  });

  it.each([
    ['ausente', { etapa: EM, anoLetivo: 2026 }],
    ['vazio', { nome: '', etapa: EM, anoLetivo: 2026 }],
    ['só com espaços', { nome: '   ', etapa: EM, anoLetivo: 2026 }],
    ['null', { nome: null, etapa: EM, anoLetivo: 2026 }],
    ['número', { nome: 1, etapa: EM, anoLetivo: 2026 }],
  ])('nome %s responde 400', async (_caso, corpo) => {
    const res = await postTurmas(corpo);
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ erro: MENSAGEM_NOME_TURMA_OBRIGATORIO });
    expect(mocks.turmaCreate).not.toHaveBeenCalled();
    expect(logs).toHaveLength(0);
  });

  it.each([
    ['ausente', { nome: '3º C', anoLetivo: 2026 }],
    ['vazia', { nome: '3º C', etapa: '', anoLetivo: 2026 }],
    ['só com espaços', { nome: '3º C', etapa: '  ', anoLetivo: 2026 }],
    ['null', { nome: '3º C', etapa: null, anoLetivo: 2026 }],
    ['número', { nome: '3º C', etapa: 1, anoLetivo: 2026 }],
  ])('etapa %s responde 400', async (_caso, corpo) => {
    const res = await postTurmas(corpo);
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ erro: MENSAGEM_ETAPA_TURMA_OBRIGATORIA });
    expect(mocks.turmaCreate).not.toHaveBeenCalled();
  });

  it.each([
    ['ausente', undefined],
    ['null', null],
    ['texto', '2026'],
    ['decimal', 2026.5],
    ['3 dígitos', 999],
    ['5 dígitos', 10000],
    ['negativo', -2026],
    ['zero', 0],
    ['booleano', true],
  ])('anoLetivo %s responde 400', async (_caso, anoLetivo) => {
    const res = await postTurmas({ nome: '3º C', etapa: EM, anoLetivo });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ erro: MENSAGEM_ANO_LETIVO_INVALIDO });
    expect(mocks.turmaCreate).not.toHaveBeenCalled();
  });

  it.each([1000, 9999])('anoLetivo no limite de 4 dígitos (%s) é aceito', async (anoLetivo) => {
    const res = await postTurmas({ nome: '3º C', etapa: EM, anoLetivo });
    expect(res.status).toBe(201);
    expect(res.body.anoLetivo).toBe(anoLetivo);
  });

  it('corpo que não é objeto (array) responde 400', async () => {
    const res = await postTurmas([TURMA_VALIDA]);
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ erro: MENSAGEM_CORPO_TURMA_INVALIDO });
  });

  it('nome e etapa acima do limite técnico respondem 400; no limite, 201', async () => {
    const nomeLongo = await postTurmas({ ...TURMA_VALIDA, nome: 'a'.repeat(TAMANHO_MAXIMO_NOME_TURMA + 1) });
    expect(nomeLongo.status).toBe(400);
    const etapaLonga = await postTurmas({ ...TURMA_VALIDA, etapa: 'a'.repeat(TAMANHO_MAXIMO_ETAPA_TURMA + 1) });
    expect(etapaLonga.status).toBe(400);
    const noLimite = await postTurmas({
      nome: 'a'.repeat(TAMANHO_MAXIMO_NOME_TURMA),
      etapa: 'b'.repeat(TAMANHO_MAXIMO_ETAPA_TURMA),
      anoLetivo: 2026,
    });
    expect(noLimite.status).toBe(201);
  });

  it.each([
    ['mesmo texto', '1º A', EM],
    ['outra caixa', '1º a', 'ENSINO MÉDIO'],
    ['espaços nas pontas', '  1º A ', ' ensino médio  '],
    ['tabulação/quebra de linha nas pontas', '\t1º A\n', EM],
    ['acento em outra forma Unicode (NFD)', '1º A', 'Ensino Médio'.normalize('NFD')],
  ])('turma duplicada no mesmo ano (%s) responde 409 (RN18) e nada é gravado', async (_caso, nome, etapa) => {
    const res = await postTurmas({ nome, etapa, anoLetivo: 2026 });
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ erro: MENSAGEM_TURMA_DUPLICADA });
    expect(mocks.turmaCreate).not.toHaveBeenCalled();
    expect(logs).toHaveLength(0);
  });

  it('a mesma turma (nome e etapa) em outro ano letivo é aceita (201)', async () => {
    const res = await postTurmas({ nome: '1º A', etapa: EM, anoLetivo: 2027 });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ id: 5, nome: '1º A', etapa: EM, anoLetivo: 2027 });
  });

  it('mesmo nome no mesmo ano, mas em outra etapa, é aceito (201)', async () => {
    const res = await postTurmas({ nome: '1º A', etapa: EF, anoLetivo: 2026 });
    expect(res.status).toBe(201);
  });

  it('a checagem de duplicidade lê só as turmas do mesmo ano letivo', async () => {
    await postTurmas(TURMA_VALIDA);
    expect(mocks.turmaFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { ano_letivo: 2026 } }),
    );
  });

  it('detecta duplicidade mesmo com turma gravada fora da API com espaços', async () => {
    turmas.push({ id: 5, nome: '  3º C ', etapa: ` ${EM} `, ano_letivo: 2026 });
    proximoIdTurma = 6;
    const res = await postTurmas({ nome: '3º c', etapa: EM, anoLetivo: 2026 });
    expect(res.status).toBe(409);
  });

  it('JSON malformado responde 400', async () => {
    const res = await request(app)
      .post('/turmas')
      .set('Authorization', `Bearer ${tokenDoPerfil('GESTAO')}`)
      .set('Content-Type', 'application/json')
      .send('{"nome": ');
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('erro');
  });
});

// ---------------------------------------------------------------------------
// PUT /turmas/{id}
// ---------------------------------------------------------------------------
describe('PUT /turmas/{id}', () => {
  it('Gestão edita a turma: 200 com a turma editada', async () => {
    const res = await putTurma(2, { nome: ' 2º C ', etapa: EM, anoLetivo: 2026 });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: 2, nome: '2º C', etapa: EM, anoLetivo: 2026 });
    expect(mocks.turmaUpdate.mock.calls[0][0].data).toEqual({ nome: '2º C', etapa: EM, ano_letivo: 2026 });
  });

  it('pode trocar o ano letivo', async () => {
    const res = await putTurma(2, { nome: '2º B', etapa: EM, anoLetivo: 2027 });
    expect(res.status).toBe(200);
    expect(res.body.anoLetivo).toBe(2027);
  });

  it('manter o próprio trio, inclusive com outra caixa, não é duplicidade', async () => {
    const res = await putTurma(3, { nome: '1º a', etapa: 'ENSINO MÉDIO', anoLetivo: 2026 });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: 3, nome: '1º a', etapa: 'ENSINO MÉDIO', anoLetivo: 2026 });
  });

  it('grava a edição no LogAuditoria com recurso turmas/<id>, sem nome nem etapa (RNF04)', async () => {
    const gestao = usuarios.find((u) => u.perfil === 'GESTAO');
    const res = await putTurma(4, { nome: '6º B', etapa: EF, anoLetivo: 2026 });
    expect(res.status).toBe(200);
    expect(logs).toEqual([
      { usuario_id: gestao.id, acao: ACOES_AUDITORIA.TURMA_EDITADA, recurso: 'turmas/4' },
    ]);
    expect(JSON.stringify(logs)).not.toMatch(/6º B|Ensino/);
  });

  it('id inexistente responde 404 e nada é gravado', async () => {
    const res = await putTurma(999, TURMA_VALIDA);
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ erro: MENSAGEM_TURMA_NAO_ENCONTRADA });
    expect(mocks.turmaUpdate).not.toHaveBeenCalled();
    expect(logs).toHaveLength(0);
  });

  it('turma removida entre a leitura e o update (P2025) responde 404', async () => {
    mocks.turmaUpdate.mockRejectedValueOnce(erroPrisma('P2025'));
    const res = await putTurma(1, TURMA_VALIDA);
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ erro: MENSAGEM_TURMA_NAO_ENCONTRADA });
  });

  it.each(['abc', '0', '-1', '1.5', '01', '99999999999'])('id inválido (%s) responde 400', async (id) => {
    const res = await putTurma(id, TURMA_VALIDA);
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ erro: MENSAGEM_ID_TURMA_INVALIDO });
  });

  it.each([
    ['sem nome', { etapa: EM, anoLetivo: 2026 }, MENSAGEM_NOME_TURMA_OBRIGATORIO],
    ['sem etapa', { nome: '1º A', anoLetivo: 2026 }, MENSAGEM_ETAPA_TURMA_OBRIGATORIA],
    ['sem anoLetivo', { nome: '1º A', etapa: EM }, MENSAGEM_ANO_LETIVO_INVALIDO],
    ['anoLetivo com 2 dígitos', { nome: '1º A', etapa: EM, anoLetivo: 26 }, MENSAGEM_ANO_LETIVO_INVALIDO],
    ['corpo array', [TURMA_VALIDA], MENSAGEM_CORPO_TURMA_INVALIDO],
  ])('PUT %s responde 400 (todos os campos são obrigatórios)', async (_caso, corpo, mensagem) => {
    const res = await putTurma(1, corpo);
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ erro: mensagem });
    expect(mocks.turmaUpdate).not.toHaveBeenCalled();
  });

  it.each([
    ['mesmo texto', '1º A'],
    ['outra caixa e espaços', '  1º a  '],
  ])('trio de outra turma no mesmo ano (%s) responde 409 (RN18)', async (_caso, nome) => {
    const res = await putTurma(2, { nome, etapa: EM, anoLetivo: 2026 });
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ erro: MENSAGEM_TURMA_DUPLICADA });
    expect(mocks.turmaUpdate).not.toHaveBeenCalled();
    expect(logs).toHaveLength(0);
  });

  it('mudar o ano letivo para um ano em que o trio já existe responde 409', async () => {
    // Turma 1 é "1º A / Ensino Médio / 2025"; em 2026 já existe a turma 3 com o mesmo nome e etapa.
    const res = await putTurma(1, { nome: '1º A', etapa: EM, anoLetivo: 2026 });
    expect(res.status).toBe(409);
    expect(turmas.find((t) => t.id === 1).ano_letivo).toBe(2025);
  });

  it.each(PERFIS_SEM_PERMISSAO)('perfil %s responde 403 e nada é consultado nem gravado', async (perfil) => {
    const res = await putTurma(1, TURMA_VALIDA, perfil);
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ erro: MENSAGEM_PERFIL_SEM_PERMISSAO });
    expect(mocks.turmaFindUnique).not.toHaveBeenCalled();
    expect(mocks.turmaUpdate).not.toHaveBeenCalled();
  });

  it('sem token responde 401', async () => {
    const res = await putTurma(1, TURMA_VALIDA, null);
    expect(res.status).toBe(401);
    expect(mocks.turmaUpdate).not.toHaveBeenCalled();
  });

  it('com troca de senha pendente responde 403 (RN10)', async () => {
    const res = await request(app)
      .put('/turmas/1')
      .set('Authorization', `Bearer ${tokenDoUsuario(ID_TROCA_PENDENTE)}`)
      .send(TURMA_VALIDA);
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ erro: MENSAGEM_TROCA_SENHA_OBRIGATORIA });
    expect(mocks.turmaUpdate).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// RN21: sem exclusão
// ---------------------------------------------------------------------------
describe('Sem DELETE /turmas/{id} (RN21)', () => {
  it.each(['delete', 'patch'])('%s /turmas/1 responde 404 (rota inexistente) e não altera nada', async (metodo) => {
    const res = await autenticar(request(app)[metodo]('/turmas/1'), 'GESTAO').send(TURMA_VALIDA);
    expect(res.status).toBe(404);
    expect(turmas).toHaveLength(4);
    expect(mocks.turmaUpdate).not.toHaveBeenCalled();
  });

  it('o roteador de turmas registra apenas GET, POST e PUT', async () => {
    const { default: rotasTurmas } = await import('../src/routes/turmas.js');
    const metodos = rotasTurmas.stack.flatMap((camada) => Object.keys(camada.route?.methods ?? {}));
    expect(metodos.sort()).toEqual(['get', 'post', 'put']);
  });

  it('o roteador de turmas está montado em protegidas depois do bloqueio de troca de senha', async () => {
    const { protegidas } = await import('../src/routes/index.js');
    const { default: rotasTurmas } = await import('../src/routes/turmas.js');
    const { bloquearComTrocaDeSenhaPendente } = await import('../src/middlewares/autenticacao.js');
    const camadas = protegidas.stack.map((c) => c.handle);
    const posBloqueio = camadas.indexOf(bloquearComTrocaDeSenhaPendente);
    expect(posBloqueio).toBeGreaterThan(-1);
    expect(camadas.indexOf(rotasTurmas)).toBeGreaterThan(posBloqueio);
  });
});

// ---------------------------------------------------------------------------
// Concorrência (RN18): conflito de serialização é repetido
// ---------------------------------------------------------------------------
describe('Concorrência no cadastro de turmas', () => {
  it('conflito de serialização (P2034) é repetido; na repetição o trio já existe e responde 409', async () => {
    mocks.$transaction.mockImplementationOnce(async () => {
      turmas.push({ id: proximoIdTurma++, nome: '3º C', etapa: EM, ano_letivo: 2026 });
      throw erroPrisma('P2034');
    });
    const res = await postTurmas({ nome: '3º c', etapa: EM, anoLetivo: 2026 });
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ erro: MENSAGEM_TURMA_DUPLICADA });
    expect(mocks.$transaction).toHaveBeenCalledTimes(2);
  });

  it('conflito de serialização seguido de sucesso responde 201', async () => {
    mocks.$transaction.mockRejectedValueOnce(erroPrisma('P2034'));
    const res = await postTurmas(TURMA_VALIDA);
    expect(res.status).toBe(201);
    expect(mocks.$transaction).toHaveBeenCalledTimes(2);
  });

  it('PUT: conflito de serialização seguido de sucesso responde 200', async () => {
    mocks.$transaction.mockRejectedValueOnce(erroPrisma('P2034'));
    const res = await putTurma(2, { nome: '2º C', etapa: EM, anoLetivo: 2026 });
    expect(res.status).toBe(200);
    expect(logs).toHaveLength(1);
  });

  it('esgotadas as tentativas, responde 409 pedindo para tentar de novo', async () => {
    mocks.$transaction.mockRejectedValue(erroPrisma('P2034'));
    const res = await postTurmas(TURMA_VALIDA);
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ erro: MENSAGEM_CONFLITO_CONCORRENTE_TURMA });
    expect(mocks.$transaction).toHaveBeenCalledTimes(3);
  });

  it('erro inesperado do banco responde 500 genérico', async () => {
    mocks.$transaction.mockRejectedValueOnce(new Error('falha fictícia'));
    const res = await postTurmas(TURMA_VALIDA);
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ erro: 'Erro interno do servidor' });
  });

  it('o service aceita db injetado (sem o módulo prisma)', async () => {
    const db = { ...clientMock(), $transaction: async (op) => op(clientMock()) };
    const turma = await criarTurma(TURMA_VALIDA, { id: 3 }, { db });
    expect(turma).toEqual({ id: 5, nome: '3º C', etapa: EM, anoLetivo: 2026 });
  });
});
