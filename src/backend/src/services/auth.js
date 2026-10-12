// Autenticação por e-mail e senha — Sisto (Issue #10).
//
// - RF02: e-mail (único) é o identificador de login.
// - RNF03: senha comparada com o hash bcrypt; JWT com validade de 8 horas,
//   sem refresh. Segredo lido de JWT_SECRET (.env).
// - RN09 / RN07: somente usuários ATIVO recebem token.
// - RNF06: a mesma mensagem genérica para e-mail inexistente, senha incorreta
//   e usuário bloqueado/desativado — não revela quais e-mails existem nem o
//   status da conta. Nada de senha, token ou e-mail em logs.
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import prisma from '../lib/prisma.js';
import { ErroHttp } from '../lib/erros.js';
import { normalizarEmail } from './email.js';
import { TAMANHO_MAXIMO_BYTES_SENHA } from './senha.js';

/** RNF03: validade fixa do token (não configurável, para não violar o SSD). */
export const VALIDADE_TOKEN = '8h';

/** Algoritmo de assinatura explícito (evita aceitar/emitir outro algoritmo). */
export const ALGORITMO_JWT = 'HS256';

/** Tamanho mínimo do segredo: abaixo disso o HS256 fica vulnerável a força bruta. */
export const TAMANHO_MINIMO_SEGREDO = 32;

/** Prefixo dos valores de exemplo do .env.example (públicos): recusados como segredo. */
export const PREFIXO_VALOR_EXEMPLO = 'TROQUE_';

/** Mensagem única para qualquer falha de credencial (RNF06). */
export const MENSAGEM_CREDENCIAIS_INVALIDAS = 'E-mail ou senha inválidos.';

/**
 * Hash bcrypt (custo 12) de um valor aleatório descartado — ninguém conhece a
 * "senha" correspondente. Usado quando o e-mail não existe, para que o tempo
 * de resposta seja semelhante ao de um usuário existente (dificulta descobrir
 * e-mails cadastrados pelo tempo de resposta).
 */
const HASH_FICTICIO = '$2b$12$T4ZmNL05v6MM5lGoIa2rV.F/Z.6QkBQ1rhDadDO4.pDyABQq02AqC';

/**
 * Lê e valida o segredo do JWT. Lança erro comum (vira 500 genérico no
 * middleware de erros); a mensagem nunca contém o valor.
 * @param {Record<string, string | undefined>} env
 */
export function obterSegredoJwt(env = process.env) {
  const segredo = env.JWT_SECRET;
  if (
    typeof segredo !== 'string' ||
    segredo.length < TAMANHO_MINIMO_SEGREDO ||
    segredo.toUpperCase().startsWith(PREFIXO_VALOR_EXEMPLO)
  ) {
    throw new Error(
      `JWT_SECRET ausente, com menos de ${TAMANHO_MINIMO_SEGREDO} caracteres ou com o valor de exemplo do .env.example. Configure o .env do back-end. Login indisponível.`,
    );
  }
  return segredo;
}

function ehTextoPreenchido(valor) {
  return typeof valor === 'string' && valor.trim() !== '';
}

/**
 * Valida o corpo da requisição de login. Não aplica a política de tamanho
 * mínimo da senha (RN10 é regra de cadastro): senha curta só não confere.
 * @returns {{ email: string, senha: string }}
 */
export function validarEntradaLogin(corpo) {
  const { email, senha } = corpo ?? {};
  const faltando = [];
  if (!ehTextoPreenchido(email)) faltando.push('email');
  if (typeof senha !== 'string' || senha === '') faltando.push('senha');
  if (faltando.length > 0) {
    throw new ErroHttp(400, `Informe ${faltando.join(' e ')} (texto não vazio).`);
  }
  return { email: normalizarEmail(email), senha };
}

/**
 * Autentica o usuário e emite o JWT.
 * @param {unknown} corpo corpo da requisição ({ email, senha })
 * @param {object} [deps]
 * @param {object} [deps.db] client Prisma (injetável em testes)
 * @param {Record<string, string | undefined>} [deps.env]
 * @returns {Promise<{ token: string, usuario: { id: number, nome: string, perfil: string } }>}
 * @throws {ErroHttp} 400 (entrada inválida) ou 401 (credenciais inválidas / usuário não ativo)
 */
export async function autenticar(corpo, { db = prisma, env = process.env } = {}) {
  const { email, senha } = validarEntradaLogin(corpo);
  // Falha antes de consultar o banco se o servidor não puder emitir tokens.
  const segredo = obterSegredoJwt(env);

  const usuario = await db.usuario.findUnique({
    where: { email },
    select: { id: true, nome: true, perfil: true, status: true, senha_hash: true },
  });

  // Sempre executa um bcrypt.compare (hash real ou fictício), inclusive para
  // usuário bloqueado/desativado, para manter o tempo de resposta uniforme.
  // Senha acima de 72 bytes nunca confere: o cadastro não aceita esse tamanho
  // e o bcrypt ignoraria os bytes excedentes.
  const senhaDentroDoLimite = Buffer.byteLength(senha, 'utf8') <= TAMANHO_MAXIMO_BYTES_SENHA;
  const confere = await bcrypt.compare(senha, usuario?.senha_hash ?? HASH_FICTICIO);

  if (!usuario || !confere || !senhaDentroDoLimite || usuario.status !== 'ATIVO') {
    throw new ErroHttp(401, MENSAGEM_CREDENCIAIS_INVALIDAS);
  }

  const token = jwt.sign({ id: usuario.id, perfil: usuario.perfil }, segredo, {
    algorithm: ALGORITMO_JWT,
    expiresIn: VALIDADE_TOKEN,
  });

  // Nunca devolve senha_hash nem status.
  return { token, usuario: { id: usuario.id, nome: usuario.nome, perfil: usuario.perfil } };
}
