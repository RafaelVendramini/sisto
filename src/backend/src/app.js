import express from 'express';
import rotas from './routes/index.js';
import { rotaNaoEncontrada, tratarErros } from './middlewares/erros.js';
import { criarMiddlewareCors } from './middlewares/cors.js';
import { impedirCache } from './middlewares/cache.js';
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
 * @param {{ maximo?: number, janelaMs?: number, maximoPorIp?: number }} [opcoes.limiteTentativas]
 *   Só para testes: limite e janela das tentativas com falha no login e na
 *   troca de senha. Por padrão, 5 falhas em 15 minutos (SSD 1.8, Seção 12) e,
 *   no login, também 100 falhas por IP na mesma janela (SSD 1.13).
 */
export function criarApp({
  registrarRotasExtras,
  cors: opcoesCors,
  limiteTentativas,
} = {}) {
  const app = express();

  app.disable('x-powered-by');
  // Na homologação (Render), a requisição percorre a cadeia
  //   cliente → borda Cloudflare do Render → balanceador interno do Render → API,
  // conferida em 23/11/2026 pelo diagnóstico da Issue #127 (DIAGNOSTICO_PROXY=1):
  // o X-Forwarded-For chega como "cliente, borda, balanceador" (3 endereços; os
  // da borda e do balanceador mudam, mas são sempre 2 saltos depois do cliente).
  // Com 'trust proxy' = 3, o Express confia no socket e nos 2 últimos endereços
  // do cabeçalho, e req.ip passa a ser o 3º endereço contado do FIM: o cliente.
  // Com 1, req.ip seria o balanceador e todos os usuários dividiriam o mesmo
  // limite de tentativas (Issue #90).
  // Um X-Forwarded-For forjado pelo cliente não engana: cada proxy ACRESCENTA
  // ao fim do cabeçalho, então o que o cliente inventar fica no começo
  // ("forjado, cliente, borda, balanceador") e a contagem a partir do fim
  // continua chegando ao cliente real. Não usar `true`: confiaria em qualquer
  // X-Forwarded-For e permitiria trocar de IP a cada tentativa. Se a cadeia do
  // Render mudar, refazer a conferência com o diagnóstico antes de alterar.
  app.set('trust proxy', 3);
  // Limitadores de tentativas com falha (login e troca de senha), um conjunto
  // por app: o contador fica em memória (Seção 10).
  app.locals[CHAVE_LIMITADORES] = criarLimitadoresTentativas(limiteTentativas);
  // Cache-Control: no-store em TODAS as respostas (Issue #127, RNF06): o
  // navegador não guarda o JSON com dados de estudantes. Primeiro middleware,
  // para valer também no preflight, nos erros e nas rotas públicas.
  app.use(impedirCache);
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
