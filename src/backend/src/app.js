import express from 'express';
import rotas from './routes/index.js';
import { rotaNaoEncontrada, tratarErros } from './middlewares/erros.js';
import { criarMiddlewareCors } from './middlewares/cors.js';

/**
 * Cria a aplicação Express sem subir o servidor (permite testes com Supertest).
 *
 * @param {object} [opcoes]
 * @param {(app: import('express').Express) => void} [opcoes.registrarRotasExtras]
 *   Permite que os testes registrem rotas auxiliares antes dos tratadores de 404 e de erro.
 *   Elas ficam DEPOIS do roteador principal e, portanto, já exigem JWT
 *   (autenticação global de routes/index.js) — como qualquer rota nova.
 * @param {object} [opcoes.cors]
 *   Opções do CORS ({ corsOrigin, ambiente, avisar }); por padrão lê
 *   CORS_ORIGIN e NODE_ENV de process.env (ver middlewares/cors.js).
 */
export function criarApp({ registrarRotasExtras, cors: opcoesCors } = {}) {
  const app = express();

  app.disable('x-powered-by');
  // CORS antes de tudo (inclusive da autenticação global de routes/index.js):
  // o preflight OPTIONS responde 204 sem exigir token, e as respostas de erro
  // (400/401/404) também levam Access-Control-Allow-Origin para origens permitidas.
  app.use(criarMiddlewareCors(opcoesCors));
  app.use(express.json());

  app.use(rotas);

  if (registrarRotasExtras) {
    registrarRotasExtras(app);
  }

  app.use(rotaNaoEncontrada);
  app.use(tratarErros);

  return app;
}

const app = criarApp();

export default app;
