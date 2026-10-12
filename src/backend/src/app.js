import express from 'express';
import rotas from './routes/index.js';
import { rotaNaoEncontrada, tratarErros } from './middlewares/erros.js';

/**
 * Cria a aplicação Express sem subir o servidor (permite testes com Supertest).
 *
 * @param {object} [opcoes]
 * @param {(app: import('express').Express) => void} [opcoes.registrarRotasExtras]
 *   Permite que os testes registrem rotas auxiliares antes dos tratadores de 404 e de erro.
 *   Elas ficam DEPOIS do roteador principal e, portanto, já exigem JWT
 *   (autenticação global de routes/index.js) — como qualquer rota nova.
 */
export function criarApp({ registrarRotasExtras } = {}) {
  const app = express();

  app.disable('x-powered-by');
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
