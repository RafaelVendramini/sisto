// Middlewares de autenticação JWT e de permissão por perfil — Sisto (Issue #11).
// A regra (token válido + usuário ativo no banco, RN09) fica em
// services/sessao.js; aqui só há a parte HTTP.
import { Perfil } from '@prisma/client';
import { ErroHttp } from '../lib/erros.js';
import { erroNaoAutenticado, verificarSessao } from '../services/sessao.js';

/** Mensagem do 403 quando o perfil não tem acesso à rota (RN01 / RF14). */
export const MENSAGEM_PERFIL_SEM_PERMISSAO = 'Acesso não permitido para o seu perfil.';

const PERFIS_VALIDOS = new Set(Object.values(Perfil));

// "Bearer <token>" (esquema sem distinção de maiúsculas, RFC 6750); o token
// só pode ter caracteres de base64url e pontos.
const REGEX_BEARER = /^Bearer +([A-Za-z0-9\-._~+/]+=*) *$/i;

/**
 * Extrai o token do cabeçalho Authorization.
 * @param {string | undefined} cabecalho
 * @returns {string | null} o token, ou null se ausente/malformado
 */
export function extrairTokenBearer(cabecalho) {
  if (typeof cabecalho !== 'string') return null;
  const resultado = REGEX_BEARER.exec(cabecalho);
  return resultado ? resultado[1] : null;
}

/**
 * Exige um JWT válido de usuário ATIVO (RN09, RNF03). Em caso de sucesso,
 * define req.usuario = { id, perfil } (perfil lido do banco).
 * Aplicado globalmente em routes/index.js a tudo que não é /auth/*.
 */
export async function exigirAutenticacao(req, res, next) {
  const token = extrairTokenBearer(req.get('authorization'));
  req.usuario = await verificarSessao(token);
  next();
}

/**
 * Cria um middleware que só deixa passar os perfis informados (RN01 / RF14,
 * matriz da Seção 4 do SSD). Deve vir depois de exigirAutenticacao.
 *
 *   router.post('/usuarios', permitirPerfis('GESTAO'), controller);
 *
 * @param {...(string | string[])} perfis valores do enum Perfil
 * @throws {Error} na criação, se a lista estiver vazia ou tiver perfil inexistente
 *   (erro de programação, detectado ao carregar as rotas)
 */
export function permitirPerfis(...perfis) {
  const lista = perfis.flat();
  if (lista.length === 0) {
    throw new Error('permitirPerfis: informe ao menos um perfil.');
  }
  const invalidos = lista.filter((perfil) => !PERFIS_VALIDOS.has(perfil));
  if (invalidos.length > 0) {
    throw new Error(
      `permitirPerfis: perfil inexistente (${invalidos.join(', ')}). Válidos: ${[...PERFIS_VALIDOS].join(', ')}.`,
    );
  }
  const permitidos = new Set(lista);

  return function verificarPerfil(req, res, next) {
    if (!req.usuario) {
      // Usado sem exigirAutenticacao antes: falha fechada.
      throw erroNaoAutenticado();
    }
    if (!permitidos.has(req.usuario.perfil)) {
      throw new ErroHttp(403, MENSAGEM_PERFIL_SEM_PERMISSAO);
    }
    next();
  };
}
