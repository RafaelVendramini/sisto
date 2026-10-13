// CORS — permite que o front-end (React + Vite) chame a API pelo navegador
// (Issue #14). Usa o pacote `cors`, middleware padrão do Express.
//
// Regras:
// - Allowlist de origens em CORS_ORIGIN (lista separada por vírgula). Nunca '*'.
// - Sem CORS_ORIGIN: em desenvolvimento/teste usa http://localhost:5173 (Vite);
//   em produção não libera nenhuma origem (falha fechada) e registra um aviso.
// - Sem credentials: o token JWT vai no cabeçalho Authorization, não em cookie.
// - Deve ser registrado ANTES das rotas e da autenticação global, para que o
//   preflight OPTIONS de qualquer rota responda 204 sem exigir token.
import cors from 'cors';

/** Origem padrão do servidor de desenvolvimento do Vite. */
export const ORIGEM_PADRAO_DESENVOLVIMENTO = 'http://localhost:5173';

/**
 * Normaliza uma entrada de CORS_ORIGIN para o formato de origem enviado pelo
 * navegador (esquema://host[:porta], sem barra final nem caminho).
 * @param {string} valor
 * @returns {string | null} a origem, ou null se inválida (inclusive '*')
 */
function normalizarOrigem(valor) {
  const texto = valor.trim().replace(/\/+$/, '');
  if (!texto || texto.includes('*')) return null;
  try {
    const url = new URL(texto);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    // Só aceita origem "pura": nada de caminho, query, usuário ou senha.
    if (url.pathname !== '/' || url.search || url.hash || url.username || url.password) {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

/**
 * Resolve a lista de origens permitidas.
 * @param {object} [opcoes]
 * @param {string | undefined} [opcoes.corsOrigin] valor de CORS_ORIGIN
 * @param {string | undefined} [opcoes.ambiente] valor de NODE_ENV
 * @param {(mensagem: string) => void} [opcoes.avisar] função de aviso (padrão: console.warn)
 * @returns {string[]} origens permitidas (pode ser vazia = nenhuma liberada)
 */
export function resolverOrigensPermitidas({
  corsOrigin = process.env.CORS_ORIGIN,
  ambiente = process.env.NODE_ENV,
  avisar = (mensagem) => console.warn(mensagem),
} = {}) {
  const bruto = typeof corsOrigin === 'string' ? corsOrigin.trim() : '';

  if (!bruto) {
    if (ambiente === 'production') {
      avisar(
        '[CORS] CORS_ORIGIN não definida em produção: nenhuma origem será liberada para o navegador.',
      );
      return [];
    }
    return [ORIGEM_PADRAO_DESENVOLVIMENTO];
  }

  const entradas = bruto.split(',').filter((parte) => parte.trim() !== '');
  const origens = [];
  let invalidas = 0;
  for (const entrada of entradas) {
    const origem = normalizarOrigem(entrada);
    if (origem) {
      if (!origens.includes(origem)) origens.push(origem);
    } else {
      invalidas += 1;
    }
  }

  if (invalidas > 0) {
    avisar(
      `[CORS] ${invalidas} entrada(s) inválida(s) em CORS_ORIGIN foram ignoradas (use esquema://host[:porta], sem '*').`,
    );
  }
  if (origens.length === 0) {
    avisar('[CORS] Nenhuma origem válida em CORS_ORIGIN: nenhuma origem será liberada.');
  }
  return origens;
}

/**
 * Cria o middleware de CORS com a allowlist resolvida no momento da chamada.
 * @param {Parameters<typeof resolverOrigensPermitidas>[0]} [opcoes]
 */
export function criarMiddlewareCors(opcoes) {
  const origensPermitidas = resolverOrigensPermitidas(opcoes);

  return cors({
    // Lista explícita: o pacote só devolve Access-Control-Allow-Origin quando a
    // origem da requisição está na lista (e adiciona Vary: Origin).
    origin: origensPermitidas,
    // Métodos usados pela API (Seção 12 do SSD), incluindo
    // PATCH /ocorrencias/{id}/status. Não há DELETE no SSD.
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    // Permite ao front-end ler o WWW-Authenticate das respostas 401.
    exposedHeaders: ['WWW-Authenticate'],
    credentials: false,
    optionsSuccessStatus: 204,
  });
}
