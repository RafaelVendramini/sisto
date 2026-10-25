// Testes de PUT /usuarios/{id} (Issue #13) — edição, bloqueio, desativação e
// reativação de usuários. Somente dados fictícios (RN05).
// Não dependem do banco: src/lib/prisma.js é substituído por um "banco" em
// memória, compartilhado com o login e com o middleware de sessão (o que o
// update grava é o que o POST /auth/login e a verificação do token enxergam).
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';

const { findUnique, findMany, create, update, count, $transaction } = vi.hoisted(() => ({
  findUnique: vi.fn(),
  findMany: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  count: vi.fn(),
  $transaction: vi.fn(),
}));

vi.mock('../src/lib/prisma.js', () => ({
  default: { usuario: { findUnique, findMany, create, update, count }, $transaction },
}));

const { default: app } = await import('../src/app.js');
const { MENSAGEM_PERFIL_SEM_PERMISSAO } = await import('../src/middlewares/autenticacao.js');
const { MENSAGEM_NAO_AUTENTICADO } = await import('../src/services/sessao.js');
const { MENSAGEM_CREDENCIAIS_INVALIDAS } = await import('../src/services/auth.js');
const {
  MENSAGEM_EMAIL_DUPLICADO,
  MENSAGEM_ID_INVALIDO,
  MENSAGEM_USUARIO_NAO_ENCONTRADO,
  MENSAGEM_ALTERAR_PROPRIO_ACESSO,
  MENSAGEM_MINIMO_GESTOES_ATIVAS,
  MENSAGEM_CONFLITO_CONCORRENTE,
  TAMANHO_MAXIMO_NOME,
  atualizarUsuario,
} = await import('../src/services/usuarios.js');
const { gerarHashSenha } = await import('../src/services/senha.js');

const SEGREDO_TESTE = 'segredo-ficticio-de-teste-com-mais-de-32-caracteres';
const SENHA_ALVO = 'SenhaFicticia123';
const PERFIS = ['PROFESSOR', 'TUTOR', 'GESTAO', 'PEDAGOGICO', 'TECNICO_ADMINISTRATIVO'];
const PERFIS_SEM_PERMISSAO = ['PROFESSOR', 'TUTOR', 'PEDAGOGICO', 'TECNICO_ADMINISTRATIVO'];
const ID_GESTAO = 3; // usuário-base GESTAO
const ID_ALVO = 6; // professor fictício que será editado
const EMAIL_ALVO = 'docente.alvo@sisto.exemplo';

let hashAlvo;
let banco;

beforeAll(async () => {
  // Custo baixo só para acelerar os testes; o login compara com qualquer custo.
  hashAlvo = await gerarHashSenha(SENHA_ALVO, 4);
});

function selecionar(registro, select) {
  if (!select) return { ...registro };
  return Object.fromEntries(
    Object.entries(select)
      .filter(([, incluir]) => incluir)
      .map(([campo]) => [campo, registro[campo]]),
  );
}

function erroPrisma(code, mensagem) {
  const erro = new Error(mensagem);
  erro.code = code;
  return erro;
}

function usuarioBase(id, perfil) {
  return {
    id,
    nome: `Usuário ${perfil} Exemplo`,
    email: `${perfil.toLowerCase()}.base@sisto.exemplo`,
    senha_hash: '$2b$04$abcdefghijklmnopqrstuuabcdefghijklmnopqrstuvwxyz01234',
    perfil,
    status: 'ATIVO',
  };
}

function buscar(id) {
  return banco.find((u) => u.id === id);
}

function adicionarGestao(id, status = 'ATIVO') {
  banco.push({ ...usuarioBase(id, 'GESTAO'), email: `gestao.${id}@sisto.exemplo`, status });
}

beforeEach(() => {
  process.env.JWT_SECRET = SEGREDO_TESTE;
  banco = PERFIS.map((perfil, i) => usuarioBase(i + 1, perfil));
  banco.push({
    id: ID_ALVO,
    nome: 'Docente Alvo Ficticio',
    email: EMAIL_ALVO,
    senha_hash: hashAlvo,
    perfil: 'PROFESSOR',
    status: 'ATIVO',
  });

  findUnique.mockReset();
  findUnique.mockImplementation(async ({ where, select }) => {
    const encontrado = banco.find((u) =>
      where.id !== undefined ? u.id === where.id : u.email === where.email,
    );
    return encontrado ? selecionar(encontrado, select) : null;
  });

  update.mockReset();
  update.mockImplementation(async ({ where, data, select }) => {
    const registro = buscar(where.id);
    if (!registro) throw erroPrisma('P2025', 'Record to update not found.');
    if (data.email !== undefined && banco.some((u) => u.email === data.email && u.id !== where.id)) {
      throw erroPrisma('P2002', 'Unique constraint failed on the fields: (`email`)');
    }
    Object.assign(registro, data);
    return selecionar(registro, select);
  });

  count.mockReset();
  count.mockImplementation(
    async ({ where }) =>
      banco.filter(
        (u) =>
          u.perfil === where.perfil && u.status === where.status && u.id !== where.id?.not,
      ).length,
  );

  $transaction.mockReset();
  $transaction.mockImplementation(async (fn) =>
    fn({ usuario: { findUnique, findMany, create, update, count } }),
  );

  findMany.mockReset();
  create.mockReset();
});

afterEach(() => {
  delete process.env.JWT_SECRET;
});

function tokenDe(id) {
  const usuario = buscar(id);
  return jwt.sign({ id, perfil: usuario.perfil }, SEGREDO_TESTE, {
    algorithm: 'HS256',
    expiresIn: '8h',
  });
}

function tokenDoPerfil(perfil) {
  return tokenDe(banco.find((u) => u.perfil === perfil).id);
}

function put(id, corpo, token = tokenDe(ID_GESTAO)) {
  const req = request(app).put(`/usuarios/${id}`);
  if (token) req.set('Authorization', `Bearer ${token}`);
  return req.send(corpo);
}

function login(email = EMAIL_ALVO, senha = SENHA_ALVO) {
  return request(app).post('/auth/login').send({ email, senha });
}

/** Nenhuma resposta pode conter o hash da senha (RNF06). */
function esperarSemHash(res) {
  const texto = JSON.stringify(res.body);
  expect(texto).not.toContain('senha_hash');
  expect(texto).not.toContain('$2b$');
}

function esperarErro(res, status, mensagem) {
  expect(res.status).toBe(status);
  expect(res.headers['content-type']).toMatch(/application\/json/);
  expect(Object.keys(res.body)).toEqual(['erro']);
  if (mensagem instanceof RegExp) expect(res.body.erro).toMatch(mensagem);
  else if (mensagem) expect(res.body.erro).toBe(mensagem);
  else expect(res.body.erro.length).toBeGreaterThan(0);
  esperarSemHash(res);
}

function esperar400(res, mensagem) {
  esperarErro(res, 400, mensagem);
  expect(update).not.toHaveBeenCalled();
}

describe('PUT /usuarios/{id} — edição pela Gestão (200)', () => {
  it('altera somente o nome', async () => {
    const res = await put(ID_ALVO, { nome: '  Docente Renomeado  ' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      id: ID_ALVO,
      nome: 'Docente Renomeado',
      email: EMAIL_ALVO,
      perfil: 'PROFESSOR',
      status: 'ATIVO',
    });
    esperarSemHash(res);
    expect(update).toHaveBeenCalledWith({
      where: { id: ID_ALVO },
      data: { nome: 'Docente Renomeado' },
      select: { id: true, nome: true, email: true, perfil: true, status: true },
    });
  });

  it('altera somente o e-mail, normalizado (trim + minúsculas)', async () => {
    const res = await put(ID_ALVO, { email: '  Novo.Email@SISTO.Exemplo ' });

    expect(res.status).toBe(200);
    expect(res.body.email).toBe('novo.email@sisto.exemplo');
    expect(buscar(ID_ALVO).email).toBe('novo.email@sisto.exemplo');
    esperarSemHash(res);
  });

  it('e-mail alterado passa a ser o login do usuário', async () => {
    await put(ID_ALVO, { email: 'novo.email@sisto.exemplo' });

    expect((await login('novo.email@sisto.exemplo')).status).toBe(200);
    expect((await login(EMAIL_ALVO)).status).toBe(401);
  });

  it.each(PERFIS)('altera somente o perfil para %s', async (perfil) => {
    const res = await put(ID_ALVO, { perfil });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: ID_ALVO, perfil, status: 'ATIVO' });
    esperarSemHash(res);
  });

  it('altera nome, e-mail, perfil e status juntos', async () => {
    const res = await put(ID_ALVO, {
      nome: 'Tutora Ficticia',
      email: 'tutora.ficticia@sisto.exemplo',
      perfil: 'TUTOR',
      status: 'BLOQUEADO',
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      id: ID_ALVO,
      nome: 'Tutora Ficticia',
      email: 'tutora.ficticia@sisto.exemplo',
      perfil: 'TUTOR',
      status: 'BLOQUEADO',
    });
  });

  it('manter o próprio e-mail atual não é conflito', async () => {
    const res = await put(ID_ALVO, { email: EMAIL_ALVO.toUpperCase(), nome: 'Outro Nome' });

    expect(res.status).toBe(200);
    expect(res.body.email).toBe(EMAIL_ALVO);
  });

  it('nova mudança de perfil vale na requisição seguinte (perfil lido do banco)', async () => {
    const tokenAntigo = tokenDe(ID_ALVO); // emitido como PROFESSOR
    expect((await put(ID_ALVO, { perfil: 'GESTAO' })).status).toBe(200);

    // Com o perfil novo (GESTAO), o mesmo token já acessa a rota da Gestão.
    const res = await put(ID_ALVO, { nome: 'Promovido Ficticio' }, tokenAntigo);
    expect(res.status).toBe(200);
  });

  it('campos extras (id, senha, senha_hash) são ignorados; senha não muda', async () => {
    const res = await put(ID_ALVO, {
      nome: 'Docente Editado',
      id: 999,
      senha: 'OutraSenha999',
      senha_hash: '$2b$04$hashqualquerinventadoparatesteaaaaaaaaaaaaaaaaaaaaaa',
      confirmarSenha: 'OutraSenha999',
    });

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(ID_ALVO);
    expect(update.mock.calls[0][0].data).toEqual({ nome: 'Docente Editado' });
    expect(buscar(ID_ALVO).senha_hash).toBe(hashAlvo);
    expect((await login(EMAIL_ALVO, SENHA_ALVO)).status).toBe(200);
    expect((await login(EMAIL_ALVO, 'OutraSenha999')).status).toBe(401);
  });

  it('usa transação SERIALIZABLE', async () => {
    await put(ID_ALVO, { nome: 'Docente Editado' });

    expect($transaction).toHaveBeenCalledTimes(1);
    expect($transaction.mock.calls[0][1]).toEqual({ isolationLevel: 'Serializable' });
  });
});

describe.each([
  ['BLOQUEADO', 'bloqueio'],
  ['DESATIVADO', 'desativação'],
])('PUT /usuarios/{id} — status %s (RF04, RN07, RN09)', (status, acao) => {
  it(`fluxo: login OK → ${acao} → login 401 e token anterior 401 → reativação → login OK`, async () => {
    // 1. O usuário autentica e acessa uma rota protegida (rota inexistente
    //    responde 404 com token válido: passou pela autenticação).
    const login1 = await login();
    expect(login1.status).toBe(200);
    const tokenAnterior = login1.body.token;
    const antes = await request(app)
      .get('/rota-protegida-ficticia')
      .set('Authorization', `Bearer ${tokenAnterior}`);
    expect(antes.status).toBe(404);

    // 2. A Gestão muda o status.
    const bloqueio = await put(ID_ALVO, { status });
    expect(bloqueio.status).toBe(200);
    expect(bloqueio.body).toEqual({
      id: ID_ALVO,
      nome: 'Docente Alvo Ficticio',
      email: EMAIL_ALVO,
      perfil: 'PROFESSOR',
      status,
    });
    esperarSemHash(bloqueio);

    // 3. O login falha com a mensagem genérica e o token anterior perde o acesso.
    const login2 = await login();
    expect(login2.status).toBe(401);
    expect(login2.body).toEqual({ erro: MENSAGEM_CREDENCIAIS_INVALIDAS });
    const depois = await request(app)
      .get('/rota-protegida-ficticia')
      .set('Authorization', `Bearer ${tokenAnterior}`);
    expect(depois.status).toBe(401);
    expect(depois.body).toEqual({ erro: MENSAGEM_NAO_AUTENTICADO });

    // 4. O registro continua existindo (nunca é excluído).
    expect(buscar(ID_ALVO)).toMatchObject({ id: ID_ALVO, email: EMAIL_ALVO, status });
    expect(banco).toHaveLength(PERFIS.length + 1);

    // 5. A Gestão reativa e o usuário volta a autenticar.
    const reativacao = await put(ID_ALVO, { status: 'ATIVO' });
    expect(reativacao.status).toBe(200);
    expect(reativacao.body.status).toBe('ATIVO');
    const login3 = await login();
    expect(login3.status).toBe(200);
    const comNovoToken = await request(app)
      .get('/rota-protegida-ficticia')
      .set('Authorization', `Bearer ${login3.body.token}`);
    expect(comNovoToken.status).toBe(404);
  });

  it(`usuário com status ${status} pode ser editado (nome) sem mudar o status`, async () => {
    buscar(ID_ALVO).status = status;
    const res = await put(ID_ALVO, { nome: 'Nome Corrigido' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe(status);
  });
});

describe('PUT /usuarios/{id} — não há exclusão (RN07)', () => {
  it('DELETE /usuarios/{id} não existe: 404 de rota e o registro permanece', async () => {
    const res = await request(app)
      .delete(`/usuarios/${ID_ALVO}`)
      .set('Authorization', `Bearer ${tokenDe(ID_GESTAO)}`);

    expect(res.status).toBe(404);
    expect(buscar(ID_ALVO)).toBeDefined();
  });
});

describe('PUT /usuarios/{id} — validações (400)', () => {
  it.each([['ativo'], ['bloqueado'], ['Ativo'], ['EXCLUIDO'], ['INATIVO'], [' ATIVO'], [''], [1], [0], [true], [null], [['ATIVO']]])(
    'status inválido %j',
    async (status) => {
      const res = await put(ID_ALVO, { status });

      esperar400(res, /^Status inválido\. Valores aceitos: ATIVO, BLOQUEADO, DESATIVADO\.$/);
      expect(buscar(ID_ALVO).status).toBe('ATIVO');
    },
  );

  it.each(['ADMIN', 'gestao', 'Gestão', 'Professor', ' GESTAO', '', null, 3])(
    'perfil inválido %j',
    async (perfil) => {
      esperar400(await put(ID_ALVO, { perfil }), /^Perfil inválido/);
    },
  );

  it.each([
    'sem-arroba.sisto.exemplo',
    'docente@',
    '@sisto.exemplo',
    'docente@sisto',
    'docente@@sisto.exemplo',
    'doc ente@sisto.exemplo',
  ])('e-mail inválido %j', async (email) => {
    const res = await put(ID_ALVO, { email });

    esperar400(res, 'Informe um e-mail em formato válido.');
    expect(res.body.erro).not.toContain(email);
  });

  it('e-mail com mais de 254 caracteres', async () => {
    esperar400(await put(ID_ALVO, { email: `${'a'.repeat(250)}@sisto.exemplo` }));
  });

  it.each([[''], ['   '], [null], [42]])('e-mail vazio/não texto %j', async (email) => {
    esperar400(await put(ID_ALVO, { email }), 'Informe email (texto não vazio).');
  });

  it.each([[''], ['   '], [null], [123]])('nome vazio/não texto %j', async (nome) => {
    esperar400(await put(ID_ALVO, { nome }), 'Informe nome (texto não vazio).');
  });

  it(`nome com mais de ${TAMANHO_MAXIMO_NOME} caracteres`, async () => {
    esperar400(await put(ID_ALVO, { nome: 'N'.repeat(TAMANHO_MAXIMO_NOME + 1) }));
  });

  it('um campo inválido barra a edição inteira (nada é gravado)', async () => {
    esperar400(await put(ID_ALVO, { nome: 'Nome Valido', status: 'excluido' }));
    expect(buscar(ID_ALVO).nome).toBe('Docente Alvo Ficticio');
  });

  it.each([
    ['corpo vazio', {}],
    ['só campos ignorados', { senha: 'OutraSenha999', id: 1 }],
  ])('%s', async (_caso, corpo) => {
    esperar400(
      await put(ID_ALVO, corpo),
      'Informe ao menos um dos campos: nome, email, perfil, status.',
    );
  });

  it('sem corpo', async () => {
    const res = await request(app)
      .put(`/usuarios/${ID_ALVO}`)
      .set('Authorization', `Bearer ${tokenDe(ID_GESTAO)}`);

    esperar400(res);
  });

  it('corpo em lista (array)', async () => {
    esperar400(await put(ID_ALVO, [{ nome: 'X' }]));
  });

  it('JSON malformado', async () => {
    const res = await request(app)
      .put(`/usuarios/${ID_ALVO}`)
      .set('Authorization', `Bearer ${tokenDe(ID_GESTAO)}`)
      .set('Content-Type', 'application/json')
      .send('{"nome":');

    esperar400(res, 'JSON inválido no corpo da requisição');
  });

  it.each(['abc', '0', '-1', '1.5', '01', '1e3', '0x10', '%20', '2147483648', '99999999999'])(
    'id inválido %j',
    async (id) => {
      const res = await put(id, { nome: 'Qualquer Nome' });

      esperar400(res, MENSAGEM_ID_INVALIDO);
      expect($transaction).not.toHaveBeenCalled();
    },
  );
});

describe('PUT /usuarios/{id} — inexistente (404)', () => {
  it('id inexistente', async () => {
    const res = await put(9999, { nome: 'Qualquer Nome' });

    esperarErro(res, 404, MENSAGEM_USUARIO_NAO_ENCONTRADO);
    expect(update).not.toHaveBeenCalled();
  });

  it('maior id aceito (2147483647) inexistente: 404', async () => {
    esperarErro(await put(2147483647, { nome: 'Qualquer Nome' }), 404);
  });

  it('P2025 do Prisma no update vira 404', async () => {
    update.mockImplementationOnce(async () => {
      throw erroPrisma('P2025', 'Record to update not found.');
    });

    esperarErro(await put(ID_ALVO, { nome: 'Qualquer Nome' }), 404, MENSAGEM_USUARIO_NAO_ENCONTRADO);
  });
});

describe('PUT /usuarios/{id} — e-mail duplicado (409)', () => {
  it('pré-checagem: e-mail de outro usuário (após normalizar)', async () => {
    const res = await put(ID_ALVO, { email: ' TUTOR.base@sisto.exemplo ' });

    esperarErro(res, 409, MENSAGEM_EMAIL_DUPLICADO);
    expect(update).not.toHaveBeenCalled();
    expect(buscar(ID_ALVO).email).toBe(EMAIL_ALVO);
  });

  it('corrida: P2002 do Prisma no update vira 409, não 500', async () => {
    // A pré-checagem não encontra o e-mail (outra operação ainda não gravou)...
    findUnique.mockImplementation(async ({ where, select }) => {
      if (where.email !== undefined) return null;
      const u = buscar(where.id);
      return u ? selecionar(u, select) : null;
    });
    // ...mas o banco recusa no update.
    update.mockImplementationOnce(async () => {
      throw erroPrisma('P2002', 'Unique constraint failed on the fields: (`email`)');
    });

    esperarErro(await put(ID_ALVO, { email: 'outro@sisto.exemplo' }), 409, MENSAGEM_EMAIL_DUPLICADO);
  });

  it('outro erro do banco: 500 genérico', async () => {
    update.mockImplementationOnce(async () => {
      throw new Error('falha fictícia de conexão');
    });

    const res = await put(ID_ALVO, { nome: 'Qualquer Nome' });
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ erro: 'Erro interno do servidor' });
  });
});

describe('PUT /usuarios/{id} — ao menos duas Gestões ativas (RN11, 409)', () => {
  it.each([
    ['bloquear a si mesma', { status: 'BLOQUEADO' }],
    ['desativar a si mesma', { status: 'DESATIVADO' }],
    ['rebaixar o próprio perfil', { perfil: 'PROFESSOR' }],
    ['rebaixar e bloquear a si mesma', { perfil: 'TUTOR', status: 'BLOQUEADO' }],
  ])('Gestão tentando %s: 409, mesmo havendo outras duas Gestões ativas', async (_caso, corpo) => {
    adicionarGestao(7);
    adicionarGestao(8);
    const res = await put(ID_GESTAO, corpo);

    esperarErro(res, 409, MENSAGEM_ALTERAR_PROPRIO_ACESSO);
    expect(update).not.toHaveBeenCalled();
    expect(buscar(ID_GESTAO)).toMatchObject({ perfil: 'GESTAO', status: 'ATIVO' });
  });

  // QA #37: a recusa da própria alteração vale também com exatamente duas
  // Gestões ativas e com uma só (estado logo após a instalação), sempre com a
  // mensagem do próprio acesso — não a do mínimo de duas Gestões.
  it.each([
    ['uma só Gestão ativa (a própria)', []],
    ['exatamente duas Gestões ativas', [7]],
  ])('com %s, a Gestão tentando bloquear/desativar/rebaixar a si mesma: 409', async (_caso, extras) => {
    extras.forEach((id) => adicionarGestao(id));
    for (const corpo of [{ status: 'BLOQUEADO' }, { status: 'DESATIVADO' }, { perfil: 'PEDAGOGICO' }]) {
      const res = await put(ID_GESTAO, corpo);
      esperarErro(res, 409, MENSAGEM_ALTERAR_PROPRIO_ACESSO);
    }
    expect(update).not.toHaveBeenCalled();
    expect(buscar(ID_GESTAO)).toMatchObject({ perfil: 'GESTAO', status: 'ATIVO' });
  });

  it('Gestão edita o próprio nome e e-mail: 200', async () => {
    const res = await put(ID_GESTAO, {
      nome: 'Gestora Renomeada',
      email: 'gestora.nova@sisto.exemplo',
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      id: ID_GESTAO,
      nome: 'Gestora Renomeada',
      email: 'gestora.nova@sisto.exemplo',
      perfil: 'GESTAO',
      status: 'ATIVO',
    });
  });

  it('Gestão reenviando o próprio perfil GESTAO e status ATIVO (sem mudança): 200', async () => {
    const res = await put(ID_GESTAO, { perfil: 'GESTAO', status: 'ATIVO' });

    expect(res.status).toBe(200);
  });

  const ACOES_QUE_TIRAM_GESTAO_ATIVA = [
    ['bloquear', { status: 'BLOQUEADO' }],
    ['desativar', { status: 'DESATIVADO' }],
    ['rebaixar', { perfil: 'PEDAGOGICO' }],
    ['rebaixar e bloquear', { perfil: 'PROFESSOR', status: 'BLOQUEADO' }],
  ];

  it.each(ACOES_QUE_TIRAM_GESTAO_ATIVA)(
    'com exatamente duas Gestões ativas, %s a outra: 409 e nada é gravado',
    async (_caso, corpo) => {
      adicionarGestao(7); // Gestões ativas: 3 (solicitante) e 7
      const res = await put(7, corpo);

      esperarErro(res, 409, MENSAGEM_MINIMO_GESTOES_ATIVAS);
      expect(update).not.toHaveBeenCalled();
      expect(buscar(7)).toMatchObject({ perfil: 'GESTAO', status: 'ATIVO' });
      expect(count).toHaveBeenCalledWith({
        where: { perfil: 'GESTAO', status: 'ATIVO', id: { not: 7 } },
      });
    },
  );

  it.each(ACOES_QUE_TIRAM_GESTAO_ATIVA)(
    'com três Gestões ativas, %s uma delas: 200',
    async (_caso, corpo) => {
      adicionarGestao(7);
      adicionarGestao(8); // Gestões ativas: 3, 7 e 8
      const res = await put(7, corpo);

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ id: 7, ...corpo });
      expect(buscar(7)).toMatchObject(corpo);
    },
  );

  it.each(['BLOQUEADO', 'DESATIVADO'])(
    'Gestão com status %s não conta: duas ativas + uma inativa, bloquear uma ativa: 409',
    async (statusInativo) => {
      adicionarGestao(7);
      adicionarGestao(8, statusInativo);
      const res = await put(7, { status: 'BLOQUEADO' });

      esperarErro(res, 409, MENSAGEM_MINIMO_GESTOES_ATIVAS);
      expect(update).not.toHaveBeenCalled();
    },
  );

  it('com três Gestões ativas: a primeira retirada passa (200) e a segunda é recusada (409)', async () => {
    adicionarGestao(7);
    adicionarGestao(8);

    expect((await put(7, { status: 'BLOQUEADO' })).status).toBe(200);
    const res = await put(8, { status: 'DESATIVADO' });

    esperarErro(res, 409, MENSAGEM_MINIMO_GESTOES_ATIVAS);
    expect(buscar(8)).toMatchObject({ perfil: 'GESTAO', status: 'ATIVO' });
  });

  it('reativar uma Gestão volta a permitir a retirada de outra', async () => {
    adicionarGestao(7);
    adicionarGestao(8, 'BLOQUEADO');
    expect((await put(7, { status: 'BLOQUEADO' })).status).toBe(409);

    expect((await put(8, { status: 'ATIVO' })).status).toBe(200);
    expect((await put(7, { status: 'BLOQUEADO' })).status).toBe(200);
  });

  it('a mensagem do 409 explica a regra dos dois usuários Gestão e pede o cadastro de outro', () => {
    expect(MENSAGEM_MINIMO_GESTOES_ATIVAS).toMatch(/ao menos dois usuários Gestão ativos/);
    expect(MENSAGEM_MINIMO_GESTOES_ATIVAS).toMatch(/Cadastre ou reative outro usuário Gestão/);
  });

  it('editar só o nome de uma Gestão, com duas Gestões ativas: 200 (não reduz Gestões ativas)', async () => {
    adicionarGestao(7);
    const res = await put(7, { nome: 'Gestora Renomeada Ficticia' });

    expect(res.status).toBe(200);
    expect(count).not.toHaveBeenCalled();
  });

  it('depois disso, rebaixar a outra Gestão já bloqueada não consulta a regra: 200', async () => {
    adicionarGestao(7, 'BLOQUEADO');
    const res = await put(7, { perfil: 'PROFESSOR' });

    expect(res.status).toBe(200);
    expect(count).not.toHaveBeenCalled();
  });

  it('reativar uma Gestão bloqueada: 200', async () => {
    adicionarGestao(7, 'BLOQUEADO');
    const res = await put(7, { status: 'ATIVO' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ATIVO');
  });

  it('promover outro usuário a Gestão: 200 (não reduz Gestões ativas)', async () => {
    const res = await put(ID_ALVO, { perfil: 'GESTAO' });

    expect(res.status).toBe(200);
    expect(count).not.toHaveBeenCalled();
  });
});

describe('PUT /usuarios/{id} — concorrência (transação serializável)', () => {
  it('conflito de serialização (P2034) é repetido e depois respeita a regra', async () => {
    adicionarGestao(7);
    adicionarGestao(8); // Gestões ativas: 3, 7 e 8
    // 1ª tentativa: o PostgreSQL aborta a transação (outra edição concorrente
    // bloqueou a Gestão 8 nesse meio-tempo). Na repetição, além da 7 só resta
    // a Gestão 3 ativa: menos de duas outras, 409.
    $transaction.mockImplementationOnce(async () => {
      buscar(8).status = 'BLOQUEADO';
      throw erroPrisma('P2034', 'Transaction failed due to a write conflict or a deadlock.');
    });

    await expect(
      atualizarUsuario('7', { status: 'BLOQUEADO' }, { id: ID_GESTAO, perfil: 'GESTAO' }),
    ).rejects.toMatchObject({ status: 409, message: MENSAGEM_MINIMO_GESTOES_ATIVAS });
    expect($transaction).toHaveBeenCalledTimes(2);
    expect(buscar(7).status).toBe('ATIVO');
  });

  it('P2034 seguido de sucesso: 200 na segunda tentativa', async () => {
    $transaction.mockImplementationOnce(async () => {
      throw erroPrisma('P2034', 'Transaction failed due to a write conflict or a deadlock.');
    });

    const res = await put(ID_ALVO, { nome: 'Docente Editado' });
    expect(res.status).toBe(200);
    expect($transaction).toHaveBeenCalledTimes(2);
  });

  it('P2034 em todas as tentativas: 409 pedindo nova tentativa', async () => {
    $transaction.mockImplementation(async () => {
      throw erroPrisma('P2034', 'Transaction failed due to a write conflict or a deadlock.');
    });

    esperarErro(await put(ID_ALVO, { nome: 'Docente Editado' }), 409, MENSAGEM_CONFLITO_CONCORRENTE);
    expect($transaction).toHaveBeenCalledTimes(3);
  });
});

describe('PUT /usuarios/{id} — permissões (RN01, Seção 4)', () => {
  it.each(PERFIS_SEM_PERMISSAO)('%s recebe 403', async (perfil) => {
    const res = await put(ID_ALVO, { status: 'BLOQUEADO' }, tokenDoPerfil(perfil));

    esperarErro(res, 403, MENSAGEM_PERFIL_SEM_PERMISSAO);
    expect($transaction).not.toHaveBeenCalled();
    expect(buscar(ID_ALVO).status).toBe('ATIVO');
  });

  it.each(PERFIS_SEM_PERMISSAO)('%s recebe 403 até para editar a si mesmo', async (perfil) => {
    const usuario = banco.find((u) => u.perfil === perfil);
    const res = await put(usuario.id, { nome: 'Auto Edicao' }, tokenDe(usuario.id));

    expect(res.status).toBe(403);
  });

  it('403 vem antes da validação do id e do corpo', async () => {
    const res = await put('abc', {}, tokenDoPerfil('PROFESSOR'));

    expect(res.status).toBe(403);
  });

  it('sem token: 401', async () => {
    const res = await put(ID_ALVO, { status: 'BLOQUEADO' }, null);

    esperarErro(res, 401, MENSAGEM_NAO_AUTENTICADO);
    expect(res.headers['www-authenticate']).toBe('Bearer');
    expect($transaction).not.toHaveBeenCalled();
  });

  it('Gestão bloqueada (por outra Gestão) perde o acesso ao PUT na hora: 401', async () => {
    adicionarGestao(7);
    adicionarGestao(8); // três Gestões ativas: o bloqueio da 7 é permitido (RN11)
    const tokenGestao7 = tokenDe(7);
    expect((await put(7, { status: 'BLOQUEADO' })).status).toBe(200);

    const res = await put(ID_ALVO, { nome: 'Qualquer Nome' }, tokenGestao7);
    expect(res.status).toBe(401);
  });
});
