// Somente dados fictícios (RN05). Desde a Issue #11 toda rota fora de /auth/*
// exige JWT de usuário ativo; por isso estes testes usam um token válido e um
// banco falso (src/lib/prisma.js substituído).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';

const { findUnique } = vi.hoisted(() => ({ findUnique: vi.fn() }));

vi.mock('../src/lib/prisma.js', () => ({
  default: { usuario: { findUnique } },
}));

const { default: app, criarApp } = await import('../src/app.js');

const SEGREDO_TESTE = 'segredo-ficticio-de-teste-com-mais-de-32-caracteres';
let segredoOriginal;
let token;

beforeEach(() => {
  segredoOriginal = process.env.JWT_SECRET;
  process.env.JWT_SECRET = SEGREDO_TESTE;
  findUnique.mockReset();
  findUnique.mockResolvedValue({ id: 1, perfil: 'GESTAO', status: 'ATIVO' });
  token = jwt.sign({ id: 1, perfil: 'GESTAO' }, SEGREDO_TESTE, {
    algorithm: 'HS256',
    expiresIn: '8h',
  });
});

afterEach(() => {
  if (segredoOriginal === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = segredoOriginal;
});

describe('Rota inexistente', () => {
  it('responde 404 em JSON (usuário autenticado)', async () => {
    const res = await request(app)
      .get('/rota-que-nao-existe')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(404);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.body).toEqual({ erro: 'Rota não encontrada' });
  });

  it('responde 404 em JSON também para outros métodos (usuário autenticado)', async () => {
    const res = await request(app)
      .post('/outra/rota')
      .set('Authorization', `Bearer ${token}`)
      .send({ campo: 'valor' });

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ erro: 'Rota não encontrada' });
  });

  it('sem token responde 401 (não revela quais rotas existem)', async () => {
    const res = await request(app).get('/rota-que-nao-existe');

    expect(res.status).toBe(401);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.body).toHaveProperty('erro');
  });

  it('caminho inexistente sob /auth responde 404 sem exigir token', async () => {
    const res = await request(app).get('/auth/nao-existe');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ erro: 'Rota não encontrada' });
  });
});

describe('Middleware central de erros', () => {
  const appComErro = criarApp({
    registrarRotasExtras: (a) => {
      a.get('/teste/erro-sincrono', () => {
        throw new Error('falha interna com detalhe sensível');
      });
      a.get('/teste/erro-assincrono', async () => {
        throw new Error('falha assíncrona com detalhe sensível');
      });
    },
  });

  it('erro não tratado responde 500 em JSON sem stack trace', async () => {
    const res = await request(appComErro)
      .get('/teste/erro-sincrono')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(500);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.body).toEqual({ erro: 'Erro interno do servidor' });
    expect(res.text).not.toMatch(/stack|at .*\.js|detalhe sensível/i);
  });

  it('erro em handler assíncrono também responde 500 em JSON', async () => {
    const res = await request(appComErro)
      .get('/teste/erro-assincrono')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ erro: 'Erro interno do servidor' });
    expect(res.text).not.toMatch(/detalhe sensível/);
  });

  it('JSON malformado no corpo responde 400 em JSON', async () => {
    const res = await request(app)
      .post('/qualquer')
      .set('Content-Type', 'application/json')
      .send('{"invalido":');

    expect(res.status).toBe(400);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.body).toEqual({ erro: 'JSON inválido no corpo da requisição' });
  });

  it('não expõe o cabeçalho X-Powered-By', async () => {
    const res = await request(app).get('/qualquer');

    expect(res.headers['x-powered-by']).toBeUndefined();
  });
});
