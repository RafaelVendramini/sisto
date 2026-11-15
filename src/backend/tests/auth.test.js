// Testes de POST /auth/login (Issue #10) — somente dados fictícios (RN05).
// Não dependem do banco: o módulo src/lib/prisma.js é substituído por um fake.
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';

const { findUnique } = vi.hoisted(() => ({ findUnique: vi.fn() }));

vi.mock('../src/lib/prisma.js', () => ({
  default: { usuario: { findUnique } },
}));

const { default: app } = await import('../src/app.js');
const { MENSAGEM_CREDENCIAIS_INVALIDAS } = await import('../src/services/auth.js');

// Segredo fictício, só para os testes.
const SEGREDO_TESTE = 'segredo-ficticio-de-teste-com-mais-de-32-caracteres';
const SENHA_CORRETA = 'SenhaFicticia123';
const OITO_HORAS_EM_SEGUNDOS = 8 * 60 * 60;

/** Usuários fictícios indexados pelo e-mail (já normalizado, como no banco). */
let usuarios;

beforeAll(async () => {
  // Custo 4 só para acelerar os testes (produção usa 12).
  const senha_hash = await bcrypt.hash(SENHA_CORRETA, 4);
  usuarios = {
    'professor@sisto.exemplo': {
      id: 2,
      nome: 'Professor Exemplo',
      perfil: 'PROFESSOR',
      status: 'ATIVO',
      senha_hash,
    },
    'bloqueado@sisto.exemplo': {
      id: 3,
      nome: 'Usuário Bloqueado Exemplo',
      perfil: 'TUTOR',
      status: 'BLOQUEADO',
      senha_hash,
    },
    'desativado@sisto.exemplo': {
      id: 4,
      nome: 'Usuário Desativado Exemplo',
      perfil: 'PEDAGOGICO',
      status: 'DESATIVADO',
      senha_hash,
    },
  };
});

let segredoOriginal;

beforeEach(() => {
  segredoOriginal = process.env.JWT_SECRET;
  process.env.JWT_SECRET = SEGREDO_TESTE;
  findUnique.mockReset();
  findUnique.mockImplementation(async ({ where }) => usuarios[where.email] ?? null);
});

afterEach(() => {
  if (segredoOriginal === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = segredoOriginal;
  vi.restoreAllMocks();
});

function login(corpo) {
  return request(app).post('/auth/login').send(corpo);
}

/** Garante que a resposta não traz token nem dados sensíveis. */
function esperarSemTokenNemHash(res) {
  expect(res.body).not.toHaveProperty('token');
  expect(res.text).not.toMatch(/senha_hash|\$2[aby]\$/);
  expect(res.text).not.toContain(SENHA_CORRETA);
}

describe('POST /auth/login — sucesso', () => {
  it('usuário ativo com senha correta recebe 200, JWT válido e dados básicos', async () => {
    const res = await login({ email: 'professor@sisto.exemplo', senha: SENHA_CORRETA });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.body).toEqual({
      token: expect.any(String),
      usuario: { id: 2, nome: 'Professor Exemplo', perfil: 'PROFESSOR' },
      trocaSenhaObrigatoria: false,
    });

    const payload = jwt.verify(res.body.token, SEGREDO_TESTE, { algorithms: ['HS256'] });
    expect(payload.id).toBe(2);
    expect(payload.perfil).toBe('PROFESSOR');
    expect(jwt.decode(res.body.token, { complete: true }).header.alg).toBe('HS256');
  });

  it('o JWT expira em 8 horas', async () => {
    const res = await login({ email: 'professor@sisto.exemplo', senha: SENHA_CORRETA });
    const payload = jwt.verify(res.body.token, SEGREDO_TESTE, { algorithms: ['HS256'] });

    expect(payload.exp - payload.iat).toBe(OITO_HORAS_EM_SEGUNDOS);
  });

  it('o token não traz senha, hash nem status', async () => {
    const res = await login({ email: 'professor@sisto.exemplo', senha: SENHA_CORRETA });
    const payload = jwt.decode(res.body.token);

    expect(Object.keys(payload).sort()).toEqual(['exp', 'iat', 'id', 'perfil']);
  });

  it('a resposta de sucesso não contém senha_hash', async () => {
    const res = await login({ email: 'professor@sisto.exemplo', senha: SENHA_CORRETA });

    expect(res.status).toBe(200);
    expect(res.text).not.toMatch(/senha_hash|\$2[aby]\$/);
    expect(res.body.usuario).not.toHaveProperty('status');
  });

  it('e-mail com maiúsculas e espaços é normalizado e autentica', async () => {
    const res = await login({ email: '  Professor@SISTO.Exemplo  ', senha: SENHA_CORRETA });

    expect(res.status).toBe(200);
    expect(findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { email: 'professor@sisto.exemplo' } }),
    );
  });
});

describe('POST /auth/login — credenciais inválidas (401 genérico)', () => {
  it('senha incorreta retorna 401 com mensagem genérica', async () => {
    const res = await login({ email: 'professor@sisto.exemplo', senha: 'SenhaErrada999' });

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ erro: MENSAGEM_CREDENCIAIS_INVALIDAS });
    esperarSemTokenNemHash(res);
  });

  it('e-mail inexistente retorna 401 com a MESMA mensagem genérica', async () => {
    const senhaErrada = await login({ email: 'professor@sisto.exemplo', senha: 'SenhaErrada999' });
    const inexistente = await login({ email: 'ninguem@sisto.exemplo', senha: SENHA_CORRETA });

    expect(inexistente.status).toBe(401);
    expect(inexistente.body).toEqual(senhaErrada.body);
    esperarSemTokenNemHash(inexistente);
  });

  it('e-mail inexistente ainda executa bcrypt.compare (tempo de resposta semelhante)', async () => {
    const compare = vi.spyOn(bcrypt, 'compare');

    await login({ email: 'ninguem@sisto.exemplo', senha: SENHA_CORRETA });

    expect(compare).toHaveBeenCalledTimes(1);
  });

  it('senha curta (abaixo de 8 caracteres) não é erro de validação: só não confere (401)', async () => {
    const res = await login({ email: 'professor@sisto.exemplo', senha: 'abc' });

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ erro: MENSAGEM_CREDENCIAIS_INVALIDAS });
  });

  it('senha acima de 72 bytes com o prefixo correto não autentica (limite do bcrypt)', async () => {
    const longa = SENHA_CORRETA + 'x'.repeat(80);
    const usuarioLongo = {
      ...usuarios['professor@sisto.exemplo'],
      senha_hash: await bcrypt.hash(longa.slice(0, 72), 4),
    };
    findUnique.mockResolvedValueOnce(usuarioLongo);

    const res = await login({ email: 'professor@sisto.exemplo', senha: longa });

    expect(res.status).toBe(401);
    esperarSemTokenNemHash(res);
  });
});

describe('POST /auth/login — usuário não ativo (RN09 / RN07)', () => {
  it.each([
    ['BLOQUEADO', 'bloqueado@sisto.exemplo'],
    ['DESATIVADO', 'desativado@sisto.exemplo'],
  ])('usuário %s com senha correta recebe 401 e nenhum token', async (_status, email) => {
    const res = await login({ email, senha: SENHA_CORRETA });

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ erro: MENSAGEM_CREDENCIAIS_INVALIDAS });
    esperarSemTokenNemHash(res);
  });

  it.each([
    ['BLOQUEADO', 'bloqueado@sisto.exemplo'],
    ['DESATIVADO', 'desativado@sisto.exemplo'],
  ])('usuário %s com senha errada recebe a mesma resposta 401', async (_status, email) => {
    const res = await login({ email, senha: 'SenhaErrada999' });

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ erro: MENSAGEM_CREDENCIAIS_INVALIDAS });
  });
});

describe('POST /auth/login — validação de entrada (400)', () => {
  it.each([
    ['sem email', { senha: SENHA_CORRETA }, /email/],
    ['sem senha', { email: 'professor@sisto.exemplo' }, /senha/],
    ['corpo vazio', {}, /email e senha/],
    ['email vazio', { email: '', senha: SENHA_CORRETA }, /email/],
    ['email só com espaços', { email: '   ', senha: SENHA_CORRETA }, /email/],
    ['senha vazia', { email: 'professor@sisto.exemplo', senha: '' }, /senha/],
    ['email não-string', { email: 123, senha: SENHA_CORRETA }, /email/],
    ['senha não-string', { email: 'professor@sisto.exemplo', senha: 12345678 }, /senha/],
    ['email objeto', { email: { $ne: null }, senha: SENHA_CORRETA }, /email/],
    ['senha array', { email: 'professor@sisto.exemplo', senha: [SENHA_CORRETA] }, /senha/],
  ])('%s retorna 400 com mensagem clara e sem consultar o banco', async (_caso, corpo, padrao) => {
    const res = await login(corpo);

    expect(res.status).toBe(400);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.body.erro).toMatch(padrao);
    esperarSemTokenNemHash(res);
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('requisição sem corpo JSON retorna 400', async () => {
    const res = await request(app).post('/auth/login');

    expect(res.status).toBe(400);
    expect(res.body.erro).toMatch(/email e senha/);
  });
});

describe('POST /auth/login — JWT_SECRET inválido (falha segura)', () => {
  it.each([
    ['ausente', undefined],
    ['curto demais', 'curto'],
    ['valor de exemplo do .env.example', 'TROQUE_POR_UM_SEGREDO_ALEATORIO_DE_96_CARACTERES_HEX'],
  ])('segredo %s: 500 genérico, sem token e sem consultar o banco', async (_caso, valor) => {
    if (valor === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = valor;

    const res = await login({ email: 'professor@sisto.exemplo', senha: SENHA_CORRETA });

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ erro: 'Erro interno do servidor' });
    expect(res.text).not.toMatch(/JWT_SECRET/);
    esperarSemTokenNemHash(res);
    expect(findUnique).not.toHaveBeenCalled();
  });
});

describe('POST /auth/login — erro do banco', () => {
  it('falha na consulta responde 500 genérico sem detalhes', async () => {
    findUnique.mockRejectedValueOnce(new Error('falha de conexão com detalhe interno'));

    const res = await login({ email: 'professor@sisto.exemplo', senha: SENHA_CORRETA });

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ erro: 'Erro interno do servidor' });
    expect(res.text).not.toMatch(/detalhe interno/);
  });
});
