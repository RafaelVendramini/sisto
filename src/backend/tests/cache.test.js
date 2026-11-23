// Testes do Cache-Control: no-store (Issue #127, RNF06): o navegador não
// pode guardar em cache o JSON da API (dados de estudantes), nem nas rotas
// públicas nem nas protegidas, nem nas respostas de erro.
// Somente dados fictícios (RN05). Não dependem do banco.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';

const mocks = vi.hoisted(() => ({
  usuarioFindUnique: vi.fn(),
  categoriaFindMany: vi.fn(),
}));

vi.mock('../src/lib/prisma.js', () => ({
  default: {
    usuario: { findUnique: mocks.usuarioFindUnique },
    categoria: { findMany: mocks.categoriaFindMany },
  },
}));

const { default: app } = await import('../src/app.js');
const { VALOR_CACHE_CONTROL } = await import('../src/middlewares/cache.js');

const SEGREDO_TESTE = 'segredo-ficticio-de-teste-com-mais-de-32-caracteres';
let token;

beforeEach(() => {
  process.env.JWT_SECRET = SEGREDO_TESTE;
  mocks.usuarioFindUnique.mockReset();
  mocks.usuarioFindUnique.mockImplementation(async ({ where }) =>
    where.id === 1
      ? { id: 1, perfil: 'GESTAO', status: 'ATIVO', troca_senha_obrigatoria: false, senha_alterada_em: null }
      : null,
  );
  mocks.categoriaFindMany.mockReset();
  mocks.categoriaFindMany.mockResolvedValue([
    { id: 1, nome: 'Categoria Fictícia', descricao: null },
  ]);
  token = jwt.sign({ id: 1, perfil: 'GESTAO' }, SEGREDO_TESTE, {
    algorithm: 'HS256',
    expiresIn: '8h',
  });
});

afterEach(() => {
  delete process.env.JWT_SECRET;
});

function esperarSemCache(res) {
  expect(res.headers['cache-control']).toBe('no-store');
}

describe('Cache-Control: no-store em todas as respostas da API', () => {
  it('o valor é exatamente no-store', () => {
    expect(VALOR_CACHE_CONTROL).toBe('no-store');
  });

  it('rota pública: POST /auth/login com erro (400)', async () => {
    const res = await request(app).post('/auth/login').send({});
    expect(res.status).toBe(400);
    esperarSemCache(res);
  });

  it('rota pública: POST /auth/login com credenciais inválidas (401)', async () => {
    const res = await request(app)
      .post('/auth/login')
      .send({ email: 'ninguem@sisto.exemplo', senha: 'SenhaFicticia123' });
    expect(res.status).toBe(401);
    esperarSemCache(res);
  });

  it('rota protegida com sucesso: GET /categorias (200)', async () => {
    const res = await request(app).get('/categorias').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    esperarSemCache(res);
  });

  it('rota protegida sem token (401)', async () => {
    const res = await request(app).get('/estudantes');
    expect(res.status).toBe(401);
    esperarSemCache(res);
  });

  it('rota inexistente (404) e JSON inválido (400)', async () => {
    const naoEncontrada = await request(app)
      .get('/rota-ficticia')
      .set('Authorization', `Bearer ${token}`);
    expect(naoEncontrada.status).toBe(404);
    esperarSemCache(naoEncontrada);

    const jsonInvalido = await request(app)
      .post('/auth/login')
      .set('Content-Type', 'application/json')
      .send('{"email":');
    expect(jsonInvalido.status).toBe(400);
    esperarSemCache(jsonInvalido);
  });

  it('preflight OPTIONS do CORS', async () => {
    const res = await request(app)
      .options('/estudantes')
      .set('Origin', 'http://localhost:5173')
      .set('Access-Control-Request-Method', 'GET');
    expect(res.status).toBe(204);
    esperarSemCache(res);
  });
});
