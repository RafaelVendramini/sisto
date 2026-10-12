// Cadastro e listagem de usuários — Sisto (Issue #12).
//
// - RF01: cadastro de usuários autorizados com perfil e senha temporária.
// - RN10: senha temporária com no mínimo 8 caracteres (definida pela Gestão);
//   não há troca obrigatória no primeiro acesso.
// - RNF03: senha armazenada somente como hash bcrypt.
// - RN07: o usuário é sempre criado com status ATIVO.
// - RNF06: nenhuma resposta inclui senha_hash (select explícito); nada de
//   senha ou e-mail em mensagens de erro ou logs.
// - RN01: a restrição ao perfil GESTAO é aplicada nas rotas (permitirPerfis).
import { Perfil, StatusUsuario } from '@prisma/client';
import prisma from '../lib/prisma.js';
import { ErroHttp } from '../lib/erros.js';
import { normalizarEmail } from './email.js';
import { gerarHashSenha, mensagemPoliticaSenha } from './senha.js';

/**
 * Campos usados do corpo do POST /usuarios. Outros campos são IGNORADOS
 * (decisão do Rafael na #12): o status é sempre ATIVO, o id vem do banco e o
 * senha_hash é sempre gerado a partir da senha.
 */
export const CAMPOS_CADASTRO = Object.freeze(['nome', 'email', 'perfil', 'senha']);

/** Perfis aceitos: os valores do enum Perfil (ex.: GESTAO, TECNICO_ADMINISTRATIVO). */
export const PERFIS_VALIDOS = Object.freeze(Object.values(Perfil));

/**
 * Limite TÉCNICO defensivo do tamanho do nome (após trim), contra entradas
 * abusivas. Não é regra de negócio do SSD (não há RN sobre tamanho de nome);
 * mantido por decisão do Rafael na #12.
 */
export const TAMANHO_MAXIMO_NOME = 150;

/** Limite prático de tamanho de um endereço de e-mail (RFC 5321). */
export const TAMANHO_MAXIMO_EMAIL = 254;

/**
 * Validação simples de formato: parte local, "@", domínio com ao menos um
 * ponto; sem espaços e sem um segundo "@".
 */
const REGEX_EMAIL = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

export const MENSAGEM_EMAIL_DUPLICADO = 'Já existe um usuário cadastrado com este e-mail.';

/** Campos devolvidos ao cliente — nunca senha_hash (RNF06). */
export const SELECAO_USUARIO_PUBLICO = Object.freeze({
  id: true,
  nome: true,
  email: true,
  perfil: true,
  status: true,
});

function ehTextoPreenchido(valor) {
  return typeof valor === 'string' && valor.trim() !== '';
}

/**
 * Valida e normaliza o corpo do cadastro.
 * @param {unknown} corpo
 * @returns {{ nome: string, email: string, perfil: string, senha: string }}
 * @throws {ErroHttp} 400 com mensagem clara (nunca contém a senha nem o e-mail)
 */
export function validarCadastroUsuario(corpo) {
  if (!corpo || typeof corpo !== 'object' || Array.isArray(corpo)) {
    throw new ErroHttp(400, 'Envie um objeto JSON com nome, email, perfil e senha.');
  }

  // Somente os campos de CAMPOS_CADASTRO são lidos; qualquer outro (status,
  // id, senha_hash, confirmarSenha...) é ignorado e nunca chega ao banco.
  const { nome, email, perfil, senha } = corpo;

  const faltando = [];
  if (!ehTextoPreenchido(nome)) faltando.push('nome');
  if (!ehTextoPreenchido(email)) faltando.push('email');
  if (!ehTextoPreenchido(perfil)) faltando.push('perfil');
  if (typeof senha !== 'string' || senha === '') faltando.push('senha');
  if (faltando.length > 0) {
    throw new ErroHttp(400, `Informe ${faltando.join(', ')} (texto não vazio).`);
  }

  const nomeLimpo = nome.trim();
  if (nomeLimpo.length > TAMANHO_MAXIMO_NOME) {
    throw new ErroHttp(400, `O nome deve ter no máximo ${TAMANHO_MAXIMO_NOME} caracteres.`);
  }

  const emailNormalizado = normalizarEmail(email);
  if (emailNormalizado.length > TAMANHO_MAXIMO_EMAIL || !REGEX_EMAIL.test(emailNormalizado)) {
    throw new ErroHttp(400, 'Informe um e-mail em formato válido.');
  }

  if (!PERFIS_VALIDOS.includes(perfil)) {
    throw new ErroHttp(400, `Perfil inválido. Valores aceitos: ${PERFIS_VALIDOS.join(', ')}.`);
  }

  const problemaSenha = mensagemPoliticaSenha(senha);
  if (problemaSenha) {
    throw new ErroHttp(400, problemaSenha);
  }

  return { nome: nomeLimpo, email: emailNormalizado, perfil, senha };
}

function ehViolacaoDeUnicidade(erro) {
  return erro?.code === 'P2002';
}

/**
 * Cadastra um usuário com status ATIVO (RF01, RN10, RNF03).
 * @param {unknown} corpo corpo da requisição
 * @param {object} [deps]
 * @param {object} [deps.db] client Prisma (injetável em testes)
 * @param {(senha: string) => Promise<string>} [deps.gerarHash] gera o hash bcrypt
 * @returns {Promise<{ id: number, nome: string, email: string, perfil: string, status: string }>}
 * @throws {ErroHttp} 400 (dados inválidos) ou 409 (e-mail já cadastrado)
 */
export async function cadastrarUsuario(corpo, { db = prisma, gerarHash = gerarHashSenha } = {}) {
  const { nome, email, perfil, senha } = validarCadastroUsuario(corpo);

  // Pré-checagem (evita gastar um hash bcrypt à toa). A corrida entre duas
  // requisições simultâneas é coberta pelo tratamento do P2002 abaixo.
  const existente = await db.usuario.findUnique({ where: { email }, select: { id: true } });
  if (existente) {
    throw new ErroHttp(409, MENSAGEM_EMAIL_DUPLICADO);
  }

  const senha_hash = await gerarHash(senha);

  try {
    return await db.usuario.create({
      data: { nome, email, perfil, senha_hash, status: StatusUsuario.ATIVO },
      select: SELECAO_USUARIO_PUBLICO,
    });
  } catch (erro) {
    if (ehViolacaoDeUnicidade(erro)) {
      throw new ErroHttp(409, MENSAGEM_EMAIL_DUPLICADO);
    }
    throw erro;
  }
}

/**
 * Lista todos os usuários, sem senha_hash, ordenados por nome e depois id
 * (ordem estável mesmo com nomes repetidos).
 * @param {object} [deps]
 * @param {object} [deps.db]
 */
export async function listarUsuarios({ db = prisma } = {}) {
  return db.usuario.findMany({
    select: SELECAO_USUARIO_PUBLICO,
    orderBy: [{ nome: 'asc' }, { id: 'asc' }],
  });
}
