import express from 'express';
import rotas from './routes/index.js';
import { rotaNaoEncontrada, tratarErros } from './middlewares/erros.js';
import { criarMiddlewareCors } from './middlewares/cors.js';
import {
  CHAVE_LIMITADORES,
  criarLimitadoresTentativas,
} from './middlewares/limite-tentativas.js';

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
 * @param {{ maximo?: number, janelaMs?: number }} [opcoes.limiteTentativas]
 *   Só para testes: limite e janela das tentativas com falha no login e na
 *   troca de senha. Por padrão, 5 falhas em 15 minutos (SSD 1.8, Seção 12).
 */
export function criarApp({
  registrarRotasExtras,
  cors: opcoesCors,
  limiteTentativas,
} = {}) {
  const app = express();

  app.disable('x-powered-by');
  // Na homologação (Render), a API fica atrás de UM proxy reverso, que
  // acrescenta o IP do cliente ao fim do X-Forwarded-For. Com 'trust proxy' = 1,
  // req.ip é esse último endereço (o cliente visto pelo proxy), e não o IP do
  // proxy; endereços que o próprio cliente inventar no começo do cabeçalho são
  // ignorados. Sem isso, o limite de tentativas (Issue #90) contaria todos os
  // usuários como um único IP. Não usar `true`: confiaria em qualquer
  // X-Forwarded-For e permitiria trocar de IP a cada tentativa.
  app.set('trust proxy', 1);
  // Limitadores de tentativas com falha (login e troca de senha), um conjunto
  // por app: o contador fica em memória (Seção 10).
  app.locals[CHAVE_LIMITADORES] = criarLimitadoresTentativas(limiteTentativas);
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
