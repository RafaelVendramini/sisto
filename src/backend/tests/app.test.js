import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app, { criarApp } from '../src/app.js';

describe('Rota inexistente', () => {
  it('responde 404 em JSON', async () => {
    const res = await request(app).get('/rota-que-nao-existe');

    expect(res.status).toBe(404);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.body).toEqual({ erro: 'Rota não encontrada' });
  });

  it('responde 404 em JSON também para outros métodos', async () => {
    const res = await request(app).post('/outra/rota').send({ campo: 'valor' });

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
    const res = await request(appComErro).get('/teste/erro-sincrono');

    expect(res.status).toBe(500);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.body).toEqual({ erro: 'Erro interno do servidor' });
    expect(res.text).not.toMatch(/stack|at .*\.js|detalhe sensível/i);
  });

  it('erro em handler assíncrono também responde 500 em JSON', async () => {
    const res = await request(appComErro).get('/teste/erro-assincrono');

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
