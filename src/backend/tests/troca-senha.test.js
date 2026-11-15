// Testes da recuperação de acesso (Issue #18 — RF03, RN09, RN10, RN11, RN12,
// RNF03, RNF04, RNF06): PUT /usuarios/{id}/senha, PUT /conta/senha,
// trocaSenhaObrigatoria no login, bloqueio 403 com troca pendente e
// invalidação de tokens anteriores à troca. Somente dados fictícios (RN05).
// Não dependem do banco: src/lib/prisma.js é substituído por um "banco" em
// memória, compartilhado com o login, o middleware de sessão e os services
// (o que a troca grava é o que o login e a verificação do token enxergam).
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { CODIGOS_ERRO } from '../src/lib/erros.js';

const { findUnique, findMany, create, update, count, $transaction, criarLog } = vi.hoisted(
  () => ({
    findUnique: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    count: vi.fn(),
    $transaction: vi.fn(),
    criarLog: vi.fn(),
  }),
);

vi.mock('../src/lib/prisma.js', () => ({
  default: {
    usuario: { findUnique, findMany, create, update, count },
    logAuditoria: { create: criarLog },
    $transaction,
  },
}));

// Custo bcrypt baixo só para acelerar os testes (a política de senha é a real).
vi.mock('../src/services/senha.js', async (importOriginal) => {
  const original = await importOriginal();
  return { ...original, gerarHashSenha: (senha) => original.gerarHashSenha(senha, 4) };
});

const { default: app } = await import('../src/app.js');
const { MENSAGEM_PERFIL_SEM_PERMISSAO, MENSAGEM_TROCA_SENHA_OBRIGATORIA } = await import(
  '../src/middlewares/autenticacao.js'
);
const { MENSAGEM_NAO_AUTENTICADO } = await import('../src/services/sessao.js');
const {
  MENSAGEM_CREDENCIAIS_INVALIDAS,
  LIMITE_AJUSTE_IAT_MS,
  calcularIatToken,
  tokenEmitidoAposTrocaDeSenha,
} = await import('../src/services/auth.js');
const { MENSAGEM_ID_INVALIDO, MENSAGEM_USUARIO_NAO_ENCONTRADO } = await import(
  '../src/services/usuarios.js'
);
const {
  MENSAGEM_REDEFINIR_PROPRIA_SENHA,
  MENSAGEM_SENHA_ATUAL_INCORRETA,
  MENSAGEM_NOVA_SENHA_IGUAL_ATUAL,
  MENSAGEM_CONFLITO_TROCA_SENHA,
  proximaSenhaAlteradaEm,
} = await import('../src/services/troca-senha.js');
const { ACOES_AUDITORIA } = await import('../src/services/auditoria.js');
const { gerarHashSenha } = await import('../src/services/senha.js');
const { CHAVE_LIMITADORES, criarLimitadoresTentativas } = await import(
  '../src/middlewares/limite-tentativas.js'
);

const SEGREDO_TESTE = 'segredo-ficticio-de-teste-com-mais-de-32-caracteres';
const SENHA_INICIAL = 'SenhaInicialFicticia1';
const SENHA_TEMPORARIA = 'Temporaria#2026';
const SENHA_NOVA = 'NovaSenhaFicticia9';

const PERFIS = ['PROFESSOR', 'TUTOR', 'GESTAO', 'PEDAGOGICO', 'TECNICO_ADMINISTRATIVO'];
const PERFIS_SEM_PERMISSAO = ['PROFESSOR', 'TUTOR', 'PEDAGOGICO', 'TECNICO_ADMINISTRATIVO'];
const ID_GESTAO = 3;
const ID_ALVO = 6; // professor fictício
const ID_GESTAO_ALVO = 7; // segunda Gestão, para provar que até rotas permitidas ficam bloqueadas
const ID_BLOQUEADO = 8;
const ID_DESATIVADO = 9;

let hashInicial;
let banco;

beforeAll(async () => {
  hashInicial = await gerarHashSenha(SENHA_INICIAL);
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

function novoUsuario(id, perfil, email, status = 'ATIVO') {
  return {
    id,
    nome: `Usuário Fictício ${id}`,
    email,
    senha_hash: hashInicial,
    perfil,
    status,
    troca_senha_obrigatoria: false,
    senha_alterada_em: null,
  };
}

function buscar(id) {
  return banco.find((u) => u.id === id);
}

beforeEach(() => {
  process.env.JWT_SECRET = SEGREDO_TESTE;
  // Contadores do limite de tentativas (#90) zerados a cada teste: aqui vários
  // testes erram a senha do mesmo usuário (o limite tem testes próprios).
  app.locals[CHAVE_LIMITADORES] = criarLimitadoresTentativas();
  banco = PERFIS.map((perfil, i) =>
    novoUsuario(i + 1, perfil, `${perfil.toLowerCase()}.base@sisto.exemplo`),
  );
  banco.push(
    novoUsuario(ID_ALVO, 'PROFESSOR', 'docente.alvo@sisto.exemplo'),
    novoUsuario(ID_GESTAO_ALVO, 'GESTAO', 'gestao.alvo@sisto.exemplo'),
    novoUsuario(ID_BLOQUEADO, 'TUTOR', 'tutor.bloqueado@sisto.exemplo', 'BLOQUEADO'),
    novoUsuario(ID_DESATIVADO, 'PEDAGOGICO', 'pedagogico.desativado@sisto.exemplo', 'DESATIVADO'),
  );

  findUnique.mockReset();
  findUnique.mockImplementation(async ({ where, select }) => {
    const encontrado = banco.find((u) =>
      where.id !== undefined ? u.id === where.id : u.email === where.email,
    );
    return encontrado ? selecionar(encontrado, select) : null;
  });

  findMany.mockReset();
  findMany.mockImplementation(async ({ select }) => banco.map((u) => selecionar(u, select)));

  update.mockReset();
  update.mockImplementation(async ({ where, data, select }) => {
    const registro = buscar(where.id);
    if (!registro) throw erroPrisma('P2025', 'Record to update not found.');
    Object.assign(registro, data);
    return selecionar(registro, select);
  });

  criarLog.mockReset();
  criarLog.mockImplementation(async ({ data }) => ({ id: criarLog.mock.calls.length, ...data }));

  $transaction.mockReset();
  $transaction.mockImplementation(async (fn) =>
    fn({ usuario: { findUnique, findMany, create, update, count }, logAuditoria: { create: criarLog } }),
  );

  create.mockReset();
  count.mockReset();
});

afterEach(() => {
  delete process.env.JWT_SECRET;
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Auxiliares HTTP
// ---------------------------------------------------------------------------

function login(email, senha) {
  return request(app).post('/auth/login').send({ email, senha });
}

async function tokenPorLogin(id, senha = SENHA_INICIAL) {
  const res = await login(buscar(id).email, senha);
  expect(res.status).toBe(200);
  return res.body.token;
}

function redefinir(id, corpo, token) {
  const req = request(app).put(`/usuarios/${id}/senha`);
  if (token) req.set('Authorization', `Bearer ${token}`);
  return req.send(corpo);
}

function trocar(corpo, token) {
  const req = request(app).put('/conta/senha');
  if (token) req.set('Authorization', `Bearer ${token}`);
  return req.send(corpo);
}

function get(caminho, token) {
  return request(app).get(caminho).set('Authorization', `Bearer ${token}`);
}

/** Token com iat controlado (como o do login, HS256, 8h). */
function tokenComIat(id, iat) {
  const { perfil } = buscar(id);
  return jwt.sign({ id, perfil, iat }, SEGREDO_TESTE, { algorithm: 'HS256', expiresIn: '8h' });
}

function esperarSemSenha(res, ...senhas) {
  for (const senha of senhas) expect(res.text).not.toContain(senha);
  expect(res.text).not.toMatch(/senha_hash|\$2[aby]\$/);
}

// ---------------------------------------------------------------------------
// PUT /usuarios/{id}/senha — redefinição pela Gestão
// ---------------------------------------------------------------------------

describe('PUT /usuarios/{id}/senha — sucesso', () => {
  it('a Gestão redefine a senha de outro usuário: 204, hash bcrypt, troca obrigatória e senha_alterada_em', async () => {
    const tokenGestao = await tokenPorLogin(ID_GESTAO);
    const antes = Date.now();

    const res = await redefinir(ID_ALVO, { novaSenha: SENHA_TEMPORARIA }, tokenGestao);

    expect(res.status).toBe(204);
    expect(res.text).toBe('');
    const alvo = buscar(ID_ALVO);
    expect(alvo.senha_hash).not.toBe(SENHA_TEMPORARIA);
    expect(alvo.senha_hash).toMatch(/^\$2[aby]\$/);
    expect(await bcrypt.compare(SENHA_TEMPORARIA, alvo.senha_hash)).toBe(true);
    expect(alvo.troca_senha_obrigatoria).toBe(true);
    expect(alvo.senha_alterada_em).toBeInstanceOf(Date);
    expect(alvo.senha_alterada_em.getTime()).toBeGreaterThanOrEqual(antes);
    // O status não muda.
    expect(alvo.status).toBe('ATIVO');
  });

  it('grava "senha redefinida pela Gestão" no LogAuditoria, na mesma transação e sem a senha', async () => {
    const tokenGestao = await tokenPorLogin(ID_GESTAO);

    await redefinir(ID_ALVO, { novaSenha: SENHA_TEMPORARIA }, tokenGestao);

    expect($transaction).toHaveBeenCalledTimes(1);
    expect(criarLog).toHaveBeenCalledTimes(1);
    const { data } = criarLog.mock.calls[0][0];
    expect(data).toEqual({
      usuario_id: ID_GESTAO,
      acao: ACOES_AUDITORIA.SENHA_REDEFINIDA_PELA_GESTAO,
      recurso: `usuarios/${ID_ALVO}`,
    });
    expect(data.acao).toBe('senha redefinida pela Gestão');
    expect(JSON.stringify(data)).not.toContain(SENHA_TEMPORARIA);
    expect(JSON.stringify(data)).not.toMatch(/\$2[aby]\$/);
  });

  it('a Gestão pode redefinir a senha de outro usuário da Gestão', async () => {
    const tokenGestao = await tokenPorLogin(ID_GESTAO);

    const res = await redefinir(ID_GESTAO_ALVO, { novaSenha: SENHA_TEMPORARIA }, tokenGestao);

    expect(res.status).toBe(204);
    expect(buscar(ID_GESTAO_ALVO).troca_senha_obrigatoria).toBe(true);
  });

  it('a regra "nova senha diferente da atual" não se aplica à redefinição pela Gestão', async () => {
    const tokenGestao = await tokenPorLogin(ID_GESTAO);

    const res = await redefinir(ID_ALVO, { novaSenha: SENHA_INICIAL }, tokenGestao);

    expect(res.status).toBe(204);
  });

  it('campos extras do corpo são ignorados (não mudam status, perfil nem a flag)', async () => {
    const tokenGestao = await tokenPorLogin(ID_GESTAO);

    const res = await redefinir(
      ID_ALVO,
      { novaSenha: SENHA_TEMPORARIA, status: 'DESATIVADO', perfil: 'GESTAO', troca_senha_obrigatoria: false },
      tokenGestao,
    );

    expect(res.status).toBe(204);
    const alvo = buscar(ID_ALVO);
    expect(alvo).toMatchObject({ status: 'ATIVO', perfil: 'PROFESSOR', troca_senha_obrigatoria: true });
  });
});

describe('PUT /usuarios/{id}/senha — validações e permissões', () => {
  it.each([
    ['menos de 8 caracteres', { novaSenha: 'Curta12' }, 'A senha deve ter no mínimo 8 caracteres.'],
    ['acima de 72 bytes', { novaSenha: 'á'.repeat(37) }, /no máximo 72 bytes/],
    ['novaSenha ausente', {}, 'Informe novaSenha (texto não vazio).'],
    ['novaSenha vazia', { novaSenha: '' }, 'Informe novaSenha (texto não vazio).'],
    ['novaSenha não texto', { novaSenha: 12345678 }, 'Informe novaSenha (texto não vazio).'],
    ['corpo em lista', [SENHA_TEMPORARIA], 'Envie um objeto JSON com novaSenha.'],
  ])('%s: 400 com mensagem clara, sem alterar nada', async (_caso, corpo, mensagem) => {
    const tokenGestao = await tokenPorLogin(ID_GESTAO);

    const res = await redefinir(ID_ALVO, corpo, tokenGestao);

    expect(res.status).toBe(400);
    if (typeof mensagem === 'string') expect(res.body).toEqual({ erro: mensagem });
    else expect(res.body.erro).toMatch(mensagem);
    expect(update).not.toHaveBeenCalled();
    expect(criarLog).not.toHaveBeenCalled();
    expect(buscar(ID_ALVO).troca_senha_obrigatoria).toBe(false);
  });

  it('redefinir a própria senha: 409 (padrão RN11), sem alterar nada', async () => {
    const tokenGestao = await tokenPorLogin(ID_GESTAO);

    const res = await redefinir(ID_GESTAO, { novaSenha: SENHA_TEMPORARIA }, tokenGestao);

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ erro: MENSAGEM_REDEFINIR_PROPRIA_SENHA, codigo: CODIGOS_ERRO.REDEFINIR_PROPRIA_SENHA });
    expect(update).not.toHaveBeenCalled();
    expect(criarLog).not.toHaveBeenCalled();
  });

  it.each(PERFIS_SEM_PERMISSAO)('perfil %s: 403, sem alterar nada', async (perfil) => {
    const id = PERFIS.indexOf(perfil) + 1;
    const token = await tokenPorLogin(id);

    const res = await redefinir(ID_ALVO, { novaSenha: SENHA_TEMPORARIA }, token);

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ erro: MENSAGEM_PERFIL_SEM_PERMISSAO });
    expect(update).not.toHaveBeenCalled();
  });

  it('usuário inexistente: 404', async () => {
    const tokenGestao = await tokenPorLogin(ID_GESTAO);

    const res = await redefinir(999, { novaSenha: SENHA_TEMPORARIA }, tokenGestao);

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ erro: MENSAGEM_USUARIO_NAO_ENCONTRADO });
    expect(criarLog).not.toHaveBeenCalled();
  });

  it.each(['abc', '0', '-1', '1.5', '99999999999'])('id inválido (%s): 400', async (id) => {
    const tokenGestao = await tokenPorLogin(ID_GESTAO);

    const res = await redefinir(id, { novaSenha: SENHA_TEMPORARIA }, tokenGestao);

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ erro: MENSAGEM_ID_INVALIDO });
  });

  it('sem token: 401', async () => {
    const res = await redefinir(ID_ALVO, { novaSenha: SENHA_TEMPORARIA });

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ erro: MENSAGEM_NAO_AUTENTICADO });
  });

  it('respostas de erro nunca contêm a senha enviada', async () => {
    const tokenGestao = await tokenPorLogin(ID_GESTAO);

    const res = await redefinir(ID_GESTAO, { novaSenha: SENHA_TEMPORARIA }, tokenGestao);

    esperarSemSenha(res, SENHA_TEMPORARIA);
  });
});

describe('Depois da redefinição pela Gestão (RN10)', () => {
  it('a senha antiga falha, a nova funciona e o login devolve trocaSenhaObrigatoria: true', async () => {
    const tokenGestao = await tokenPorLogin(ID_GESTAO);
    await redefinir(ID_ALVO, { novaSenha: SENHA_TEMPORARIA }, tokenGestao);

    const antiga = await login('docente.alvo@sisto.exemplo', SENHA_INICIAL);
    expect(antiga.status).toBe(401);
    expect(antiga.body).toEqual({ erro: MENSAGEM_CREDENCIAIS_INVALIDAS });

    const nova = await login('docente.alvo@sisto.exemplo', SENHA_TEMPORARIA);
    expect(nova.status).toBe(200);
    expect(nova.body).toEqual({
      token: expect.any(String),
      usuario: { id: ID_ALVO, nome: expect.any(String), perfil: 'PROFESSOR' },
      trocaSenhaObrigatoria: true,
    });
  });

  it('login sem troca pendente devolve trocaSenhaObrigatoria: false', async () => {
    const res = await login('docente.alvo@sisto.exemplo', SENHA_INICIAL);

    expect(res.status).toBe(200);
    expect(res.body.trocaSenhaObrigatoria).toBe(false);
  });

  it('com a troca pendente, as rotas protegidas respondem 403 com mensagem clara', async () => {
    const tokenGestao = await tokenPorLogin(ID_GESTAO);
    await redefinir(ID_GESTAO_ALVO, { novaSenha: SENHA_TEMPORARIA }, tokenGestao);
    const tokenPendente = await tokenPorLogin(ID_GESTAO_ALVO, SENHA_TEMPORARIA);

    // Rotas que a Gestão normalmente pode usar ficam bloqueadas.
    const respostas = [
      await get('/usuarios', tokenPendente),
      await request(app)
        .put(`/usuarios/${ID_ALVO}`)
        .set('Authorization', `Bearer ${tokenPendente}`)
        .send({ nome: 'Nome Ficticio' }),
      await redefinir(ID_ALVO, { novaSenha: SENHA_TEMPORARIA }, tokenPendente),
      await get('/rota-inexistente', tokenPendente),
      await get('/conta/senha', tokenPendente), // outro método em /conta/senha
    ];
    for (const res of respostas) {
      expect(res.status).toBe(403);
      expect(res.body).toEqual({ erro: MENSAGEM_TROCA_SENHA_OBRIGATORIA, codigo: CODIGOS_ERRO.TROCA_SENHA_OBRIGATORIA });
    }
    expect(findMany).not.toHaveBeenCalled();
    expect(buscar(ID_ALVO).nome).toBe('Usuário Fictício 6');
  });

  it('com a troca pendente, PUT /conta/senha é liberado e desbloqueia o acesso após novo login', async () => {
    const tokenGestao = await tokenPorLogin(ID_GESTAO);
    await redefinir(ID_GESTAO_ALVO, { novaSenha: SENHA_TEMPORARIA }, tokenGestao);
    const tokenPendente = await tokenPorLogin(ID_GESTAO_ALVO, SENHA_TEMPORARIA);

    const troca = await trocar({ senhaAtual: SENHA_TEMPORARIA, novaSenha: SENHA_NOVA }, tokenPendente);
    expect(troca.status).toBe(204);
    expect(buscar(ID_GESTAO_ALVO).troca_senha_obrigatoria).toBe(false);

    const novoLogin = await login('gestao.alvo@sisto.exemplo', SENHA_NOVA);
    expect(novoLogin.status).toBe(200);
    expect(novoLogin.body.trocaSenhaObrigatoria).toBe(false);

    const lista = await get('/usuarios', novoLogin.body.token);
    expect(lista.status).toBe(200);
  });

  it.each([
    ['BLOQUEADO', ID_BLOQUEADO],
    ['DESATIVADO', ID_DESATIVADO],
  ])('usuário %s: a redefinição é permitida e ele continua sem acesso (RN09)', async (status, id) => {
    const tokenGestao = await tokenPorLogin(ID_GESTAO);

    const res = await redefinir(id, { novaSenha: SENHA_TEMPORARIA }, tokenGestao);

    expect(res.status).toBe(204);
    const alvo = buscar(id);
    expect(alvo.status).toBe(status);
    expect(alvo.troca_senha_obrigatoria).toBe(true);
    expect(await bcrypt.compare(SENHA_TEMPORARIA, alvo.senha_hash)).toBe(true);

    const nova = await login(alvo.email, SENHA_TEMPORARIA);
    expect(nova.status).toBe(401);
    expect(nova.body).toEqual({ erro: MENSAGEM_CREDENCIAIS_INVALIDAS });
    expect(nova.body).not.toHaveProperty('token');
  });

  it('usuário reativado depois da redefinição entra com a senha temporária e deve trocá-la', async () => {
    const tokenGestao = await tokenPorLogin(ID_GESTAO);
    await redefinir(ID_BLOQUEADO, { novaSenha: SENHA_TEMPORARIA }, tokenGestao);
    await request(app)
      .put(`/usuarios/${ID_BLOQUEADO}`)
      .set('Authorization', `Bearer ${tokenGestao}`)
      .send({ status: 'ATIVO' });

    const res = await login('tutor.bloqueado@sisto.exemplo', SENHA_TEMPORARIA);

    expect(res.status).toBe(200);
    expect(res.body.trocaSenhaObrigatoria).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Cadastro com troca obrigatória no primeiro login (RN10 — SSD 1.6, Issue #37)
// ---------------------------------------------------------------------------

describe('Usuário recém-cadastrado (RN10, #37)', () => {
  const SENHA_CADASTRO = 'CadastroFicticio#1';

  beforeEach(() => {
    // O create grava no mesmo "banco" em memória lido pelo login e pela sessão.
    create.mockImplementation(async ({ data, select }) => {
      const registro = {
        id: Math.max(...banco.map((u) => u.id)) + 1,
        senha_alterada_em: null,
        ...data,
      };
      banco.push(registro);
      return selecionar(registro, select);
    });
  });

  async function cadastrar(perfil, email) {
    const tokenGestao = await tokenPorLogin(ID_GESTAO);
    const res = await request(app)
      .post('/usuarios')
      .set('Authorization', `Bearer ${tokenGestao}`)
      .send({ nome: 'Pessoa Recem Cadastrada', email, perfil, senha: SENHA_CADASTRO });
    expect(res.status).toBe(201);
    // Sem mudança de contrato: a resposta do POST não expõe a flag.
    expect(Object.keys(res.body).sort()).toEqual(['email', 'id', 'nome', 'perfil', 'status']);
    return res.body.id;
  }

  it.each([
    ['PROFESSOR', 'professor.novo@sisto.exemplo', '/rota-protegida-ficticia', 404],
    ['GESTAO', 'gestao.nova@sisto.exemplo', '/usuarios', 200],
  ])(
    '%s: 1º login com trocaSenhaObrigatoria true → 403 → PUT /conta/senha → novo login acessa normalmente',
    async (perfil, email, rota, statusLiberado) => {
      const id = await cadastrar(perfil, email);
      expect(buscar(id).troca_senha_obrigatoria).toBe(true);

      // 1. Primeiro login com a senha temporária.
      const primeiro = await login(email, SENHA_CADASTRO);
      expect(primeiro.status).toBe(200);
      expect(primeiro.body.trocaSenhaObrigatoria).toBe(true);
      const tokenPendente = primeiro.body.token;

      // 2. Rotas protegidas bloqueadas (403) até a troca.
      const bloqueada = await get(rota, tokenPendente);
      expect(bloqueada.status).toBe(403);
      expect(bloqueada.body).toEqual({ erro: MENSAGEM_TROCA_SENHA_OBRIGATORIA, codigo: CODIGOS_ERRO.TROCA_SENHA_OBRIGATORIA });

      // 3. Troca da senha pelo próprio usuário (fluxo da #18).
      const troca = await trocar({ senhaAtual: SENHA_CADASTRO, novaSenha: SENHA_NOVA }, tokenPendente);
      expect(troca.status).toBe(204);
      expect(buscar(id).troca_senha_obrigatoria).toBe(false);

      // 4. O token usado na troca deixa de valer (RN12); a senha temporária falha.
      expect((await get(rota, tokenPendente)).status).toBe(401);
      expect((await login(email, SENHA_CADASTRO)).status).toBe(401);

      // 5. Login com a nova senha e acesso normal.
      const novoLogin = await login(email, SENHA_NOVA);
      expect(novoLogin.status).toBe(200);
      expect(novoLogin.body.trocaSenhaObrigatoria).toBe(false);
      expect((await get(rota, novoLogin.body.token)).status).toBe(statusLiberado);
    },
  );

  it('usuários já cadastrados não são afetados: login segue com trocaSenhaObrigatoria false', async () => {
    await cadastrar('TUTOR', 'tutor.novo@sisto.exemplo');

    const res = await login('docente.alvo@sisto.exemplo', SENHA_INICIAL);
    expect(res.status).toBe(200);
    expect(res.body.trocaSenhaObrigatoria).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// PUT /conta/senha — troca pelo próprio usuário
// ---------------------------------------------------------------------------

describe('PUT /conta/senha — sucesso', () => {
  it('troca a própria senha: 204 sem corpo e sem token, hash novo, flag false e senha_alterada_em', async () => {
    const token = await tokenPorLogin(ID_ALVO);
    const antes = Date.now();

    const res = await trocar({ senhaAtual: SENHA_INICIAL, novaSenha: SENHA_NOVA }, token);

    expect(res.status).toBe(204);
    expect(res.text).toBe('');
    expect(res.headers.authorization).toBeUndefined();
    const alvo = buscar(ID_ALVO);
    expect(await bcrypt.compare(SENHA_NOVA, alvo.senha_hash)).toBe(true);
    expect(alvo.senha_hash).not.toBe(SENHA_NOVA);
    expect(alvo.troca_senha_obrigatoria).toBe(false);
    expect(alvo.senha_alterada_em).toBeInstanceOf(Date);
    expect(alvo.senha_alterada_em.getTime()).toBeGreaterThanOrEqual(antes);
  });

  it('grava "senha alterada pelo usuário" no LogAuditoria, sem a senha', async () => {
    const token = await tokenPorLogin(ID_ALVO);

    await trocar({ senhaAtual: SENHA_INICIAL, novaSenha: SENHA_NOVA }, token);

    expect(criarLog).toHaveBeenCalledTimes(1);
    const { data } = criarLog.mock.calls[0][0];
    expect(data).toEqual({
      usuario_id: ID_ALVO,
      acao: 'senha alterada pelo usuário',
      recurso: `usuarios/${ID_ALVO}`,
    });
    const texto = JSON.stringify(criarLog.mock.calls);
    expect(texto).not.toContain(SENHA_INICIAL);
    expect(texto).not.toContain(SENHA_NOVA);
  });

  it.each(PERFIS)('perfil %s pode trocar a própria senha (matriz da Seção 4)', async (perfil) => {
    const id = PERFIS.indexOf(perfil) + 1;
    const token = await tokenPorLogin(id);

    const res = await trocar({ senhaAtual: SENHA_INICIAL, novaSenha: SENHA_NOVA }, token);

    expect(res.status).toBe(204);
    expect(buscar(id).senha_alterada_em).toBeInstanceOf(Date);
  });

  it('depois da troca, a senha antiga falha e a nova funciona', async () => {
    const token = await tokenPorLogin(ID_ALVO);
    await trocar({ senhaAtual: SENHA_INICIAL, novaSenha: SENHA_NOVA }, token);

    expect((await login('docente.alvo@sisto.exemplo', SENHA_INICIAL)).status).toBe(401);
    const nova = await login('docente.alvo@sisto.exemplo', SENHA_NOVA);
    expect(nova.status).toBe(200);
    expect(nova.body.trocaSenhaObrigatoria).toBe(false);
  });
});

describe('PUT /conta/senha — validações', () => {
  it('senha atual errada: 400 (não 401) com mensagem clara, sem alterar nada', async () => {
    const token = await tokenPorLogin(ID_ALVO);

    const res = await trocar({ senhaAtual: 'SenhaErradaFicticia', novaSenha: SENHA_NOVA }, token);

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ erro: MENSAGEM_SENHA_ATUAL_INCORRETA });
    expect(res.headers['www-authenticate']).toBeUndefined();
    expect(update).not.toHaveBeenCalled();
    expect(criarLog).not.toHaveBeenCalled();
    // O token continua valendo (nada mudou).
    expect((await get('/rota-inexistente', token)).status).toBe(404);
  });

  it('senha atual acima de 72 bytes nunca confere: 400', async () => {
    const token = await tokenPorLogin(ID_ALVO);

    const res = await trocar({ senhaAtual: `${SENHA_INICIAL}${'x'.repeat(80)}`, novaSenha: SENHA_NOVA }, token);

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ erro: MENSAGEM_SENHA_ATUAL_INCORRETA });
  });

  it('nova senha igual à atual: 400 com mensagem clara, sem alterar nada', async () => {
    const token = await tokenPorLogin(ID_ALVO);

    const res = await trocar({ senhaAtual: SENHA_INICIAL, novaSenha: SENHA_INICIAL }, token);

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ erro: MENSAGEM_NOVA_SENHA_IGUAL_ATUAL });
    expect(update).not.toHaveBeenCalled();
    expect(buscar(ID_ALVO).senha_alterada_em).toBeNull();
  });

  it.each([
    ['nova senha com menos de 8 caracteres', { senhaAtual: SENHA_INICIAL, novaSenha: 'Curta12' }, 'A senha deve ter no mínimo 8 caracteres.'],
    ['senhaAtual ausente', { novaSenha: SENHA_NOVA }, 'Informe senhaAtual (texto não vazio).'],
    ['novaSenha ausente', { senhaAtual: SENHA_INICIAL }, 'Informe novaSenha (texto não vazio).'],
    ['ambos ausentes', {}, 'Informe senhaAtual e novaSenha (texto não vazio).'],
    ['corpo em lista', [SENHA_INICIAL], 'Envie um objeto JSON com senhaAtual e novaSenha.'],
  ])('%s: 400', async (_caso, corpo, mensagem) => {
    const token = await tokenPorLogin(ID_ALVO);

    const res = await trocar(corpo, token);

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ erro: mensagem });
    expect(update).not.toHaveBeenCalled();
  });

  it('sem token: 401', async () => {
    const res = await trocar({ senhaAtual: SENHA_INICIAL, novaSenha: SENHA_NOVA });

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ erro: MENSAGEM_NAO_AUTENTICADO });
  });

  it('respostas de erro nunca contêm as senhas enviadas', async () => {
    const token = await tokenPorLogin(ID_ALVO);

    const res = await trocar({ senhaAtual: 'SenhaErradaFicticia', novaSenha: SENHA_NOVA }, token);

    esperarSemSenha(res, 'SenhaErradaFicticia', SENHA_NOVA);
  });
});

// ---------------------------------------------------------------------------
// RN12 — tokens anteriores à troca deixam de valer
// ---------------------------------------------------------------------------

describe('Sessões depois de uma troca de senha (RN12)', () => {
  it('troca pelo próprio usuário: o token usado na troca deixa de valer (401) e o novo login funciona', async () => {
    const token = await tokenPorLogin(ID_ALVO);
    const outraSessao = await tokenPorLogin(ID_ALVO);

    await trocar({ senhaAtual: SENHA_INICIAL, novaSenha: SENHA_NOVA }, token);

    for (const antigo of [token, outraSessao]) {
      const res = await get('/rota-inexistente', antigo);
      expect(res.status).toBe(401);
      expect(res.body).toEqual({ erro: MENSAGEM_NAO_AUTENTICADO });
      expect(res.headers['www-authenticate']).toBe('Bearer');
    }
    // O token antigo não serve nem para trocar a senha de novo.
    expect((await trocar({ senhaAtual: SENHA_NOVA, novaSenha: 'OutraSenha123' }, token)).status).toBe(401);

    // Login logo em seguida (mesmo segundo da troca) gera token válido.
    const novoToken = await tokenPorLogin(ID_ALVO, SENHA_NOVA);
    expect((await get('/rota-inexistente', novoToken)).status).toBe(404);
  });

  it('redefinição pela Gestão: os tokens do usuário emitidos antes deixam de valer (401)', async () => {
    const tokenAlvo = await tokenPorLogin(ID_GESTAO_ALVO);
    expect((await get('/usuarios', tokenAlvo)).status).toBe(200);
    const tokenGestao = await tokenPorLogin(ID_GESTAO);

    await redefinir(ID_GESTAO_ALVO, { novaSenha: SENHA_TEMPORARIA }, tokenGestao);

    const res = await get('/usuarios', tokenAlvo);
    expect(res.status).toBe(401);
    // Nem PUT /conta/senha aceita o token antigo.
    expect((await trocar({ senhaAtual: SENHA_TEMPORARIA, novaSenha: SENHA_NOVA }, tokenAlvo)).status).toBe(401);
    // O token da Gestão que redefiniu continua valendo.
    expect((await get('/usuarios', tokenGestao)).status).toBe(200);
  });

  it('token com iat no mesmo segundo da troca é rejeitado; no segundo seguinte, aceito', async () => {
    const segundoDaTroca = 1_800_000_000;
    buscar(ID_ALVO).senha_alterada_em = new Date(segundoDaTroca * 1000 + 500);

    expect((await get('/rota-inexistente', tokenComIat(ID_ALVO, segundoDaTroca - 60))).status).toBe(401);
    expect((await get('/rota-inexistente', tokenComIat(ID_ALVO, segundoDaTroca))).status).toBe(401);
    expect((await get('/rota-inexistente', tokenComIat(ID_ALVO, segundoDaTroca + 1))).status).toBe(404);
  });

  it('o login no mesmo segundo da troca emite iat do segundo seguinte, com validade de exatamente 8h', async () => {
    const segundoDaTroca = Math.floor(Date.now() / 1000);
    const alvo = buscar(ID_ALVO);
    alvo.senha_alterada_em = new Date(segundoDaTroca * 1000 + 999);

    const res = await login(alvo.email, SENHA_INICIAL);
    const payload = jwt.decode(res.body.token);

    expect(payload.iat).toBeGreaterThan(segundoDaTroca);
    expect(payload.exp - payload.iat).toBe(8 * 60 * 60);
    expect(Object.keys(payload).sort()).toEqual(['exp', 'iat', 'id', 'perfil']);
  });
});

describe('Unidades — regra de desempate do RN12', () => {
  const troca = new Date(Date.UTC(2026, 9, 15, 12, 0, 0, 400)); // 12:00:00.400
  const segundo = Math.floor(troca.getTime() / 1000);

  it('tokenEmitidoAposTrocaDeSenha: senha nunca trocada aceita qualquer iat', () => {
    expect(tokenEmitidoAposTrocaDeSenha(1, null)).toBe(true);
    expect(tokenEmitidoAposTrocaDeSenha(1, undefined)).toBe(true);
  });

  it('tokenEmitidoAposTrocaDeSenha: só aceita iat estritamente posterior ao segundo da troca', () => {
    expect(tokenEmitidoAposTrocaDeSenha(segundo - 1, troca)).toBe(false);
    expect(tokenEmitidoAposTrocaDeSenha(segundo, troca)).toBe(false);
    expect(tokenEmitidoAposTrocaDeSenha(segundo + 1, troca)).toBe(true);
    expect(tokenEmitidoAposTrocaDeSenha(undefined, troca)).toBe(false);
  });

  it('calcularIatToken: segundo atual sem troca; segundo seguinte à troca quando cai no mesmo segundo', () => {
    expect(calcularIatToken(null, segundo * 1000 + 900)).toBe(segundo);
    expect(calcularIatToken(troca, segundo * 1000 + 900)).toBe(segundo + 1);
    expect(calcularIatToken(troca, (segundo + 5) * 1000)).toBe(segundo + 5);
  });

  it('calcularIatToken: troca até 2s à frente ainda é compensada; acima disso usa o segundo atual', () => {
    const agoraMs = troca.getTime();
    expect(LIMITE_AJUSTE_IAT_MS).toBe(2000);
    // 1,5s à frente (troca registrada como anterior + 1s): compensa.
    expect(calcularIatToken(new Date(agoraMs + 1500), agoraMs)).toBe(segundo + 2);
    // Exatamente no limite: compensa.
    expect(calcularIatToken(new Date(agoraMs + 2000), agoraMs)).toBe(segundo + 3);
    // Relógio adiantado / dado corrompido: nunca empurra o iat (nem a validade) para o futuro.
    expect(calcularIatToken(new Date(agoraMs + 2001), agoraMs)).toBe(segundo);
    expect(calcularIatToken(new Date(agoraMs + 365 * 24 * 3600 * 1000), agoraMs)).toBe(segundo);
  });

  it('login com senha_alterada_em muito no futuro: token sai com o segundo atual e é rejeitado (falha fechada)', async () => {
    const alvo = buscar(ID_ALVO);
    alvo.senha_alterada_em = new Date(Date.now() + 60 * 60 * 1000);

    const res = await login(alvo.email, SENHA_INICIAL);
    const payload = jwt.decode(res.body.token);

    expect(payload.iat).toBeLessThanOrEqual(Math.floor(Date.now() / 1000));
    expect(payload.exp - payload.iat).toBe(8 * 60 * 60);
    expect((await get('/rota-inexistente', res.body.token)).status).toBe(401);
  });

  it('proximaSenhaAlteradaEm: agora, ou anterior + 1s se a anterior for recente', () => {
    const agora = new Date(troca.getTime() + 300);
    expect(proximaSenhaAlteradaEm(agora, null)).toBe(agora);
    expect(proximaSenhaAlteradaEm(agora, troca).getTime()).toBe(troca.getTime() + 1000);
    const muitoDepois = new Date(troca.getTime() + 60_000);
    expect(proximaSenhaAlteradaEm(muitoDepois, troca).getTime()).toBe(muitoDepois.getTime());
  });

  it('duas trocas no mesmo segundo ficam em segundos distintos', async () => {
    const tokenGestao = await tokenPorLogin(ID_GESTAO);
    await redefinir(ID_ALVO, { novaSenha: SENHA_TEMPORARIA }, tokenGestao);
    const primeira = buscar(ID_ALVO).senha_alterada_em;
    await redefinir(ID_ALVO, { novaSenha: SENHA_NOVA }, tokenGestao);
    const segunda = buscar(ID_ALVO).senha_alterada_em;

    expect(segunda.getTime()).toBeGreaterThanOrEqual(primeira.getTime() + 1000);
    expect(Math.floor(segunda.getTime() / 1000)).toBeGreaterThan(Math.floor(primeira.getTime() / 1000));
  });
});

describe('Transação da troca de senha (atomicidade e concorrência)', () => {
  it('lê senha_alterada_em e grava dentro de uma transação SERIALIZABLE', async () => {
    const tokenGestao = await tokenPorLogin(ID_GESTAO);

    await redefinir(ID_ALVO, { novaSenha: SENHA_TEMPORARIA }, tokenGestao);

    expect($transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'Serializable',
    });
  });

  it('conflito de serialização (P2034) é repetido e a troca conclui', async () => {
    const token = await tokenPorLogin(ID_ALVO);
    const implementacao = $transaction.getMockImplementation();
    $transaction.mockImplementationOnce(async () => {
      throw erroPrisma('P2034', 'Transaction failed due to a write conflict');
    });
    $transaction.mockImplementation(implementacao);

    const res = await trocar({ senhaAtual: SENHA_INICIAL, novaSenha: SENHA_NOVA }, token);

    expect(res.status).toBe(204);
    expect($transaction).toHaveBeenCalledTimes(2);
    expect(criarLog).toHaveBeenCalledTimes(1);
  });

  it('conflito persistente: 409 com mensagem clara, sem gravar nada', async () => {
    const tokenGestao = await tokenPorLogin(ID_GESTAO);
    $transaction.mockImplementation(async () => {
      throw erroPrisma('P2034', 'Transaction failed due to a write conflict');
    });

    const res = await redefinir(ID_ALVO, { novaSenha: SENHA_TEMPORARIA }, tokenGestao);

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ erro: MENSAGEM_CONFLITO_TROCA_SENHA, codigo: CODIGOS_ERRO.CONFLITO_CONCORRENTE });
    expect($transaction).toHaveBeenCalledTimes(3);
    expect(buscar(ID_ALVO).troca_senha_obrigatoria).toBe(false);
  });

  it('usuário removido entre a pré-checagem e a transação: 404', async () => {
    const tokenGestao = await tokenPorLogin(ID_GESTAO);
    const implementacao = $transaction.getMockImplementation();
    $transaction.mockImplementation(async (fn, opcoes) => {
      banco = banco.filter((u) => u.id !== ID_ALVO);
      return implementacao(fn, opcoes);
    });

    const res = await redefinir(ID_ALVO, { novaSenha: SENHA_TEMPORARIA }, tokenGestao);

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ erro: MENSAGEM_USUARIO_NAO_ENCONTRADO });
    expect(criarLog).not.toHaveBeenCalled();
  });
});

describe('Nada de senha em log (RNF03, RNF06)', () => {
  it('nenhum console.* recebe as senhas durante redefinição e troca', async () => {
    const espioes = ['log', 'info', 'warn', 'error', 'debug'].map((m) =>
      vi.spyOn(console, m).mockImplementation(() => {}),
    );
    const tokenGestao = await tokenPorLogin(ID_GESTAO);
    await redefinir(ID_ALVO, { novaSenha: SENHA_TEMPORARIA }, tokenGestao);
    const tokenAlvo = await tokenPorLogin(ID_ALVO, SENHA_TEMPORARIA);
    await trocar({ senhaAtual: 'SenhaErradaFicticia', novaSenha: SENHA_NOVA }, tokenAlvo);
    await trocar({ senhaAtual: SENHA_TEMPORARIA, novaSenha: SENHA_NOVA }, tokenAlvo);

    const registrado = JSON.stringify(espioes.flatMap((e) => e.mock.calls));
    for (const senha of [SENHA_INICIAL, SENHA_TEMPORARIA, SENHA_NOVA, 'SenhaErradaFicticia']) {
      expect(registrado).not.toContain(senha);
    }
  });
});
