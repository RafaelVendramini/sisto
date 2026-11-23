// Diagnóstico TEMPORÁRIO do 'trust proxy' (Issue #127, pendência de
// docs/deploy.md).
//
// Objetivo: conferir no Render se o 'trust proxy' de app.js faz o req.ip ser
// o IP real do cliente, e não o de um proxy. A conferência de 23/11/2026
// mostrou 3 endereços no X-Forwarded-For (cliente, borda Cloudflare,
// balanceador interno do Render): com 'trust proxy' = 1 o req.ip era o
// balanceador; por isso o valor passou a ser 3. Para isso, cada
// POST /auth/login registra no console UMA linha com:
//   - o req.ip calculado pelo Express;
//   - a quantidade de endereços no cabeçalho X-Forwarded-For;
//   - o próprio cabeçalho X-Forwarded-For (os IPs).
//
// - Desligado por padrão: só registra com DIAGNOSTICO_PROXY=1 (valor exato).
//   A variável é lida a cada requisição; basta removê-la no Render (e
//   reiniciar) para desligar.
// - NUNCA registra e-mail, senha nem o corpo da requisição (RNF06). O IP é
//   dado pessoal: o diagnóstico deve ficar ligado só pelo tempo da conferência.
// - O X-Forwarded-For vem do cliente (que pode inventar o começo dele): o
//   valor é cortado em TAMANHO_MAXIMO_CABECALHO caracteres e a linha é gerada
//   com JSON.stringify, que escapa quebras de linha e caracteres de controle
//   (um cabeçalho forjado não cria linhas falsas no log).

/** Nome da variável de ambiente que liga o diagnóstico. */
export const VARIAVEL_DIAGNOSTICO_PROXY = 'DIAGNOSTICO_PROXY';

/** Prefixo da linha no log, para achá-la no painel do Render. */
export const PREFIXO_DIAGNOSTICO_PROXY = '[diagnostico-proxy]';

/** Limite do trecho do X-Forwarded-For registrado (evita linhas enormes no log). */
export const TAMANHO_MAXIMO_CABECALHO = 512;

/**
 * Quantidade de endereços (não vazios) num valor de X-Forwarded-For.
 * @param {string | undefined} valor
 * @returns {number}
 */
export function contarEnderecos(valor) {
  if (typeof valor !== 'string') return 0;
  return valor.split(',').filter((parte) => parte.trim() !== '').length;
}

/**
 * Cria o middleware de diagnóstico.
 * @param {object} [opcoes] só os testes alteram
 * @param {Record<string, string | undefined>} [opcoes.env] padrão: process.env
 * @param {(linha: string) => void} [opcoes.registrar] padrão: console.info
 */
export function criarDiagnosticoProxy({
  env = process.env,
  registrar = (linha) => console.info(linha),
} = {}) {
  return function registrarDiagnosticoProxy(req, res, next) {
    if (env[VARIAVEL_DIAGNOSTICO_PROXY] === '1') {
      // Só o cabeçalho e o req.ip: o corpo (e-mail e senha) nunca é lido aqui.
      const cabecalho = req.get('X-Forwarded-For');
      const dados = {
        ip: req.ip,
        quantidadeEnderecos: contarEnderecos(cabecalho),
        xForwardedFor:
          typeof cabecalho === 'string' ? cabecalho.slice(0, TAMANHO_MAXIMO_CABECALHO) : null,
      };
      registrar(`${PREFIXO_DIAGNOSTICO_PROXY} ${JSON.stringify(dados)}`);
    }
    next();
  };
}

/** Middleware padrão (process.env e console.info), usado em routes/auth.js. */
export const registrarDiagnosticoProxy = criarDiagnosticoProxy();
