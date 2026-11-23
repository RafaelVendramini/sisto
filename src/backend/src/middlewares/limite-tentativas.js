// Limite de tentativas com falha no login e na troca da própria senha —
// Sisto (Issue #90; SSD 1.8, Seção 12 "Limite de tentativas" e Seção 10).
//
// - POST /auth/login e PUT /conta/senha aceitam até 5 tentativas COM FALHA em
//   15 minutos por chave; acima disso respondem 429 com Retry-After.
// - Só as falhas contam (skipSuccessfulRequests + requestWasSuccessful):
//     login ........ 401 (credenciais inválidas ou usuário sem acesso);
//     troca senha .. 400 (senha atual incorreta ou nova senha inválida).
//   Demais respostas (sucesso, 400 de corpo incompleto no login, 500, o
//   próprio 429) não somam.
// - Chave: login = IP + e-mail informado (normalizado como o login faz);
//   troca de senha = IP + usuário logado (a rota é autenticada). Assim um
//   único e-mail atacado não bloqueia todos os usuários de um IP
//   compartilhado da escola.
// - Contador EM MEMÓRIA (MemoryStore do express-rate-limit): zera quando a
//   API reinicia ou é suspensa no Render (aceito na Seção 10).
// - Limite por IP no login (Issue #134; SSD 1.13, Seção 12): além do limite
//   por IP + e-mail, o POST /auth/login tem um segundo limitador, contado SÓ
//   pelo IP: 100 falhas (401) em 15 minutos. Fecha a brecha de testar uma
//   mesma senha em muitos e-mails diferentes. Valor alto porque a escola sai
//   para a internet por um único IP público. Mesmo critério de falha, mesma
//   mensagem do 429, Retry-After e contador em memória. O primeiro dos dois
//   limites que for atingido recusa. O PUT /conta/senha não tem esse limite.
// - Não bloqueia a conta: o status do usuário não muda (RN07/RN09).
// - A mensagem do 429 é a mesma para qualquer e-mail (não revela se existe).
//
// Os limitadores são criados POR APP (criarApp, em app.js) e guardados em
// app.locals: cada app tem os seus contadores (os testes não vazam estado
// entre si). As rotas usam limitarTentativasLogin/limitarTentativasTrocaSenha,
// que delegam para os limitadores do app que atende a requisição.
import { createHash } from 'node:crypto';
import { rateLimit, ipKeyGenerator } from 'express-rate-limit';
import { normalizarEmail } from '../services/email.js';

/** Tentativas com falha permitidas por janela (SSD 1.8, Seção 12). */
export const LIMITE_TENTATIVAS_COM_FALHA = 5;

/** Falhas no login permitidas por janela só por IP, com qualquer e-mail (SSD 1.13, Seção 12). */
export const LIMITE_FALHAS_LOGIN_POR_IP = 100;

/** Janela de contagem das falhas: 15 minutos (SSD 1.8, Seção 12). */
export const JANELA_TENTATIVAS_MS = 15 * 60 * 1000;

/** Mensagem do 429 — igual para qualquer e-mail (RNF06). */
export const MENSAGEM_MUITAS_TENTATIVAS =
  'Muitas tentativas. Tente novamente em alguns minutos.';

/** Nome da chave em app.locals onde ficam os limitadores do app. */
export const CHAVE_LIMITADORES = 'limitadoresTentativas';

/**
 * Chave do login: IP + e-mail informado, normalizado como em services/auth.js.
 * O e-mail entra como resumo SHA-256 (64 caracteres hexadecimais): a chave tem
 * tamanho fixo mesmo com e-mails enormes (não esgota a memória do contador) e
 * o e-mail não aparece em logs de depuração da biblioteca (RNF06).
 * Corpo sem e-mail texto responde 400 e não conta como falha.
 */
export function chaveTentativasLogin(req) {
  const email = req.body?.email;
  const emailNormalizado = typeof email === 'string' ? normalizarEmail(email) : '';
  const resumoEmail = createHash('sha256').update(emailNormalizado).digest('hex');
  return `${ipKeyGenerator(req.ip)}:${resumoEmail}`;
}

/**
 * Chave do limite só por IP no login (SSD 1.13): o IP do cliente identificado
 * pelo 'trust proxy' (app.js), sem o e-mail. O prefixo separa a chave da do
 * limite por IP + e-mail (cada limitador tem o seu contador).
 */
export function chaveTentativasLoginPorIp(req) {
  return `ip:${ipKeyGenerator(req.ip)}`;
}

/** Chave da troca da própria senha: IP + id do usuário logado (req.usuario). */
export function chaveTentativasTrocaSenha(req) {
  return `${ipKeyGenerator(req.ip)}|usuario:${req.usuario?.id}`;
}

function responderMuitasTentativas(req, res) {
  res.status(429).json({ erro: MENSAGEM_MUITAS_TENTATIVAS });
}

function criarLimitador({ maximo, janelaMs, chave, statusFalha }) {
  return rateLimit({
    windowMs: janelaMs,
    limit: maximo,
    keyGenerator: chave,
    skipSuccessfulRequests: true,
    // "Sucesso" aqui = qualquer resposta que NÃO seja a falha contada.
    requestWasSuccessful: (req, res) => res.statusCode !== statusFalha,
    // Cabeçalhos padrão RateLimit/RateLimit-Policy (draft 7) e, ao exceder,
    // Retry-After (em segundos); sem os antigos X-RateLimit-*.
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: responderMuitasTentativas,
  });
}

/**
 * Cria os limitadores de um app (chamado por criarApp).
 * @param {object} [opcoes] só os testes alteram (produção usa o padrão do SSD)
 * @param {number} [opcoes.maximo] tentativas com falha permitidas na janela
 * @param {number} [opcoes.janelaMs] duração da janela, em milissegundos
 * @param {number} [opcoes.maximoPorIp] falhas no login permitidas só por IP
 * @returns {{ login: Function, loginPorIp: Function, trocaSenha: Function }}
 */
export function criarLimitadoresTentativas({
  maximo = LIMITE_TENTATIVAS_COM_FALHA,
  janelaMs = JANELA_TENTATIVAS_MS,
  maximoPorIp = LIMITE_FALHAS_LOGIN_POR_IP,
} = {}) {
  return {
    login: criarLimitador({ maximo, janelaMs, chave: chaveTentativasLogin, statusFalha: 401 }),
    loginPorIp: criarLimitador({
      maximo: maximoPorIp,
      janelaMs,
      chave: chaveTentativasLoginPorIp,
      statusFalha: 401,
    }),
    trocaSenha: criarLimitador({
      maximo,
      janelaMs,
      chave: chaveTentativasTrocaSenha,
      statusFalha: 400,
    }),
  };
}

function obterLimitadores(req) {
  const limitadores = req.app?.locals?.[CHAVE_LIMITADORES];
  if (!limitadores) {
    // Falha fechada (500): app montado sem criarApp.
    throw new Error('Limitadores de tentativas não configurados (use criarApp).');
  }
  return limitadores;
}

/**
 * POST /auth/login — limite só por IP (100 falhas) e, em seguida, por IP +
 * e-mail (5 falhas). O primeiro atingido recusa com 429. O limite por IP vem
 * antes para que os cabeçalhos RateLimit de uma tentativa aceita continuem
 * sendo os do limite por IP + e-mail (o segundo limitador os sobrescreve).
 * Um 429 de um limitador não conta no outro: só o 401 é falha.
 */
export function limitarTentativasLogin(req, res, next) {
  const limitadores = obterLimitadores(req);
  return limitadores.loginPorIp(req, res, (erro) => {
    if (erro) return next(erro);
    return limitadores.login(req, res, next);
  });
}

/** PUT /conta/senha — limite por IP + usuário (depois de exigirAutenticacao). */
export function limitarTentativasTrocaSenha(req, res, next) {
  return obterLimitadores(req).trocaSenha(req, res, next);
}
