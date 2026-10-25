// Cadastro, listagem e edição de usuários — Sisto (Issues #12 e #13).
//
// - RF01: cadastro de usuários autorizados com perfil e senha temporária.
// - RN10 (SSD v1.6, Issue #37): senha temporária com no mínimo 8 caracteres,
//   definida pela Gestão; o usuário é criado com troca_senha_obrigatoria =
//   true e precisa trocá-la no primeiro login (fluxo de PUT /conta/senha da
//   #18). Usuários já cadastrados não são alterados.
// - RNF03: senha armazenada somente como hash bcrypt.
// - RN07: o usuário é sempre criado com status ATIVO.
// - RNF06: nenhuma resposta inclui senha_hash (select explícito); nada de
//   senha ou e-mail em mensagens de erro ou logs.
// - RN01: a restrição ao perfil GESTAO é aplicada nas rotas (permitirPerfis).
//
// Edição, bloqueio, desativação e reativação (Issue #13):
// - RF04 / RN07: status ATIVO, BLOQUEADO ou DESATIVADO; reativar = voltar a
//   ATIVO. O usuário nunca é excluído (não há DELETE).
// - RN09: o corte imediato do acesso vem do middleware de autenticação (#11),
//   que consulta o status no banco a cada requisição.
// - RN11 (SSD v1.6, Issue #37): o sistema mantém sempre ao menos DOIS
//   usuários GESTAO com status ATIVO (um pode redefinir a senha do outro).
//   Nenhuma edição pode reduzir esse número a menos de dois; a Gestão também
//   não bloqueia, desativa nem altera o próprio perfil (409).
import { Perfil, Prisma, StatusUsuario } from '@prisma/client';
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

// Validações por campo, compartilhadas entre o cadastro (#12) e a edição (#13).
// Recebem um valor já verificado como texto não vazio (o cadastro verifica
// isso antes, para listar todos os campos ausentes de uma vez).

/** Nome: trim e limite técnico de tamanho. @returns {string} nome sem espaços nas pontas */
function validarNome(nome) {
  const nomeLimpo = nome.trim();
  if (nomeLimpo.length > TAMANHO_MAXIMO_NOME) {
    throw new ErroHttp(400, `O nome deve ter no máximo ${TAMANHO_MAXIMO_NOME} caracteres.`);
  }
  return nomeLimpo;
}

/** E-mail: normaliza (trim + minúsculas) e valida formato e tamanho. @returns {string} */
function validarEmail(email) {
  const emailNormalizado = normalizarEmail(email);
  if (emailNormalizado.length > TAMANHO_MAXIMO_EMAIL || !REGEX_EMAIL.test(emailNormalizado)) {
    throw new ErroHttp(400, 'Informe um e-mail em formato válido.');
  }
  return emailNormalizado;
}

/** Perfil: somente os valores exatos do enum Perfil. */
function validarPerfil(perfil) {
  if (!PERFIS_VALIDOS.includes(perfil)) {
    throw new ErroHttp(400, `Perfil inválido. Valores aceitos: ${PERFIS_VALIDOS.join(', ')}.`);
  }
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

  const nomeLimpo = validarNome(nome);
  const emailNormalizado = validarEmail(email);
  validarPerfil(perfil);

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
 * Cadastra um usuário com status ATIVO e troca de senha obrigatória no
 * primeiro login (RF01, RN10, RNF03). A resposta não muda: o campo
 * troca_senha_obrigatoria não é devolvido (SELECAO_USUARIO_PUBLICO).
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
      data: {
        nome,
        email,
        perfil,
        senha_hash,
        status: StatusUsuario.ATIVO,
        // RN10: a senha definida pela Gestão é temporária.
        troca_senha_obrigatoria: true,
      },
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

// ---------------------------------------------------------------------------
// Edição (PUT /usuarios/{id}) — Issue #13
// ---------------------------------------------------------------------------

/**
 * Campos aceitos no corpo do PUT /usuarios/{id}. Outros campos (id,
 * senha, senha_hash...) são IGNORADOS, como no cadastro; a troca de senha
 * não faz parte desta Story.
 */
export const CAMPOS_EDICAO = Object.freeze(['nome', 'email', 'perfil', 'status']);

/** Status aceitos: os valores do enum StatusUsuario (ATIVO, BLOQUEADO, DESATIVADO). */
export const STATUS_VALIDOS = Object.freeze(Object.values(StatusUsuario));

/** Maior valor de uma coluna Int do PostgreSQL (tipo do id, Seção 11). */
const MAIOR_ID = 2_147_483_647;

/** Tentativas da transação serializável antes de desistir com 409. */
const TENTATIVAS_TRANSACAO = 3;

export const MENSAGEM_ID_INVALIDO = 'Identificador de usuário inválido.';
export const MENSAGEM_USUARIO_NAO_ENCONTRADO = 'Usuário não encontrado.';
export const MENSAGEM_ALTERAR_PROPRIO_ACESSO =
  'Você não pode bloquear, desativar ou alterar o perfil do seu próprio usuário.';
/** RN11: mínimo de usuários GESTAO com status ATIVO. */
export const MINIMO_GESTOES_ATIVAS = 2;

export const MENSAGEM_MINIMO_GESTOES_ATIVAS =
  'O sistema precisa de ao menos dois usuários Gestão ativos. Cadastre ou reative outro usuário Gestão antes de bloquear, desativar ou alterar o perfil deste.';
export const MENSAGEM_CONFLITO_CONCORRENTE =
  'O usuário foi alterado por outra operação ao mesmo tempo. Tente novamente.';

/**
 * Converte o id da URL. Aceita apenas inteiro positivo em notação decimal
 * simples ("1", "42"), dentro do limite do Int do banco.
 * @param {unknown} valor
 * @returns {number}
 * @throws {ErroHttp} 400
 */
export function validarIdUsuario(valor) {
  if (typeof valor !== 'string' || !/^[1-9][0-9]{0,9}$/.test(valor)) {
    throw new ErroHttp(400, MENSAGEM_ID_INVALIDO);
  }
  const id = Number(valor);
  if (id > MAIOR_ID) {
    throw new ErroHttp(400, MENSAGEM_ID_INVALIDO);
  }
  return id;
}

/**
 * Valida e normaliza o corpo da edição. Cada campo é opcional, mas ao menos
 * um dos CAMPOS_EDICAO deve vir; um campo presente (inclusive null) é
 * validado com as mesmas regras do cadastro.
 * @param {unknown} corpo
 * @returns {{ nome?: string, email?: string, perfil?: string, status?: string }}
 * @throws {ErroHttp} 400 (a mensagem nunca contém o e-mail enviado)
 */
export function validarEdicaoUsuario(corpo) {
  if (!corpo || typeof corpo !== 'object' || Array.isArray(corpo)) {
    throw new ErroHttp(
      400,
      `Envie um objeto JSON com ao menos um dos campos: ${CAMPOS_EDICAO.join(', ')}.`,
    );
  }

  const presentes = CAMPOS_EDICAO.filter((campo) => corpo[campo] !== undefined);
  if (presentes.length === 0) {
    throw new ErroHttp(400, `Informe ao menos um dos campos: ${CAMPOS_EDICAO.join(', ')}.`);
  }

  // Somente os CAMPOS_EDICAO são lidos; qualquer outro é ignorado.
  const { nome, email, perfil, status } = corpo;
  const dados = {};

  if (nome !== undefined) {
    if (!ehTextoPreenchido(nome)) throw new ErroHttp(400, 'Informe nome (texto não vazio).');
    dados.nome = validarNome(nome);
  }
  if (email !== undefined) {
    if (!ehTextoPreenchido(email)) throw new ErroHttp(400, 'Informe email (texto não vazio).');
    dados.email = validarEmail(email);
  }
  if (perfil !== undefined) {
    validarPerfil(perfil);
    dados.perfil = perfil;
  }
  if (status !== undefined) {
    if (!STATUS_VALIDOS.includes(status)) {
      throw new ErroHttp(400, `Status inválido. Valores aceitos: ${STATUS_VALIDOS.join(', ')}.`);
    }
    dados.status = status;
  }

  return dados;
}

function ehGestaoAtiva({ perfil, status }) {
  return perfil === Perfil.GESTAO && status === StatusUsuario.ATIVO;
}

/**
 * Verificações que dependem do banco + atualização, dentro da transação.
 * @param {object} tx client da transação
 * @param {number} id
 * @param {object} dados campos já validados
 */
async function verificarEAtualizar(tx, id, dados) {
  const atual = await tx.usuario.findUnique({
    where: { id },
    select: { id: true, email: true, perfil: true, status: true },
  });
  if (!atual) {
    throw new ErroHttp(404, MENSAGEM_USUARIO_NAO_ENCONTRADO);
  }

  // E-mail único: manter o próprio e-mail não é conflito.
  if (dados.email !== undefined && dados.email !== atual.email) {
    const dono = await tx.usuario.findUnique({
      where: { email: dados.email },
      select: { id: true },
    });
    if (dono && dono.id !== id) {
      throw new ErroHttp(409, MENSAGEM_EMAIL_DUPLICADO);
    }
  }

  // RN11 — ao menos dois GESTAO ATIVO: se este usuário é Gestão ativa e
  // deixaria de ser (rebaixado, bloqueado ou desativado), precisam restar ao
  // menos MINIMO_GESTOES_ATIVAS outras Gestões ativas depois da edição.
  const depois = {
    perfil: dados.perfil ?? atual.perfil,
    status: dados.status ?? atual.status,
  };
  if (ehGestaoAtiva(atual) && !ehGestaoAtiva(depois)) {
    const outrasGestoesAtivas = await tx.usuario.count({
      where: { perfil: Perfil.GESTAO, status: StatusUsuario.ATIVO, id: { not: id } },
    });
    if (outrasGestoesAtivas < MINIMO_GESTOES_ATIVAS) {
      throw new ErroHttp(409, MENSAGEM_MINIMO_GESTOES_ATIVAS);
    }
  }

  return tx.usuario.update({ where: { id }, data: dados, select: SELECAO_USUARIO_PUBLICO });
}

/**
 * Edita um usuário: nome, e-mail, perfil e/ou status (RF01, RF04, RN07).
 *
 * Concorrência: a leitura, as verificações (e-mail único, mínimo de duas
 * Gestões ativas — RN11) e o update rodam numa transação SERIALIZABLE. Duas
 * edições simultâneas que, juntas, deixariam o sistema com menos de duas
 * Gestões ativas (ex.: com três Gestões ativas, cada uma rebaixa uma
 * Gestão diferente — isoladas, ambas passariam) não passam ambas: o PostgreSQL
 * aborta uma delas (SQLSTATE 40001, que o Prisma expõe como P2034); ela é
 * repetida e então esbarra na regra. Esgotadas as tentativas, responde 409.
 *
 * @param {unknown} idUrl id recebido na URL (texto)
 * @param {unknown} corpo corpo da requisição
 * @param {{ id: number, perfil: string }} solicitante usuário autenticado (req.usuario)
 * @param {object} [deps]
 * @param {object} [deps.db] client Prisma (injetável em testes)
 * @returns {Promise<{ id: number, nome: string, email: string, perfil: string, status: string }>}
 * @throws {ErroHttp} 400 (dados/id inválidos), 404 (inexistente) ou 409 (conflito)
 */
export async function atualizarUsuario(idUrl, corpo, solicitante, { db = prisma } = {}) {
  const id = validarIdUsuario(idUrl);
  const dados = validarEdicaoUsuario(corpo);

  // RN11: a Gestão não bloqueia/desativa a si mesma nem muda o próprio
  // perfil. Editar o próprio nome/e-mail é permitido, e reenviar o valor
  // atual (perfil GESTAO, status ATIVO) não muda nada e é aceito.
  if (solicitante?.id === id) {
    const mudaPerfil = dados.perfil !== undefined && dados.perfil !== solicitante.perfil;
    const perdeAcesso = dados.status !== undefined && dados.status !== StatusUsuario.ATIVO;
    if (mudaPerfil || perdeAcesso) {
      throw new ErroHttp(409, MENSAGEM_ALTERAR_PROPRIO_ACESSO);
    }
  }

  for (let tentativa = 1; ; tentativa += 1) {
    try {
      return await db.$transaction((tx) => verificarEAtualizar(tx, id, dados), {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (erro) {
      if (erro instanceof ErroHttp) throw erro;
      // Corrida com outro cadastro/edição usando o mesmo e-mail.
      if (ehViolacaoDeUnicidade(erro)) throw new ErroHttp(409, MENSAGEM_EMAIL_DUPLICADO);
      // Registro inexistente no update (ex.: removido direto no banco).
      if (erro?.code === 'P2025') throw new ErroHttp(404, MENSAGEM_USUARIO_NAO_ENCONTRADO);
      // Conflito de serialização/escrita: repete a transação.
      if (erro?.code === 'P2034') {
        if (tentativa < TENTATIVAS_TRANSACAO) continue;
        throw new ErroHttp(409, MENSAGEM_CONFLITO_CONCORRENTE);
      }
      throw erro;
    }
  }
}
