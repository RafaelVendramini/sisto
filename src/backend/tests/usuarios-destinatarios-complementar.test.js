// Testes complementares da Issue #44 (QA) — somente dados fictícios (RN05).
// Foco: nenhum caminho entrega e-mail/status a quem não é Gestão (RN20),
// parâmetros extras/malformados, perfil do banco x token, ordem das
// verificações do PUT e a contagem de tutorados no client da transação (RN13).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  findMany: vi.fn(),
  update: vi.fn(),
  count: vi.fn(),
  create: vi.fn(),
  estudanteCountGlobal: vi.fn(),
  estudanteCountTx: vi.fn(),
  $transaction: vi.fn(),
  criarLog: vi.fn(),
}));
const { findUnique, findMany, update, count, estudanteCountGlobal, estudanteCountTx, $transaction } =
  mocks;

vi.mock('../src/lib/prisma.js', () => ({
  default: {
    usuario: {
      findUnique: mocks.findUnique,
      findMany: mocks.findMany,
      update: mocks.update,
      count: mocks.count,
      create: mocks.create,
    },
    // Fora da transação: se a RN13 contasse aqui, o teste de transação falharia.
    estudante: { count: mocks.estudanteCountGlobal },
    logAuditoria: { create: mocks.criarLog },
    $transaction: mocks.$transaction,
  },
}));

const { default: app } = await import('../src/app.js');
const { MENSAGEM_NAO_AUTENTICADO } = await import('../src/services/sessao.js');
const { MENSAGEM_PERFIL_SEM_PERMISSAO } = await import('../src/middlewares/autenticacao.js');
const {
  MENSAGEM_FILTRO_PERFIL_INVALIDO,
  MENSAGEM_TUTOR_COM_TUTORADOS,
  MENSAGEM_EMAIL_DUPLICADO,
  MENSAGEM_USUARIO_NAO_ENCONTRADO,
  listarUsuarios,
} = await import('../src/services/usuarios.js');

const SEGREDO_TESTE = 'segredo-ficticio-de-teste-qa-com-mais-de-32-caracteres';
const NAO_GESTAO = ['PROFESSOR', 'TUTOR', 'PEDAGOGICO', 'TECNICO_ADMINISTRATIVO'];
const ID = {
  PROFESSOR: 1,
  TUTOR: 2,
  GESTAO: 3,
  PEDAGOGICO: 4,
  TECNICO_ADMINISTRATIVO: 5,
  GESTAO_2: 6,
  TUTOR_DESATIVADO: 7,
  PROFESSOR_DESATIVADO: 8,
  TUTOR_COM_TUTORADOS: 9,
};
const CHAVES_REDUZIDAS = ['id', 'nome', 'perfil'];
const CHAVES_COMPLETAS = ['email', 'id', 'nome', 'perfil', 'status'];

let banco;
let estudantes;

function usuario(id, nome, perfil, status = 'ATIVO') {
  return {
    id,
    nome,
    email: `qa.usuario.${id}@sisto.exemplo`,
    senha_hash: '$2b$04$abcdefghijklmnopqrstuuabcdefghijklmnopqrstuvwxyz01234',
    perfil,
    status,
    troca_senha_obrigatoria: false,
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

function atende(registro, where = {}) {
  if (where.status !== undefined && registro.status !== where.status) return false;
  if (where.perfil !== undefined) {
    if (typeof where.perfil === 'string') return registro.perfil === where.perfil;
    if (where.perfil.in) return where.perfil.in.includes(registro.perfil);
  }
  return true;
}

const buscar = (id) => banco.find((u) => u.id === id);

beforeEach(() => {
  process.env.JWT_SECRET = SEGREDO_TESTE;
  banco = [
    usuario(ID.PROFESSOR, 'Carla Professora Ficticia', 'PROFESSOR'),
    usuario(ID.TUTOR, 'Diego Tutor Ficticio', 'TUTOR'),
    usuario(ID.GESTAO, 'Elisa Gestao Ficticia', 'GESTAO'),
    usuario(ID.PEDAGOGICO, 'Fabio Pedagogico Ficticio', 'PEDAGOGICO'),
    usuario(ID.TECNICO_ADMINISTRATIVO, 'Gina Tecnica Ficticia', 'TECNICO_ADMINISTRATIVO'),
    usuario(ID.GESTAO_2, 'Hugo Gestao Ficticio', 'GESTAO'),
    usuario(ID.TUTOR_DESATIVADO, 'Iris Tutora Desativada Ficticia', 'TUTOR', 'DESATIVADO'),
    usuario(ID.PROFESSOR_DESATIVADO, 'Joao Professor Desativado Ficticio', 'PROFESSOR', 'DESATIVADO'),
    usuario(ID.TUTOR_COM_TUTORADOS, 'Karen Tutora Ficticia', 'TUTOR'),
  ];
  estudantes = [
    { id: 1, tutor_id: ID.TUTOR_COM_TUTORADOS },
    { id: 2, tutor_id: ID.TUTOR_DESATIVADO },
  ];

  findUnique.mockReset();
  findUnique.mockImplementation(async ({ where, select }) => {
    const r = banco.find((u) =>
      where.id !== undefined ? u.id === where.id : u.email === where.email,
    );
    return r ? selecionar(r, select) : null;
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
    const r = buscar(where.id);
    Object.assign(r, data);
    return selecionar(r, select);
  });
  count.mockReset();
  count.mockImplementation(
    async ({ where }) =>
      banco.filter(
        (u) => u.perfil === where.perfil && u.status === where.status && u.id !== where.id?.not,
      ).length,
  );
  const contarTutorados = async ({ where }) =>
    estudantes.filter((e) => e.tutor_id === where.tutor_id).length;
  estudanteCountGlobal.mockReset();
  estudanteCountGlobal.mockImplementation(contarTutorados);
  estudanteCountTx.mockReset();
  estudanteCountTx.mockImplementation(contarTutorados);
  mocks.create.mockReset();

  mocks.criarLog.mockReset();
  mocks.criarLog.mockResolvedValue({ id: 1 });

  // A edição grava o LogAuditoria na mesma transação (Issue #91).
  $transaction.mockReset();
  $transaction.mockImplementation(async (fn) =>
    fn({
      logAuditoria: { create: mocks.criarLog },
      usuario: { findUnique, findMany, update, count },
      estudante: { count: estudanteCountTx },
    }),
  );
});

afterEach(() => {
  delete process.env.JWT_SECRET;
});

function token(id, perfil = buscar(id).perfil) {
  return jwt.sign({ id, perfil }, SEGREDO_TESTE, { algorithm: 'HS256', expiresIn: '8h' });
}

function get(perfil, query = '') {
  return request(app)
    .get(`/usuarios${query}`)
    .set('Authorization', `Bearer ${token(ID[perfil])}`);
}

function put(id, corpo, perfil = 'GESTAO') {
  return request(app)
    .put(`/usuarios/${id}`)
    .set('Authorization', `Bearer ${token(ID[perfil])}`)
    .send(corpo);
}

/** Nenhum e-mail, status ou hash no texto bruto da resposta. */
function semDadosRestritos(res) {
  expect(res.text).not.toMatch(/@|email|"status"|ATIVO|BLOQUEADO|DESATIVADO|senha|\$2b\$/);
}

// ---------------------------------------------------------------------------
// RN20 — nenhum caminho entrega e-mail/status a quem não é Gestão
// ---------------------------------------------------------------------------

describe('GET /usuarios — parâmetros extras não abrem dados (RN20)', () => {
  it.each(NAO_GESTAO)(
    '%s: ?status=DESATIVADO&email=...&completo=true é ignorado (só ativos, sem e-mail)',
    async (perfil) => {
      const res = await get(
        perfil,
        '?status=DESATIVADO&email=qa.usuario.7%40sisto.exemplo&completo=true',
      );

      expect(res.status).toBe(200);
      semDadosRestritos(res);
      expect(res.body.map((u) => u.id)).not.toContain(ID.TUTOR_DESATIVADO);
      for (const u of res.body) expect(Object.keys(u).sort()).toEqual(CHAVES_REDUZIDAS);
    },
  );

  it('?perfil=TUTOR&status=DESATIVADO: o tutor desativado continua fora', async () => {
    const res = await get('PROFESSOR', '?perfil=TUTOR&status=DESATIVADO');

    expect(res.status).toBe(200);
    expect(res.body.map((u) => u.id).sort()).toEqual([ID.TUTOR, ID.TUTOR_COM_TUTORADOS].sort());
    semDadosRestritos(res);
  });

  it.each([
    ['colchetes (perfil[x])', '?perfil[x]=TUTOR'],
    ['array (perfil[])', '?perfil[]=TUTOR'],
    ['espaços', '?perfil=%20TUTOR%20'],
    ['mistura de caixa', '?perfil=Gestao'],
    ['injeção de "in"', '?perfil[in]=PROFESSOR'],
  ])('?perfil malformado (%s): nunca vaza e-mail/status nem perfis restritos', async (_c, query) => {
    const res = await get('TECNICO_ADMINISTRATIVO', query);

    expect([200, 400]).toContain(res.status);
    semDadosRestritos(res);
    if (res.status === 200) {
      for (const u of res.body) {
        expect(Object.keys(u).sort()).toEqual(CHAVES_REDUZIDAS);
        expect(['TUTOR', 'PEDAGOGICO', 'GESTAO']).toContain(u.perfil);
      }
    } else {
      expect(res.body).toEqual({ erro: MENSAGEM_FILTRO_PERFIL_INVALIDO });
    }
  });

  it('mensagem do 400 para não-Gestão não cita e-mail/status nem lista PROFESSOR/TECNICO', async () => {
    const res = await get('PROFESSOR', '?perfil=PROFESSOR');

    expect(res.status).toBe(400);
    semDadosRestritos(res);
    expect(res.body.erro).not.toMatch(/PROFESSOR|TECNICO_ADMINISTRATIVO/);
  });

  it('usuário DESATIVADO com token válido: 401 sem consultar a lista (RN09)', async () => {
    const res = await request(app)
      .get('/usuarios')
      .set('Authorization', `Bearer ${token(ID.PROFESSOR_DESATIVADO)}`);

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ erro: MENSAGEM_NAO_AUTENTICADO });
    expect(findMany).not.toHaveBeenCalled();
  });

  it('token com perfil GESTAO forjado (assinatura de outro segredo): 401', async () => {
    const forjado = jwt.sign(
      { id: ID.PROFESSOR, perfil: 'GESTAO' },
      'outro-segredo-ficticio-qualquer-com-32-chars',
      { algorithm: 'HS256' },
    );
    const res = await request(app).get('/usuarios').set('Authorization', `Bearer ${forjado}`);

    expect(res.status).toBe(401);
    expect(findMany).not.toHaveBeenCalled();
  });

  it('perfil do banco prevalece: token PROFESSOR de quem hoje é GESTAO recebe a lista completa', async () => {
    buscar(ID.PROFESSOR).perfil = 'GESTAO';
    const res = await request(app)
      .get('/usuarios')
      .set('Authorization', `Bearer ${token(ID.PROFESSOR, 'PROFESSOR')}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(banco.length);
    for (const u of res.body) expect(Object.keys(u).sort()).toEqual(CHAVES_COMPLETAS);
  });

  it('nenhum destinatário ativo do perfil filtrado: 200 com []', async () => {
    buscar(ID.PEDAGOGICO).status = 'BLOQUEADO';
    const res = await get('PROFESSOR', '?perfil=PEDAGOGICO');

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});

describe('GET /usuarios — Gestão (sem regressão para as telas Usuários e Estudantes)', () => {
  it('lista completa traz tutores ativos e inativos com status (tela Estudantes filtra TUTOR+ATIVO)', async () => {
    const res = await get('GESTAO');

    expect(res.status).toBe(200);
    const tutores = res.body.filter((u) => u.perfil === 'TUTOR');
    expect(tutores.map((u) => u.status).sort()).toEqual(['ATIVO', 'ATIVO', 'DESATIVADO']);
    for (const u of res.body) expect(Object.keys(u).sort()).toEqual(CHAVES_COMPLETAS);
    expect(res.text).not.toMatch(/senha|\$2b\$/);
  });

  // Decisão do Rafael na #44: a Gestão não tem filtro; ?perfil= é ignorado.
  it.each(['?perfil=gestao', '?perfil=%20GESTAO'])(
    'Gestão com ?perfil fora do padrão (%s): ignorado, 200 com a lista completa',
    async (query) => {
      const res = await get('GESTAO', query);

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(banco.length);
    },
  );

  it('Gestão com ?perfil[]=GESTAO: o parser "simple" do Express 5 não cria req.query.perfil — lista completa, sem filtro', async () => {
    const res = await get('GESTAO', '?perfil[]=GESTAO');

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(banco.length);
  });

  it('Gestão: parâmetros extras (?status=) são ignorados, lista continua completa', async () => {
    const res = await get('GESTAO', '?status=ATIVO');

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(banco.length);
  });
});

describe('Demais rotas de /usuarios continuam só para a Gestão (RN01/RF14)', () => {
  it.each(NAO_GESTAO)('%s: POST /usuarios 403', async (perfil) => {
    const res = await request(app)
      .post('/usuarios')
      .set('Authorization', `Bearer ${token(ID[perfil])}`)
      .send({ nome: 'Novo Ficticio', email: 'novo@sisto.exemplo', perfil: 'TUTOR' });

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ erro: MENSAGEM_PERFIL_SEM_PERMISSAO });
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it.each(NAO_GESTAO)('%s: PUT /usuarios/{id} 403 (inclusive troca de perfil de tutor)', async (perfil) => {
    const res = await put(ID.TUTOR_COM_TUTORADOS, { perfil: 'PROFESSOR' }, perfil);

    expect(res.status).toBe(403);
    expect($transaction).not.toHaveBeenCalled();
  });

  it.each(NAO_GESTAO)('%s: PUT /usuarios/{id}/senha 403', async (perfil) => {
    const res = await request(app)
      .put(`/usuarios/${ID.TUTOR}/senha`)
      .set('Authorization', `Bearer ${token(ID[perfil])}`)
      .send({ novaSenha: 'SenhaFicticia@123' });

    expect(res.status).toBe(403);
  });
});

describe('listarUsuarios — service (falha fechada)', () => {
  it.each([[{ perfil: 'ADMIN' }], [{ perfil: 'gestao' }], [{}], [null]])(
    'solicitante %j não é Gestão: select reduzido e só ativos destinatários',
    async (solicitante) => {
      const db = { usuario: { findMany: vi.fn().mockResolvedValue([]) } };

      await listarUsuarios(solicitante, {}, { db });

      expect(db.usuario.findMany).toHaveBeenCalledWith({
        where: { status: 'ATIVO', perfil: { in: ['TUTOR', 'PEDAGOGICO', 'GESTAO'] } },
        select: { id: true, nome: true, perfil: true },
        orderBy: [{ nome: 'asc' }, { id: 'asc' }],
      });
    },
  );

  it('query undefined não quebra para não-Gestão', async () => {
    const db = { usuario: { findMany: vi.fn().mockResolvedValue([]) } };
    await expect(listarUsuarios({ perfil: 'TUTOR' }, undefined, { db })).resolves.toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// RN13 — ordem das verificações e transação
// ---------------------------------------------------------------------------

describe('PUT /usuarios/{id} — RN13: ordem e transação', () => {
  it('a contagem de tutorados usa o client da transação, nunca o prisma global', async () => {
    const res = await put(ID.TUTOR_COM_TUTORADOS, { perfil: 'PROFESSOR' });

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ erro: MENSAGEM_TUTOR_COM_TUTORADOS });
    expect(estudanteCountTx).toHaveBeenCalledWith({ where: { tutor_id: ID.TUTOR_COM_TUTORADOS } });
    expect(estudanteCountGlobal).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it('id inexistente com troca de perfil: 404 sem contar tutorados', async () => {
    const res = await put(999, { perfil: 'PROFESSOR' });

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ erro: MENSAGEM_USUARIO_NAO_ENCONTRADO });
    expect(estudanteCountTx).not.toHaveBeenCalled();
  });

  it('perfil inválido no corpo: 400 antes da transação', async () => {
    const res = await put(ID.TUTOR_COM_TUTORADOS, { perfil: 'DIRETOR' });

    expect(res.status).toBe(400);
    expect($transaction).not.toHaveBeenCalled();
  });

  it('e-mail duplicado + troca de perfil de tutor com tutorados: 409 de e-mail (vem antes da RN13)', async () => {
    const res = await put(ID.TUTOR_COM_TUTORADOS, {
      email: `qa.usuario.${ID.PROFESSOR}@sisto.exemplo`,
      perfil: 'PROFESSOR',
    });

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ erro: MENSAGEM_EMAIL_DUPLICADO });
    expect(update).not.toHaveBeenCalled();
  });

  it('tutor DESATIVADO com tutorados também não troca de perfil (409)', async () => {
    const res = await put(ID.TUTOR_DESATIVADO, { perfil: 'PEDAGOGICO' });

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ erro: MENSAGEM_TUTOR_COM_TUTORADOS });
    expect(buscar(ID.TUTOR_DESATIVADO).perfil).toBe('TUTOR');
  });

  it('tutor com tutorados: perfil TUTOR reenviado + bloqueio no mesmo PUT é aceito (200)', async () => {
    const res = await put(ID.TUTOR_COM_TUTORADOS, { perfil: 'TUTOR', status: 'BLOQUEADO' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ perfil: 'TUTOR', status: 'BLOQUEADO' });
    expect(estudanteCountTx).not.toHaveBeenCalled();
  });

  it('a resposta 409 da RN13 não traz e-mail do tutor nem dos estudantes', async () => {
    const res = await put(ID.TUTOR_COM_TUTORADOS, { perfil: 'GESTAO' });

    expect(res.status).toBe(409);
    expect(res.text).not.toMatch(/@/);
  });

  it('a mensagem do 409 pede para desvincular os estudantes antes de alterar o perfil', () => {
    expect(MENSAGEM_TUTOR_COM_TUTORADOS).toMatch(/Desvincule os estudantes/);
    expect(MENSAGEM_TUTOR_COM_TUTORADOS).toMatch(/antes de alterar o perfil/);
  });
});
