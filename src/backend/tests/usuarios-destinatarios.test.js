// Testes da Issue #44 — somente dados fictícios (RN05).
// 1. GET /usuarios aberto aos 5 perfis (RN20): lista completa para a Gestão;
//    para os demais, só id, nome e perfil dos usuários ATIVOS com perfil
//    TUTOR, PEDAGOGICO ou GESTAO, com filtro opcional ?perfil=.
// 2. RN13: PUT /usuarios/{id} recusa (409) a troca de perfil de um TUTOR com
//    estudantes vinculados, na mesma transação serializável do update.
// Não dependem do banco: src/lib/prisma.js é substituído por um "banco" em
// memória (o mesmo que o middleware de sessão consulta).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { CODIGOS_ERRO } from '../src/lib/erros.js';

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  findMany: vi.fn(),
  update: vi.fn(),
  count: vi.fn(),
  estudanteCount: vi.fn(),
  $transaction: vi.fn(),
  criarLog: vi.fn(),
}));
const { findUnique, findMany, update, count, estudanteCount, $transaction } = mocks;

vi.mock('../src/lib/prisma.js', () => ({
  default: {
    usuario: {
      findUnique: mocks.findUnique,
      findMany: mocks.findMany,
      update: mocks.update,
      count: mocks.count,
    },
    estudante: { count: mocks.estudanteCount },
    logAuditoria: { create: mocks.criarLog },
    $transaction: mocks.$transaction,
  },
}));

const { default: app } = await import('../src/app.js');
const { MENSAGEM_NAO_AUTENTICADO } = await import('../src/services/sessao.js');
const { MENSAGEM_TROCA_SENHA_OBRIGATORIA } = await import('../src/middlewares/autenticacao.js');
const {
  MENSAGEM_FILTRO_PERFIL_INVALIDO,
  MENSAGEM_TUTOR_COM_TUTORADOS,
  MENSAGEM_CONFLITO_CONCORRENTE,
  listarUsuarios,
} = await import('../src/services/usuarios.js');

const SEGREDO_TESTE = 'segredo-ficticio-de-teste-com-mais-de-32-caracteres';
const NAO_GESTAO = ['PROFESSOR', 'TUTOR', 'PEDAGOGICO', 'TECNICO_ADMINISTRATIVO'];

// Usuários-base (ids 1–5, todos ATIVOS) que fazem as requisições.
const ID_PROFESSOR = 1;
const ID_TUTOR = 2;
const ID_GESTAO = 3;
const ID_PEDAGOGICO = 4;
const ID_TECNICO = 5;
// Gestão extra para a RN11 não interferir nos testes de troca de perfil.
const ID_GESTAO_2 = 6;
// Usuários que só aparecem (ou não) na listagem.
const ID_TUTOR_BLOQUEADO = 7;
const ID_PEDAGOGICO_DESATIVADO = 8;
const ID_GESTAO_BLOQUEADA = 9;
const ID_TUTOR_COM_TUTORADOS = 10;
const ID_TUTOR_SEM_TUTORADOS = 11;

let banco;
/** Estudantes fictícios: só o que importa aqui (id e tutor_id). */
let estudantes;

function usuario(id, nome, perfil, status = 'ATIVO', extra = {}) {
  return {
    id,
    nome,
    email: `usuario.${id}@sisto.exemplo`,
    senha_hash: '$2b$04$abcdefghijklmnopqrstuuabcdefghijklmnopqrstuvwxyz01234',
    perfil,
    status,
    troca_senha_obrigatoria: false,
    ...extra,
  };
}

function selecionar(registro, select) {
  if (!select) return { ...registro };
  return Object.fromEntries(
    Object.entries(select)
      .filter(([, incluir]) => incluir)
      .map(([campo]) => [campo, registro[campo]]),
  );
}

/** Interpreta o subconjunto de `where` usado pelo service (status, perfil, perfil.in). */
function atende(registro, where = {}) {
  if (where.status !== undefined && registro.status !== where.status) return false;
  if (where.perfil !== undefined) {
    if (typeof where.perfil === 'string') return registro.perfil === where.perfil;
    if (where.perfil.in) return where.perfil.in.includes(registro.perfil);
  }
  return true;
}

function buscar(id) {
  return banco.find((u) => u.id === id);
}

beforeEach(() => {
  process.env.JWT_SECRET = SEGREDO_TESTE;
  banco = [
    usuario(ID_PROFESSOR, 'Professor Ficticio', 'PROFESSOR'),
    usuario(ID_TUTOR, 'Tutor Ficticio', 'TUTOR'),
    usuario(ID_GESTAO, 'Gestao Ficticia', 'GESTAO'),
    usuario(ID_PEDAGOGICO, 'Pedagogica Ficticia', 'PEDAGOGICO'),
    usuario(ID_TECNICO, 'Tecnico Ficticio', 'TECNICO_ADMINISTRATIVO'),
    usuario(ID_GESTAO_2, 'Gestao Ficticia Dois', 'GESTAO'),
    usuario(ID_TUTOR_BLOQUEADO, 'Tutor Bloqueado Ficticio', 'TUTOR', 'BLOQUEADO'),
    usuario(ID_PEDAGOGICO_DESATIVADO, 'Pedagogico Desativado Ficticio', 'PEDAGOGICO', 'DESATIVADO'),
    usuario(ID_GESTAO_BLOQUEADA, 'Gestao Bloqueada Ficticia', 'GESTAO', 'BLOQUEADO'),
    usuario(ID_TUTOR_COM_TUTORADOS, 'Ana Tutora Ficticia', 'TUTOR'),
    usuario(ID_TUTOR_SEM_TUTORADOS, 'Bruno Tutor Ficticio', 'TUTOR'),
  ];
  estudantes = [
    { id: 1, tutor_id: ID_TUTOR_COM_TUTORADOS },
    { id: 2, tutor_id: ID_TUTOR_COM_TUTORADOS },
    { id: 3, tutor_id: null },
  ];

  findUnique.mockReset();
  findUnique.mockImplementation(async ({ where, select }) => {
    const encontrado = banco.find((u) =>
      where.id !== undefined ? u.id === where.id : u.email === where.email,
    );
    return encontrado ? selecionar(encontrado, select) : null;
  });

  findMany.mockReset();
  findMany.mockImplementation(async ({ where, select }) =>
    banco
      .filter((u) => atende(u, where))
      .sort((a, b) => a.nome.localeCompare(b.nome) || a.id - b.id)
      .map((u) => selecionar(u, select)),
  );

  update.mockReset();
  update.mockImplementation(async ({ where, data, select }) => {
    const registro = buscar(where.id);
    Object.assign(registro, data);
    return selecionar(registro, select);
  });

  count.mockReset();
  count.mockImplementation(
    async ({ where }) =>
      banco.filter(
        (u) => u.perfil === where.perfil && u.status === where.status && u.id !== where.id?.not,
      ).length,
  );

  estudanteCount.mockReset();
  estudanteCount.mockImplementation(
    async ({ where }) => estudantes.filter((e) => e.tutor_id === where.tutor_id).length,
  );

  mocks.criarLog.mockReset();
  mocks.criarLog.mockResolvedValue({ id: 1 });

  // A edição grava o LogAuditoria na mesma transação (Issue #91).
  $transaction.mockReset();
  $transaction.mockImplementation(async (fn) =>
    fn({
      logAuditoria: { create: mocks.criarLog },
      usuario: { findUnique, findMany, update, count },
      estudante: { count: estudanteCount },
      // Sem ocorrências em acompanhamento: a RN23 (Issue #134) não recusa aqui.
      ocorrencia: { count: async () => 0 },
    }),
  );
});

afterEach(() => {
  delete process.env.JWT_SECRET;
});

function tokenDe(id) {
  return jwt.sign({ id, perfil: buscar(id).perfil }, SEGREDO_TESTE, {
    algorithm: 'HS256',
    expiresIn: '8h',
  });
}

const ID_DO_PERFIL = {
  PROFESSOR: ID_PROFESSOR,
  TUTOR: ID_TUTOR,
  GESTAO: ID_GESTAO,
  PEDAGOGICO: ID_PEDAGOGICO,
  TECNICO_ADMINISTRATIVO: ID_TECNICO,
};

function getUsuarios(perfil, query = '') {
  return request(app)
    .get(`/usuarios${query}`)
    .set('Authorization', `Bearer ${tokenDe(ID_DO_PERFIL[perfil])}`);
}

function put(id, corpo, token = tokenDe(ID_GESTAO)) {
  return request(app).put(`/usuarios/${id}`).set('Authorization', `Bearer ${token}`).send(corpo);
}

// `codigo`: código estável do corpo de erro (todo 409 e o 403 da RN10 — #72, D1).
function esperarErro(res, status, mensagem, codigo) {
  expect(res.status).toBe(status);
  expect(res.headers['content-type']).toMatch(/application\/json/);
  expect(res.body).toEqual(codigo ? { erro: mensagem, codigo } : { erro: mensagem });
}

// ---------------------------------------------------------------------------
// GET /usuarios — RN20
// ---------------------------------------------------------------------------

/** Lista reduzida esperada (ativos TUTOR/PEDAGOGICO/GESTAO), ordenada por nome. */
const LISTA_REDUZIDA_ESPERADA = [
  { id: ID_TUTOR_COM_TUTORADOS, nome: 'Ana Tutora Ficticia', perfil: 'TUTOR' },
  { id: ID_TUTOR_SEM_TUTORADOS, nome: 'Bruno Tutor Ficticio', perfil: 'TUTOR' },
  { id: ID_GESTAO, nome: 'Gestao Ficticia', perfil: 'GESTAO' },
  { id: ID_GESTAO_2, nome: 'Gestao Ficticia Dois', perfil: 'GESTAO' },
  { id: ID_PEDAGOGICO, nome: 'Pedagogica Ficticia', perfil: 'PEDAGOGICO' },
  { id: ID_TUTOR, nome: 'Tutor Ficticio', perfil: 'TUTOR' },
];

describe('GET /usuarios — demais perfis recebem a lista reduzida (RN20)', () => {
  it.each(NAO_GESTAO)('%s: 200 só com id, nome e perfil dos destinatários ativos', async (perfil) => {
    const res = await getUsuarios(perfil);

    expect(res.status).toBe(200);
    expect(res.body).toEqual(LISTA_REDUZIDA_ESPERADA);
  });

  it.each(NAO_GESTAO)('%s: nenhum e-mail, status ou hash na resposta', async (perfil) => {
    const res = await getUsuarios(perfil);

    expect(res.text).not.toMatch(/@|email|status|ATIVO|BLOQUEADO|DESATIVADO|senha|\$2b\$/);
    for (const item of res.body) {
      expect(Object.keys(item).sort()).toEqual(['id', 'nome', 'perfil']);
    }
  });

  it('bloqueados e desativados não aparecem, mesmo com perfil de destinatário', async () => {
    const res = await getUsuarios('PROFESSOR');
    const ids = res.body.map((u) => u.id);

    expect(ids).not.toContain(ID_TUTOR_BLOQUEADO);
    expect(ids).not.toContain(ID_PEDAGOGICO_DESATIVADO);
    expect(ids).not.toContain(ID_GESTAO_BLOQUEADA);
  });

  it('perfis PROFESSOR e TECNICO_ADMINISTRATIVO não aparecem', async () => {
    const res = await getUsuarios('TUTOR');
    const perfis = new Set(res.body.map((u) => u.perfil));

    expect(perfis).toEqual(new Set(['TUTOR', 'PEDAGOGICO', 'GESTAO']));
  });

  it('e-mail e status nem são lidos do banco (select reduzido + filtro no where)', async () => {
    await getUsuarios('PEDAGOGICO');

    expect(findMany).toHaveBeenCalledWith({
      where: { status: 'ATIVO', perfil: { in: ['TUTOR', 'PSICOLOGO', 'PEDAGOGICO', 'GESTAO'] } },
      select: { id: true, nome: true, perfil: true },
      orderBy: [{ nome: 'asc' }, { id: 'asc' }],
    });
  });

  it.each(['TUTOR', 'PEDAGOGICO', 'GESTAO'])('?perfil=%s filtra só esse perfil (ativos)', async (filtro) => {
    const res = await getUsuarios('PROFESSOR', `?perfil=${filtro}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual(LISTA_REDUZIDA_ESPERADA.filter((u) => u.perfil === filtro));
    expect(findMany).toHaveBeenCalledWith({
      where: { status: 'ATIVO', perfil: filtro },
      select: { id: true, nome: true, perfil: true },
      orderBy: [{ nome: 'asc' }, { id: 'asc' }],
    });
  });

  it.each([
    ['perfil que não é destinatário (PROFESSOR)', '?perfil=PROFESSOR'],
    ['perfil que não é destinatário (TECNICO_ADMINISTRATIVO)', '?perfil=TECNICO_ADMINISTRATIVO'],
    ['valor inexistente', '?perfil=DIRETOR'],
    ['minúsculas', '?perfil=tutor'],
    ['vazio', '?perfil='],
    ['repetido', '?perfil=TUTOR&perfil=GESTAO'],
  ])('?perfil= inválido (%s): 400 sem consultar a lista', async (_caso, query) => {
    const res = await getUsuarios('TECNICO_ADMINISTRATIVO', query);

    esperarErro(res, 400, MENSAGEM_FILTRO_PERFIL_INVALIDO);
    expect(findMany).not.toHaveBeenCalled();
  });

  it('perfil lido do banco prevalece sobre o do token: ex-Gestão hoje PROFESSOR recebe a lista reduzida', async () => {
    const tokenAntigo = jwt.sign({ id: ID_PROFESSOR, perfil: 'GESTAO' }, SEGREDO_TESTE, {
      algorithm: 'HS256',
      expiresIn: '8h',
    });

    const res = await request(app).get('/usuarios').set('Authorization', `Bearer ${tokenAntigo}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual(LISTA_REDUZIDA_ESPERADA);
  });

  it('sem token: 401', async () => {
    const res = await request(app).get('/usuarios');

    esperarErro(res, 401, MENSAGEM_NAO_AUTENTICADO);
    expect(findMany).not.toHaveBeenCalled();
  });

  it('usuário bloqueado com token válido: 401 (RN09)', async () => {
    const res = await request(app)
      .get('/usuarios')
      .set('Authorization', `Bearer ${tokenDe(ID_TUTOR_BLOQUEADO)}`);

    expect(res.status).toBe(401);
    expect(findMany).not.toHaveBeenCalled();
  });

  it('troca de senha pendente: 403 (RN10)', async () => {
    buscar(ID_PROFESSOR).troca_senha_obrigatoria = true;

    const res = await getUsuarios('PROFESSOR');

    esperarErro(res, 403, MENSAGEM_TROCA_SENHA_OBRIGATORIA, CODIGOS_ERRO.TROCA_SENHA_OBRIGATORIA);
    expect(findMany).not.toHaveBeenCalled();
  });
});

describe('GET /usuarios — Gestão recebe a lista completa (sem regressão)', () => {
  it('todos os usuários, de qualquer perfil e status, com e-mail e status', async () => {
    const res = await getUsuarios('GESTAO');

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(banco.length);
    expect(res.body).toContainEqual({
      id: ID_TUTOR_BLOQUEADO,
      nome: 'Tutor Bloqueado Ficticio',
      email: `usuario.${ID_TUTOR_BLOQUEADO}@sisto.exemplo`,
      perfil: 'TUTOR',
      status: 'BLOQUEADO',
    });
    expect(res.body.map((u) => u.perfil)).toContain('TECNICO_ADMINISTRATIVO');
    expect(res.text).not.toMatch(/senha|\$2b\$/);
  });

  it('sem filtro, a consulta é a mesma de antes da #44', async () => {
    await getUsuarios('GESTAO');

    expect(findMany).toHaveBeenCalledWith({
      select: { id: true, nome: true, email: true, perfil: true, status: true },
      orderBy: [{ nome: 'asc' }, { id: 'asc' }],
    });
  });

  // Decisão do Rafael na #44: a Gestão fica como antes, sem filtro.
  it.each([
    ['válido', '?perfil=TUTOR'],
    ['de perfil não destinatário', '?perfil=PROFESSOR'],
    ['inexistente', '?perfil=DIRETOR'],
    ['vazio', '?perfil='],
    ['repetido', '?perfil=TUTOR&perfil=GESTAO'],
    ['em minúsculas', '?perfil=tutor'],
  ])('?perfil= %s é ignorado: 200 com a lista completa e a consulta de antes', async (_caso, query) => {
    const res = await getUsuarios('GESTAO', query);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(banco.length);
    expect(findMany).toHaveBeenCalledWith({
      select: { id: true, nome: true, email: true, perfil: true, status: true },
      orderBy: [{ nome: 'asc' }, { id: 'asc' }],
    });
  });
});

describe('listarUsuarios — service', () => {
  it('sem solicitante (falha fechada): lista reduzida', async () => {
    const db = { usuario: { findMany: vi.fn().mockResolvedValue([]) } };

    await listarUsuarios(undefined, {}, { db });

    expect(db.usuario.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ select: { id: true, nome: true, perfil: true } }),
    );
  });
});

// ---------------------------------------------------------------------------
// PUT /usuarios/{id} — RN13 (tutor com estudantes vinculados)
// ---------------------------------------------------------------------------

describe('PUT /usuarios/{id} — troca de perfil de Tutor com tutorados (RN13, 409)', () => {
  it.each(['PROFESSOR', 'PEDAGOGICO', 'GESTAO', 'TECNICO_ADMINISTRATIVO'])(
    'TUTOR com estudantes vinculados para %s: 409 e nada é gravado',
    async (novoPerfil) => {
      const res = await put(ID_TUTOR_COM_TUTORADOS, { perfil: novoPerfil });

      esperarErro(res, 409, MENSAGEM_TUTOR_COM_TUTORADOS, CODIGOS_ERRO.TUTOR_COM_TUTORADOS);
      expect(update).not.toHaveBeenCalled();
      expect(buscar(ID_TUTOR_COM_TUTORADOS).perfil).toBe('TUTOR');
    },
  );

  it('a troca de perfil junto com outros campos também é recusada por inteiro', async () => {
    const res = await put(ID_TUTOR_COM_TUTORADOS, {
      nome: 'Nome Novo Ficticio',
      perfil: 'PROFESSOR',
      status: 'BLOQUEADO',
    });

    esperarErro(res, 409, MENSAGEM_TUTOR_COM_TUTORADOS, CODIGOS_ERRO.TUTOR_COM_TUTORADOS);
    expect(buscar(ID_TUTOR_COM_TUTORADOS)).toMatchObject({
      nome: 'Ana Tutora Ficticia',
      perfil: 'TUTOR',
      status: 'ATIVO',
    });
  });

  it('a contagem de tutorados é feita dentro da transação SERIALIZABLE', async () => {
    await put(ID_TUTOR_COM_TUTORADOS, { perfil: 'PROFESSOR' });

    expect($transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'Serializable',
    });
    expect(estudanteCount).toHaveBeenCalledWith({ where: { tutor_id: ID_TUTOR_COM_TUTORADOS } });
  });

  it('a mensagem pede para desvincular os estudantes antes', () => {
    expect(MENSAGEM_TUTOR_COM_TUTORADOS).toMatch(/estudantes vinculados/);
    expect(MENSAGEM_TUTOR_COM_TUTORADOS).toMatch(/[Dd]esvincule/);
  });

  it('depois de desvincular todos os estudantes, a troca de perfil funciona (200)', async () => {
    estudantes = estudantes.map((e) => ({ ...e, tutor_id: null }));

    const res = await put(ID_TUTOR_COM_TUTORADOS, { perfil: 'PEDAGOGICO' });

    expect(res.status).toBe(200);
    expect(res.body.perfil).toBe('PEDAGOGICO');
  });

  it('conflito de serialização (P2034) é repetido e então esbarra na regra: 409 RN13', async () => {
    // 1ª tentativa aborta como se um vínculo novo tivesse sido criado ao mesmo tempo.
    $transaction.mockImplementationOnce(async () => {
      const erro = new Error('Transaction failed due to a write conflict or a deadlock.');
      erro.code = 'P2034';
      throw erro;
    });
    estudantes = [{ id: 1, tutor_id: ID_TUTOR_SEM_TUTORADOS }];

    const res = await put(ID_TUTOR_SEM_TUTORADOS, { perfil: 'PROFESSOR' });

    esperarErro(res, 409, MENSAGEM_TUTOR_COM_TUTORADOS, CODIGOS_ERRO.TUTOR_COM_TUTORADOS);
    expect($transaction).toHaveBeenCalledTimes(2);
  });

  it('P2034 em todas as tentativas: 409 pedindo nova tentativa', async () => {
    $transaction.mockImplementation(async () => {
      const erro = new Error('Transaction failed due to a write conflict or a deadlock.');
      erro.code = 'P2034';
      throw erro;
    });

    const res = await put(ID_TUTOR_SEM_TUTORADOS, { perfil: 'PROFESSOR' });

    esperarErro(res, 409, MENSAGEM_CONFLITO_CONCORRENTE, CODIGOS_ERRO.CONFLITO_CONCORRENTE);
  });
});

describe('PUT /usuarios/{id} — o que continua permitido (RN13, RN07)', () => {
  it('TUTOR sem estudantes vinculados troca de perfil: 200', async () => {
    const res = await put(ID_TUTOR_SEM_TUTORADOS, { perfil: 'PROFESSOR' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: ID_TUTOR_SEM_TUTORADOS, perfil: 'PROFESSOR' });
    expect(buscar(ID_TUTOR_SEM_TUTORADOS).perfil).toBe('PROFESSOR');
  });

  it.each([
    ['nome', { nome: 'Ana Tutora Renomeada Ficticia' }],
    ['e-mail', { email: 'ana.nova@sisto.exemplo' }],
    ['bloqueio', { status: 'BLOQUEADO' }],
    ['desativação', { status: 'DESATIVADO' }],
    ['reenvio do perfil atual (TUTOR)', { perfil: 'TUTOR' }],
  ])('TUTOR com tutorados: alterar %s é permitido (200) e não consulta tutorados', async (_c, corpo) => {
    const res = await put(ID_TUTOR_COM_TUTORADOS, corpo);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject(corpo);
    expect(estudanteCount).not.toHaveBeenCalled();
  });

  it('tutor bloqueado com tutorados é reativado normalmente (vínculo mantido)', async () => {
    estudantes.push({ id: 4, tutor_id: ID_TUTOR_BLOQUEADO });

    const res = await put(ID_TUTOR_BLOQUEADO, { status: 'ATIVO' });

    expect(res.status).toBe(200);
    expect(estudantes.find((e) => e.id === 4).tutor_id).toBe(ID_TUTOR_BLOQUEADO);
  });

  it('tutor bloqueado com tutorados também não troca de perfil: 409', async () => {
    estudantes.push({ id: 4, tutor_id: ID_TUTOR_BLOQUEADO });

    const res = await put(ID_TUTOR_BLOQUEADO, { perfil: 'PROFESSOR' });

    esperarErro(res, 409, MENSAGEM_TUTOR_COM_TUTORADOS, CODIGOS_ERRO.TUTOR_COM_TUTORADOS);
  });

  it('promover outro perfil a TUTOR não consulta tutorados: 200', async () => {
    const res = await put(ID_PROFESSOR, { perfil: 'TUTOR' });

    expect(res.status).toBe(200);
    expect(estudanteCount).not.toHaveBeenCalled();
  });
});
