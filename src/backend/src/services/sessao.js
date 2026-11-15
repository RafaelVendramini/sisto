// Verificação da sessão (token JWT) a cada requisição — Sisto (Issue #11).
//
// - RNF03: token JWT HS256 com validade de 8 horas, sem refresh.
// - RN09: o status do usuário é consultado no banco A CADA requisição;
//   usuário bloqueado, desativado ou inexistente perde o acesso na hora,
//   mesmo que o token ainda não tenha expirado.
// - O perfil devolvido é o que está no banco (não o do token): uma mudança de
//   perfil feita pela Gestão vale já na requisição seguinte.
// - RNF06: uma única mensagem genérica para todo 401 (não revela se o token
//   expirou, é inválido, se a conta foi bloqueada/desativada ou se a senha
//   foi trocada depois da emissão do token).
// - RN12 (Issue #18): token emitido antes da última troca de senha (ou no
//   mesmo segundo dela) é rejeitado — ver tokenEmitidoAposTrocaDeSenha.
// - RN10 (Issue #18): a sessão informa se há troca de senha pendente; o
//   bloqueio (403) das demais rotas fica em middlewares/autenticacao.js.
import jwt from 'jsonwebtoken';
import prisma from '../lib/prisma.js';
import { ErroHttp } from '../lib/erros.js';
import {
  ALGORITMO_JWT,
  VALIDADE_TOKEN,
  obterSegredoJwt,
  tokenEmitidoAposTrocaDeSenha,
} from './auth.js';

/** Mensagem única para qualquer falha de autenticação em rota protegida. */
export const MENSAGEM_NAO_AUTENTICADO = 'Não autenticado. Faça login novamente.';

/** Erro 401 padrão, com o cabeçalho WWW-Authenticate exigido pelo HTTP. */
export function erroNaoAutenticado() {
  return new ErroHttp(401, MENSAGEM_NAO_AUTENTICADO, {
    cabecalhos: { 'WWW-Authenticate': 'Bearer' },
  });
}

function ehIdValido(valor) {
  return Number.isSafeInteger(valor) && valor > 0;
}

/**
 * Valida o token e confirma que o usuário existe, está ATIVO e não trocou a
 * senha depois da emissão do token (RN09, RN12).
 * @param {string | null | undefined} token JWT sem o prefixo "Bearer"
 * @param {object} [deps]
 * @param {object} [deps.db] client Prisma (injetável em testes)
 * @param {Record<string, string | undefined>} [deps.env]
 * @returns {Promise<{ id: number, perfil: string, trocaSenhaObrigatoria: boolean }>}
 *   dados mínimos do usuário (perfil e troca pendente lidos do banco)
 * @throws {ErroHttp} 401 para token ausente/inválido/expirado, usuário não ativo
 *   ou token anterior à última troca de senha.
 *   Segredo mal configurado ou falha do banco lançam erro comum (500 genérico).
 */
export async function verificarSessao(token, { db = prisma, env = process.env } = {}) {
  if (typeof token !== 'string' || token === '') {
    throw erroNaoAutenticado();
  }

  const segredo = obterSegredoJwt(env);

  let payload;
  try {
    // Algoritmo fixo: recusa "alg: none" e troca de algoritmo (ex.: HS512).
    // maxAge reforça a validade de 8h mesmo que um token traga "exp" maior.
    payload = jwt.verify(token, segredo, {
      algorithms: [ALGORITMO_JWT],
      maxAge: VALIDADE_TOKEN,
    });
  } catch {
    throw erroNaoAutenticado();
  }

  // Os tokens emitidos pelo login sempre têm id inteiro, iat e exp.
  if (
    !payload ||
    typeof payload !== 'object' ||
    !ehIdValido(payload.id) ||
    typeof payload.exp !== 'number' ||
    typeof payload.iat !== 'number'
  ) {
    throw erroNaoAutenticado();
  }

  const usuario = await db.usuario.findUnique({
    where: { id: payload.id },
    select: {
      id: true,
      perfil: true,
      status: true,
      troca_senha_obrigatoria: true,
      senha_alterada_em: true,
    },
  });

  if (!usuario || usuario.status !== 'ATIVO') {
    throw erroNaoAutenticado();
  }

  if (!tokenEmitidoAposTrocaDeSenha(payload.iat, usuario.senha_alterada_em)) {
    throw erroNaoAutenticado();
  }

  return {
    id: usuario.id,
    perfil: usuario.perfil,
    trocaSenhaObrigatoria: usuario.troca_senha_obrigatoria === true,
  };
}
