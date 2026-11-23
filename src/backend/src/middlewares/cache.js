// Cache das respostas da API — Sisto (Issue #127, RNF06).
//
// As respostas trazem dados pessoais de estudantes (ex.: GET /estudantes,
// GET /ocorrencias/{id}). Sem um Cache-Control explícito, o navegador pode
// guardar esse JSON em cache, e num computador compartilhado da escola os
// dados continuariam no disco depois do logout. `no-store` proíbe o navegador
// (e qualquer proxy no caminho) de guardar a resposta.
//
// Registrado em app.js ANTES do CORS e das rotas: vale para todas as
// respostas, inclusive preflight, erros (400/401/403/404/409/429/500) e as
// rotas públicas de /auth.

/** Valor do cabeçalho Cache-Control de todas as respostas da API. */
export const VALOR_CACHE_CONTROL = 'no-store';

/** Define Cache-Control: no-store na resposta e segue para o próximo middleware. */
export function impedirCache(req, res, next) {
  res.set('Cache-Control', VALOR_CACHE_CONTROL);
  next();
}
