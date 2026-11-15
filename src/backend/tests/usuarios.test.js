// Testes de POST /usuarios e GET /usuarios (Issue #12) — somente dados fictícios (RN05).
// Não dependem do banco: src/lib/prisma.js é substituído por um "banco" em
// memória, compartilhado com o login (o que o create grava é o que o
// findUnique do POST /auth/login encontra).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { CODIGOS_ERRO } from '../src/lib/erros.js';

const { findUnique, findMany, create, criarLog, $transaction } = vi.hoisted(() => ({
  findUnique: vi.fn(),
  findMany: vi.fn(),
  create: vi.fn(),
  criarLog: vi.fn(),
  $transaction: vi.fn(),
}));

// O cadastro grava o usuário e o LogAuditoria numa transação (Issue #91).
vi.mock('../src/lib/prisma.js', () => ({
  default: { usuario: { findUnique, findMany, create }, logAuditoria: { create: criarLog }, $transaction },
}));

// Sem vi.mock de services/senha.js: o hash usa o custo real (12). Mockar o
// módulo com importOriginal fazia o worker do Vitest cair (0xC0000409) ao
// carregar o bcrypt nativo. O custo baixo só é usado nos testes unitários do
// service, via injeção de dependência (deps.gerarHash).

const { default: app } = await import('../src/app.js');
const { MENSAGEM_PERFIL_SEM_PERMISSAO, MENSAGEM_TROCA_SENHA_OBRIGATORIA } = await import(
  '../src/middlewares/autenticacao.js'
);
const { MENSAGEM_NAO_AUTENTICADO } = await import('../src/services/sessao.js');
const { MENSAGEM_EMAIL_DUPLICADO, TAMANHO_MAXIMO_NOME, cadastrarUsuario } = await import(
  '../src/services/usuarios.js'
);
const { gerarHashSenha } = await import('../src/services/senha.js');

const SEGREDO_TESTE = 'segredo-ficticio-de-teste-com-mais-de-32-caracteres';
const SENHA_TEMPORARIA = 'Temporaria123';
const REGEX_BCRYPT = /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/;
const PERFIS = ['PROFESSOR', 'TUTOR', 'GESTAO', 'PEDAGOGICO', 'TECNICO_ADMINISTRATIVO'];
const PERFIS_NAO_GESTAO = ['PROFESSOR', 'TUTOR', 'PEDAGOGICO', 'TECNICO_ADMINISTRATIVO'];

/** "Banco" em memória: usuários fictícios. */
let banco;
let proximoId;

function selecionar(registro, select) {
  if (!select) return { ...registro };
  return Object.fromEntries(
    Object.entries(select)
      .filter(([, incluir]) => incluir)
      .map(([campo]) => [campo, registro[campo]]),
  );
}

function usuarioBase(id, perfil, extra = {}) {
  return {
    id,
    nome: `Usuário ${perfil} Exemplo`,
    email: `${perfil.toLowerCase()}.base@sisto.exemplo`,
    // Hash fictício (não usado para login nestes usuários-base).
    senha_hash: '$2b$04$abcdefghijklmnopqrstuuabcdefghijklmnopqrstuvwxyz01234',
    perfil,
    status: 'ATIVO',
    ...extra,
  };
}

beforeEach(() => {
  process.env.JWT_SECRET = SEGREDO_TESTE;
  banco = PERFIS.map((perfil, i) => usuarioBase(i + 1, perfil));
  proximoId = banco.length + 1;

  findUnique.mockReset();
  findUnique.mockImplementation(async ({ where, select }) => {
    const encontrado = banco.find((u) =>
      where.id !== undefined ? u.id === where.id : u.email === where.email,
    );
    return encontrado ? selecionar(encontrado, select) : null;
  });

  create.mockReset();
  create.mockImplementation(async ({ data, select }) => {
    if (banco.some((u) => u.email === data.email)) {
      const erro = new Error('Unique constraint failed on the fields: (`email`)');
      erro.code = 'P2002';
      throw erro;
    }
    const registro = { id: proximoId++, status: 'ATIVO', ...data };
    banco.push(registro);
    return selecionar(registro, select);
  });

  criarLog.mockReset();
  criarLog.mockResolvedValue({ id: 1 });

  $transaction.mockReset();
  $transaction.mockImplementation(async (fn) =>
    fn({ usuario: { findUnique, findMany, create }, logAuditoria: { create: criarLog } }),
  );

  findMany.mockReset();
  findMany.mockImplementation(async ({ select }) =>
    [...banco]
      .sort((a, b) => a.nome.localeCompare(b.nome) || a.id - b.id)
      .map((u) => selecionar(u, select)),
  );
});

afterEach(() => {
  delete process.env.JWT_SECRET;
});

/** Token como o do POST /auth/login para o usuário-base do perfil. */
function tokenDoPerfil(perfil) {
  const usuario = banco.find((u) => u.perfil === perfil && u.email.endsWith('.base@sisto.exemplo'));
  return jwt.sign({ id: usuario.id, perfil }, SEGREDO_TESTE, { algorithm: 'HS256', expiresIn: '8h' });
}

function postUsuarios(corpo, perfil = 'GESTAO') {
  const req = request(app).post('/usuarios');
  if (perfil) req.set('Authorization', `Bearer ${tokenDoPerfil(perfil)}`);
  return req.send(corpo);
}

function getUsuarios(perfil = 'GESTAO') {
  const req = request(app).get('/usuarios');
  if (perfil) req.set('Authorization', `Bearer ${tokenDoPerfil(perfil)}`);
  return req;
}

function corpoValido(extra = {}) {
  return {
    nome: 'Docente Ficticio',
    email: 'docente.ficticio@sisto.exemplo',
    perfil: 'PROFESSOR',
    senha: SENHA_TEMPORARIA,
    ...extra,
  };
}

/** Nenhuma resposta pode conter o hash da senha (RNF06). */
function esperarSemHash(res) {
  const texto = JSON.stringify(res.body);
  expect(texto).not.toContain('senha_hash');
  expect(texto).not.toContain('$2b$');
}

function esperar400(res) {
  expect(res.status).toBe(400);
  expect(res.headers['content-type']).toMatch(/application\/json/);
  expect(typeof res.body.erro).toBe('string');
  expect(res.body.erro.length).toBeGreaterThan(0);
  expect(create).not.toHaveBeenCalled();
  esperarSemHash(res);
}

describe('POST /usuarios — cadastro pela Gestão (201)', () => {
  it.each(PERFIS)('cadastra usuário com perfil %s, status ATIVO', async (perfil) => {
    const email = `novo.${perfil.toLowerCase()}@sisto.exemplo`;
    const res = await postUsuarios(corpoValido({ nome: `Novo ${perfil}`, email, perfil }));

    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      id: expect.any(Number),
      nome: `Novo ${perfil}`,
      email,
      perfil,
      status: 'ATIVO',
    });
    esperarSemHash(res);
  });

  it('grava apenas o hash bcrypt da senha, nunca o texto (RNF03)', async () => {
    const res = await postUsuarios(corpoValido());

    expect(res.status).toBe(201);
    expect(create).toHaveBeenCalledTimes(1);
    const { data, select } = create.mock.calls[0][0];
    expect(data).not.toHaveProperty('senha');
    expect(data.senha_hash).toMatch(REGEX_BCRYPT);
    expect(data.senha_hash).not.toContain(SENHA_TEMPORARIA);
    expect(JSON.stringify(data)).not.toContain(SENHA_TEMPORARIA);
    expect(await bcrypt.compare(SENHA_TEMPORARIA, data.senha_hash)).toBe(true);
    expect(data.status).toBe('ATIVO');
    // RN10 (SSD 1.6, #37): a senha do cadastro é temporária.
    expect(data.troca_senha_obrigatoria).toBe(true);
    // select explícito sem senha_hash (nem troca_senha_obrigatoria)
    expect(select).toEqual({ id: true, nome: true, email: true, perfil: true, status: true });
  });

  it('normaliza e-mail (trim + minúsculas) e nome (trim)', async () => {
    const res = await postUsuarios(
      corpoValido({ nome: '  Docente Ficticio  ', email: '  Docente.Ficticio@SISTO.Exemplo ' }),
    );

    expect(res.status).toBe(201);
    expect(res.body.nome).toBe('Docente Ficticio');
    expect(res.body.email).toBe('docente.ficticio@sisto.exemplo');
    expect(findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { email: 'docente.ficticio@sisto.exemplo' } }),
    );
  });

  it('aceita senha com exatamente 8 caracteres e com 72 bytes', async () => {
    const r1 = await postUsuarios(corpoValido({ email: 'a@sisto.exemplo', senha: '12345678' }));
    const r2 = await postUsuarios(corpoValido({ email: 'b@sisto.exemplo', senha: 'x'.repeat(72) }));

    expect(r1.status).toBe(201);
    expect(r2.status).toBe(201);
  });

  it('usuário cadastrado autentica com a senha temporária, com troca obrigatória (RN10)', async () => {
    const cadastro = await postUsuarios(
      corpoValido({ email: 'tutor.novo@sisto.exemplo', perfil: 'TUTOR' }),
    );
    expect(cadastro.status).toBe(201);

    const login = await request(app)
      .post('/auth/login')
      .send({ email: 'Tutor.Novo@sisto.exemplo', senha: SENHA_TEMPORARIA });

    expect(login.status).toBe(200);
    expect(login.body.usuario).toEqual({
      id: cadastro.body.id,
      nome: 'Docente Ficticio',
      perfil: 'TUTOR',
    });
    const payload = jwt.verify(login.body.token, SEGREDO_TESTE);
    expect(payload).toMatchObject({ id: cadastro.body.id, perfil: 'TUTOR' });
    // RN10 (SSD 1.6, #37): o primeiro login exige a troca da senha temporária.
    expect(login.body.trocaSenhaObrigatoria).toBe(true);

    // Com a troca pendente, o token é válido (não 401), mas as rotas
    // protegidas respondem 403 com a mensagem da troca obrigatória — antes
    // mesmo da checagem de perfil. O fluxo completo da troca está em
    // tests/troca-senha.test.js.
    for (const caminho of ['/usuarios', '/rota-protegida-ficticia']) {
      const res = await request(app)
        .get(caminho)
        .set('Authorization', `Bearer ${login.body.token}`);
      expect(res.status).toBe(403);
      expect(res.body).toEqual({ erro: MENSAGEM_TROCA_SENHA_OBRIGATORIA, codigo: CODIGOS_ERRO.TROCA_SENHA_OBRIGATORIA });
    }
  });

  it('senha errada para o usuário cadastrado: 401 no login', async () => {
    await postUsuarios(corpoValido());

    const login = await request(app)
      .post('/auth/login')
      .send({ email: 'docente.ficticio@sisto.exemplo', senha: 'OutraSenha999' });

    expect(login.status).toBe(401);
  });
});

describe('POST /usuarios — validações (400)', () => {
  it('senha com menos de 8 caracteres (RN10)', async () => {
    const res = await postUsuarios(corpoValido({ senha: '1234567' }));

    esperar400(res);
    expect(res.body.erro).toBe('A senha deve ter no mínimo 8 caracteres.');
  });

  it('senha com mais de 72 bytes (limite do bcrypt)', async () => {
    const res = await postUsuarios(corpoValido({ senha: 'x'.repeat(73) }));

    esperar400(res);
    expect(res.body.erro).toMatch(/no máximo 72 bytes/);
  });

  it('senha com 37 letras acentuadas (74 bytes) é recusada', async () => {
    esperar400(await postUsuarios(corpoValido({ senha: 'á'.repeat(37) })));
  });

  it.each(['ADMIN', 'gestao', 'Gestão', 'Professor', 'EQUIPE_PEDAGOGICA', ' GESTAO'])(
    'perfil inválido "%s"',
    async (perfil) => {
      const res = await postUsuarios(corpoValido({ perfil }));

      esperar400(res);
      expect(res.body.erro).toMatch(/^Perfil inválido/);
    },
  );

  it.each([
    'sem-arroba.sisto.exemplo',
    'docente@',
    '@sisto.exemplo',
    'docente@sisto',
    'docente@@sisto.exemplo',
    'doc ente@sisto.exemplo',
    'docente@sisto..exemplo',
    'docente@sisto.exemplo.',
  ])('e-mail inválido "%s"', async (email) => {
    const res = await postUsuarios(corpoValido({ email }));

    esperar400(res);
    expect(res.body.erro).toBe('Informe um e-mail em formato válido.');
    // Nenhuma busca por e-mail (só a da sessão, por id): a validação barra antes.
    expect(findUnique.mock.calls.some(([args]) => args?.where?.email !== undefined)).toBe(false);
  });

  it('e-mail com mais de 254 caracteres', async () => {
    const email = `${'a'.repeat(250)}@sisto.exemplo`;
    esperar400(await postUsuarios(corpoValido({ email })));
  });

  it.each(['nome', 'email', 'perfil', 'senha'])('campo %s ausente', async (campo) => {
    const corpo = corpoValido();
    delete corpo[campo];
    const res = await postUsuarios(corpo);

    esperar400(res);
    expect(res.body.erro).toContain(campo);
  });

  it.each([
    ['nome vazio', { nome: '' }],
    ['nome só com espaços', { nome: '   ' }],
    ['nome numérico', { nome: 123 }],
    ['email nulo', { email: null }],
    ['email numérico', { email: 42 }],
    ['perfil vazio', { perfil: '' }],
    ['perfil em lista', { perfil: ['GESTAO'] }],
    ['senha vazia', { senha: '' }],
    ['senha numérica', { senha: 12345678 }],
  ])('%s', async (_caso, extra) => {
    esperar400(await postUsuarios(corpoValido(extra)));
  });

  it('corpo vazio lista todos os campos ausentes', async () => {
    const res = await postUsuarios({});

    esperar400(res);
    expect(res.body.erro).toBe('Informe nome, email, perfil, senha (texto não vazio).');
  });

  it('corpo em lista (array) é recusado', async () => {
    esperar400(await postUsuarios([corpoValido()]));
  });

  it(`nome com mais de ${TAMANHO_MAXIMO_NOME} caracteres`, async () => {
    esperar400(await postUsuarios(corpoValido({ nome: 'N'.repeat(TAMANHO_MAXIMO_NOME + 1) })));
  });

  it('campos extras (status, id, senha_hash, confirmarSenha, troca_senha_obrigatoria) são ignorados: 201 ATIVO', async () => {
    const hashInjetado = '$2b$04$hashqualquerinventadoparatesteaaaaaaaaaaaaaaaaaaaaaa';
    const res = await postUsuarios(
      corpoValido({
        status: 'BLOQUEADO',
        id: 999,
        senha_hash: hashInjetado,
        confirmarSenha: SENHA_TEMPORARIA,
        troca_senha_obrigatoria: false,
        trocaSenhaObrigatoria: false,
      }),
    );

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('ATIVO');
    expect(res.body.id).not.toBe(999);
    expect(res.body.id).toBe(PERFIS.length + 1); // id gerado pelo "banco"
    esperarSemHash(res);

    const { data } = create.mock.calls[0][0];
    expect(Object.keys(data).sort()).toEqual([
      'email',
      'nome',
      'perfil',
      'senha_hash',
      'status',
      'troca_senha_obrigatoria',
    ]);
    expect(data).not.toHaveProperty('id');
    expect(data).not.toHaveProperty('confirmarSenha');
    expect(data).not.toHaveProperty('trocaSenhaObrigatoria');
    expect(data.status).toBe('ATIVO');
    // RN10: o cliente não consegue dispensar a troca obrigatória.
    expect(data.troca_senha_obrigatoria).toBe(true);
    expect(data.senha_hash).not.toBe(hashInjetado);
    expect(await bcrypt.compare(SENHA_TEMPORARIA, data.senha_hash)).toBe(true);
  });

  it('a mensagem de erro não ecoa a senha nem o e-mail enviados', async () => {
    const r1 = await postUsuarios(corpoValido({ senha: 'curta' }));
    const r2 = await postUsuarios(corpoValido({ email: 'invalido-sigiloso' }));

    expect(r1.body.erro).not.toContain('curta');
    expect(r2.body.erro).not.toContain('invalido-sigiloso');
  });
});

describe('POST /usuarios — e-mail duplicado (409)', () => {
  it('pré-checagem: e-mail já cadastrado (comparação após normalizar)', async () => {
    const res = await postUsuarios(corpoValido({ email: ' PROFESSOR.base@sisto.exemplo ' }));

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ erro: MENSAGEM_EMAIL_DUPLICADO, codigo: CODIGOS_ERRO.EMAIL_DUPLICADO });
    expect(create).not.toHaveBeenCalled();
  });

  it('segundo cadastro com o mesmo e-mail: 409', async () => {
    expect((await postUsuarios(corpoValido())).status).toBe(201);
    const res = await postUsuarios(corpoValido({ nome: 'Outro Nome' }));

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ erro: MENSAGEM_EMAIL_DUPLICADO, codigo: CODIGOS_ERRO.EMAIL_DUPLICADO });
  });

  it('corrida: violação de unicidade do Prisma (P2002) no create vira 409, não 500', async () => {
    // A pré-checagem não encontra o e-mail (outro cadastro ainda não gravou)...
    findUnique.mockImplementation(async ({ where, select }) => {
      if (where.email !== undefined) return null;
      const u = banco.find((x) => x.id === where.id);
      return u ? selecionar(u, select) : null;
    });
    // ...mas o banco recusa no create.
    create.mockImplementationOnce(async () => {
      const erro = new Error('Unique constraint failed on the fields: (`email`)');
      erro.code = 'P2002';
      throw erro;
    });

    const res = await postUsuarios(corpoValido());

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ erro: MENSAGEM_EMAIL_DUPLICADO, codigo: CODIGOS_ERRO.EMAIL_DUPLICADO });
  });

  it('outro erro do banco no create: 500 genérico', async () => {
    create.mockImplementationOnce(async () => {
      throw new Error('falha fictícia de conexão');
    });

    const res = await postUsuarios(corpoValido());

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ erro: 'Erro interno do servidor' });
  });
});

describe('GET /usuarios — listagem pela Gestão (200)', () => {
  it('retorna a lista com id, nome, email, perfil e status, sem senha_hash', async () => {
    const res = await getUsuarios();

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(PERFIS.length);
    for (const usuario of res.body) {
      expect(Object.keys(usuario).sort()).toEqual(['email', 'id', 'nome', 'perfil', 'status']);
    }
    esperarSemHash(res);
  });

  it('usa select explícito e ordem estável (nome, depois id)', async () => {
    await getUsuarios();

    expect(findMany).toHaveBeenCalledWith({
      select: { id: true, nome: true, email: true, perfil: true, status: true },
      orderBy: [{ nome: 'asc' }, { id: 'asc' }],
    });
  });

  it('inclui o usuário recém-cadastrado, sem hash', async () => {
    await postUsuarios(corpoValido());
    const res = await getUsuarios();

    expect(res.status).toBe(200);
    expect(res.body).toContainEqual({
      id: expect.any(Number),
      nome: 'Docente Ficticio',
      email: 'docente.ficticio@sisto.exemplo',
      perfil: 'PROFESSOR',
      status: 'ATIVO',
    });
    esperarSemHash(res);
  });

  it('lista vazia: 200 com []', async () => {
    findMany.mockResolvedValueOnce([]);
    const res = await getUsuarios();

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});

describe('Permissões (RN01, Seção 4)', () => {
  it.each(PERFIS_NAO_GESTAO)('%s recebe 403 no POST /usuarios', async (perfil) => {
    const res = await postUsuarios(corpoValido(), perfil);

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ erro: MENSAGEM_PERFIL_SEM_PERMISSAO });
    expect(create).not.toHaveBeenCalled();
  });

  // Issue #44 (RN20): o GET /usuarios passou a ser aberto aos 5 perfis, com
  // lista reduzida para quem não é Gestão (detalhes em
  // usuarios-destinatarios.test.js). Antes, estes perfis recebiam 403.
  it.each(PERFIS_NAO_GESTAO)('%s recebe 200 (lista reduzida) no GET /usuarios', async (perfil) => {
    const res = await getUsuarios(perfil);

    expect(res.status).toBe(200);
    for (const usuario of res.body) {
      expect(Object.keys(usuario).sort()).toEqual(['id', 'nome', 'perfil']);
    }
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ select: { id: true, nome: true, perfil: true } }),
    );
  });

  it('perfil sem permissão recebe 403 antes da validação do corpo', async () => {
    const res = await postUsuarios({}, 'PROFESSOR');

    expect(res.status).toBe(403);
  });

  it.each([
    ['POST', () => request(app).post('/usuarios').send(corpoValido())],
    ['GET', () => request(app).get('/usuarios')],
  ])('%s /usuarios sem token: 401', async (_metodo, fazer) => {
    const res = await fazer();

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ erro: MENSAGEM_NAO_AUTENTICADO });
    expect(create).not.toHaveBeenCalled();
    expect(findMany).not.toHaveBeenCalled();
  });

  it('Gestão bloqueada recebe 401 (RN09)', async () => {
    const token = tokenDoPerfil('GESTAO');
    banco.find((u) => u.perfil === 'GESTAO').status = 'BLOQUEADO';

    const res = await request(app).get('/usuarios').set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(401);
  });
});

describe('cadastrarUsuario — injeção de dependência (service)', () => {
  it('usa o gerarHash injetado (custo baixo) e grava só o hash', async () => {
    const gerarHash = vi.fn((senha) => gerarHashSenha(senha, 4));
    const db = { usuario: { findUnique, create }, $transaction };

    const usuario = await cadastrarUsuario(corpoValido(), { id: 3 }, { db, gerarHash });

    expect(gerarHash).toHaveBeenCalledWith(SENHA_TEMPORARIA);
    expect(usuario).toEqual({
      id: expect.any(Number),
      nome: 'Docente Ficticio',
      email: 'docente.ficticio@sisto.exemplo',
      perfil: 'PROFESSOR',
      status: 'ATIVO',
    });
    const { data } = create.mock.calls[0][0];
    expect(data.senha_hash).toMatch(/^\$2b\$04\$/);
    expect(data.troca_senha_obrigatoria).toBe(true);
    expect(usuario).not.toHaveProperty('troca_senha_obrigatoria');
    expect(await bcrypt.compare(SENHA_TEMPORARIA, data.senha_hash)).toBe(true);
  });

  it('e-mail duplicado não chega a gerar hash', async () => {
    const gerarHash = vi.fn();
    const db = { usuario: { findUnique, create }, $transaction };

    await expect(
      cadastrarUsuario(corpoValido({ email: 'gestao.base@sisto.exemplo' }), { id: 3 }, {
        db,
        gerarHash,
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(gerarHash).not.toHaveBeenCalled();
  });
});
