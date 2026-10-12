// Verificação da sessão (token JWT) a cada requisição — Sisto (Issue #11).
//
// - RNF03: token JWT HS256 com validade de 8 horas, sem refresh.
// - RN09: o status do usuário é consultado no banco A CADA requisição;
//   usuário bloqueado, desativado ou inexistente perde o acesso na hora,
//   mesmo que o token ainda não tenha expirado.
// - O perfil devolvido é o que está no banco (não o do token): uma mudança de
//   perfil feita pela Gestão vale já na requisição seguinte.
// - RNF06: uma única mensagem genérica para todo 401 (não revela se o token
//   expirou, é inválido ou se a conta foi bloqueada/desativada).
import jwt from 'jsonwebtoken';
import prisma from '../lib/prisma.js';
import { ErroHttp } from '../lib/erros.js';
import { ALGORITMO_JWT, VALIDADE_TOKEN, obterSegredoJwt } from './auth.js';

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
 * Valida o token e confirma que o usuário existe e está ATIVO.
 * @param {string | null | undefined} token JWT sem o prefixo "Bearer"
 * @param {object} [deps]
 * @param {object} [deps.db] client Prisma (injetável em testes)
 * @param {Record<string, string | undefined>} [deps.env]
 * @returns {Promise<{ id: number, perfil: string }>} dados mínimos do usuário (perfil do banco)
 * @throws {ErroHttp} 401 para token ausente/inválido/expirado ou usuário não ativo.
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

  // Os tokens emitidos pelo login sempre têm id inteiro e exp.
  if (
    !payload ||
    typeof payload !== 'object' ||
    !ehIdValido(payload.id) ||
    typeof payload.exp !== 'number'
  ) {
    throw erroNaoAutenticado();
  }

  const usuario = await db.usuario.findUnique({
    where: { id: payload.id },
    select: { id: true, perfil: true, status: true },
  });

  if (!usuario || usuario.status !== 'ATIVO') {
    throw erroNaoAutenticado();
  }

  return { id: usuario.id, perfil: usuario.perfil };
}
