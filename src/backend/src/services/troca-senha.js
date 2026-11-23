// Recuperação de acesso — redefinição pela Gestão e troca da própria senha
// (RF03, Issue #18 — SSD 1.4).
//
// - RN10: nova senha com no mínimo 8 caracteres (mesma política do cadastro,
//   services/senha.js). A senha redefinida pela Gestão é temporária: liga
//   troca_senha_obrigatoria; a troca pelo próprio usuário a desliga. Na troca
//   da própria senha, a nova não pode ser igual à atual (a regra não vale
//   para a redefinição pela Gestão).
// - RN11 (padrão): a Gestão não redefine a PRÓPRIA senha por
//   PUT /usuarios/{id}/senha (409); para isso usa PUT /conta/senha.
// - RN09: a redefinição é permitida para usuário bloqueado ou desativado; o
//   status não muda, então ele continua sem acesso até ser reativado.
// - RN12: toda troca grava senha_alterada_em = max(agora, anterior + 1s) (ver
//   proximaSenhaAlteradaEm); o middleware de sessão passa a rejeitar os
//   tokens anteriores, inclusive o usado na troca.
// - Conflito concorrente entre duas trocas do mesmo usuário: 409. Na troca da
//   própria senha, também 409 se a senha mudou entre a conferência da senha
//   atual e a gravação (Issue #127; ver gravarNovaSenha).
// - RNF03 / RNF06: só o hash bcrypt é gravado; senha nunca aparece em
//   resposta, mensagem de erro ou log.
// - RNF04: cada troca grava um LogAuditoria na MESMA transação do update.
// - RN01: a restrição de PUT /usuarios/{id}/senha à Gestão fica na rota
//   (permitirPerfis).
import bcrypt from 'bcrypt';
import prisma from '../lib/prisma.js';
import { CODIGOS_ERRO, ErroHttp } from '../lib/erros.js';
import { emTransacaoSerializavel } from '../lib/transacao.js';
import { ACOES_AUDITORIA, recursoAuditoria, registrarAuditoria } from './auditoria.js';
import { TAMANHO_MAXIMO_BYTES_SENHA, gerarHashSenha, mensagemPoliticaSenha } from './senha.js';
import { MENSAGEM_USUARIO_NAO_ENCONTRADO, validarIdUsuario } from './usuarios.js';
import { erroNaoAutenticado } from './sessao.js';

export const MENSAGEM_REDEFINIR_PROPRIA_SENHA =
  'Você não pode redefinir a sua própria senha por aqui. Use a opção "Alterar minha senha".';
export const MENSAGEM_SENHA_ATUAL_INCORRETA = 'A senha atual está incorreta.';
export const MENSAGEM_NOVA_SENHA_IGUAL_ATUAL = 'A nova senha deve ser diferente da senha atual.';
export const MENSAGEM_CONFLITO_TROCA_SENHA =
  'A senha deste usuário foi alterada por outra operação ao mesmo tempo. Tente novamente.';
/**
 * Troca da própria senha recusada porque a senha mudou depois da conferência
 * da senha atual (ex.: redefinição pela Gestão — Issue #127). "Tente novamente"
 * não serve aqui: a senha atual informada e a sessão já não valem (RN12).
 */
export const MENSAGEM_SENHA_ALTERADA_DURANTE_TROCA =
  'A sua senha foi alterada por outra operação enquanto a troca era feita. Entre novamente no sistema.';

/** Intervalo mínimo entre duas trocas registradas (desempate por segundo do RN12). */
const UM_SEGUNDO_MS = 1000;

/**
 * RN12 — valor de senha_alterada_em de uma nova troca: max(agora, anterior + 1s).
 *
 * Por quê: o login que cai no mesmo segundo T de uma troca recebe iat = T+1
 * (services/auth.js, calcularIatToken). Se outra troca acontecesse ainda no
 * segundo T e gravasse "agora", o token com iat T+1 continuaria valendo
 * (T+1 > T). Com cada troca ao menos 1s depois da anterior, o segundo da nova
 * troca é >= T+1 e esse token é rejeitado (o iat precisa ser estritamente
 * maior). Fora desse caso de borda, o valor é simplesmente "agora".
 *
 * @param {Date} agora
 * @param {Date | null | undefined} anterior senha_alterada_em atual do usuário
 * @returns {Date}
 */
export function proximaSenhaAlteradaEm(agora, anterior) {
  if (!(anterior instanceof Date)) return agora;
  return new Date(Math.max(agora.getTime(), anterior.getTime() + UM_SEGUNDO_MS));
}

/** Data (ou null) em milissegundos, para comparar senha_alterada_em. */
function emMilissegundos(data) {
  return data instanceof Date ? data.getTime() : null;
}

/**
 * Indica se a senha do usuário mudou entre a leitura `antes` e a releitura
 * `depois` (senha_hash ou senha_alterada_em diferentes).
 * @param {{ senha_hash: string, senha_alterada_em: Date | null }} antes
 * @param {{ senha_hash: string, senha_alterada_em: Date | null }} depois
 * @returns {boolean}
 */
export function senhaMudouDesde(antes, depois) {
  return (
    antes.senha_hash !== depois.senha_hash ||
    emMilissegundos(antes.senha_alterada_em) !== emMilissegundos(depois.senha_alterada_em)
  );
}

/**
 * Grava o novo hash, a flag de troca obrigatória, senha_alterada_em e o
 * LogAuditoria numa única transação SERIALIZABLE: a leitura do
 * senha_alterada_em anterior e o update são atômicos. Se duas trocas
 * simultâneas partirem da mesma leitura, o PostgreSQL aborta uma delas
 * (P2034) e ela é repetida; esgotadas as tentativas, responde 409 (helper
 * lib/transacao.js, que também responde 409 no P2028).
 *
 * Troca pelo próprio usuário (Issue #127): `esperado` traz o senha_hash e o
 * senha_alterada_em lidos ANTES da conferência da senha atual (que roda fora
 * da transação, por causa do custo do bcrypt). A transação relê os dois; se
 * algum mudou (ex.: a Gestão redefiniu a senha nesse intervalo — RN10), a
 * troca é recusada com 409, SEM nova tentativa: a senha atual conferida já
 * não é a vigente, e gravar desfaria a redefinição em silêncio. Sem
 * `esperado` (redefinição pela Gestão), o comportamento não muda.
 * @param {object} db client Prisma
 * @param {object} dados
 * @param {{ senha_hash: string, senha_alterada_em: Date | null }} [dados.esperado]
 * @returns {Promise<void>}
 * @throws {ErroHttp} 404 (usuário inexistente) ou 409 (conflito concorrente)
 */
async function gravarNovaSenha(
  db,
  { id, senha_hash, trocaSenhaObrigatoria, auditoria, agora, esperado },
) {
  await emTransacaoSerializavel(
    db,
    async (tx) => {
      const atual = await tx.usuario.findUnique({
        where: { id },
        select: { id: true, senha_hash: true, senha_alterada_em: true },
      });
      if (!atual) throw new ErroHttp(404, MENSAGEM_USUARIO_NAO_ENCONTRADO);
      // ErroHttp sobe sem nova tentativa (ver o comentário acima).
      if (esperado && senhaMudouDesde(esperado, atual)) {
        throw new ErroHttp(409, MENSAGEM_SENHA_ALTERADA_DURANTE_TROCA, {
          codigo: CODIGOS_ERRO.CONFLITO_CONCORRENTE,
        });
      }

      await tx.usuario.update({
        where: { id },
        data: {
          senha_hash,
          troca_senha_obrigatoria: trocaSenhaObrigatoria,
          senha_alterada_em: proximaSenhaAlteradaEm(agora(), atual.senha_alterada_em),
        },
        select: { id: true },
      });
      await registrarAuditoria(auditoria, tx);
    },
    {
      mensagemConflito: MENSAGEM_CONFLITO_TROCA_SENHA,
      // Registro removido entre a leitura e o update.
      traduzirErro: (erro) =>
        erro?.code === 'P2025' ? new ErroHttp(404, MENSAGEM_USUARIO_NAO_ENCONTRADO) : undefined,
    },
  );
}

function ehObjeto(corpo) {
  return Boolean(corpo) && typeof corpo === 'object' && !Array.isArray(corpo);
}

function ehTextoNaoVazio(valor) {
  return typeof valor === 'string' && valor !== '';
}

/** Valida a nova senha com a política do cadastro (RN10). @throws {ErroHttp} 400 */
function validarNovaSenha(novaSenha) {
  const problema = mensagemPoliticaSenha(novaSenha);
  if (problema) throw new ErroHttp(400, problema);
}

/**
 * Valida o corpo do PUT /usuarios/{id}/senha: { novaSenha }.
 * Outros campos são ignorados.
 * @returns {{ novaSenha: string }}
 * @throws {ErroHttp} 400
 */
export function validarRedefinicaoSenha(corpo) {
  if (!ehObjeto(corpo)) {
    throw new ErroHttp(400, 'Envie um objeto JSON com novaSenha.');
  }
  const { novaSenha } = corpo;
  if (!ehTextoNaoVazio(novaSenha)) {
    throw new ErroHttp(400, 'Informe novaSenha (texto não vazio).');
  }
  validarNovaSenha(novaSenha);
  return { novaSenha };
}

/**
 * Valida o corpo do PUT /conta/senha: { senhaAtual, novaSenha }.
 * Outros campos são ignorados.
 * @returns {{ senhaAtual: string, novaSenha: string }}
 * @throws {ErroHttp} 400
 */
export function validarTrocaPropriaSenha(corpo) {
  if (!ehObjeto(corpo)) {
    throw new ErroHttp(400, 'Envie um objeto JSON com senhaAtual e novaSenha.');
  }
  const { senhaAtual, novaSenha } = corpo;
  const faltando = [];
  if (!ehTextoNaoVazio(senhaAtual)) faltando.push('senhaAtual');
  if (!ehTextoNaoVazio(novaSenha)) faltando.push('novaSenha');
  if (faltando.length > 0) {
    throw new ErroHttp(400, `Informe ${faltando.join(' e ')} (texto não vazio).`);
  }
  validarNovaSenha(novaSenha);
  return { senhaAtual, novaSenha };
}

/**
 * PUT /usuarios/{id}/senha — a Gestão redefine a senha de OUTRO usuário.
 * @param {unknown} idUrl id recebido na URL (texto)
 * @param {unknown} corpo corpo da requisição ({ novaSenha })
 * @param {{ id: number }} solicitante usuário autenticado (req.usuario)
 * @param {object} [deps]
 * @param {object} [deps.db] client Prisma (injetável em testes)
 * @param {(senha: string) => Promise<string>} [deps.gerarHash]
 * @param {() => Date} [deps.agora]
 * @returns {Promise<void>}
 * @throws {ErroHttp} 400 (id/senha inválidos), 404 (inexistente) ou 409 (própria
 *   senha ou conflito concorrente)
 */
export async function redefinirSenhaUsuario(
  idUrl,
  corpo,
  solicitante,
  { db = prisma, gerarHash = gerarHashSenha, agora = () => new Date() } = {},
) {
  const id = validarIdUsuario(idUrl);
  const { novaSenha } = validarRedefinicaoSenha(corpo);

  if (solicitante?.id === id) {
    throw new ErroHttp(409, MENSAGEM_REDEFINIR_PROPRIA_SENHA, {
      codigo: CODIGOS_ERRO.REDEFINIR_PROPRIA_SENHA,
    });
  }

  // Pré-checagem (evita gastar um hash bcrypt à toa com usuário inexistente).
  const alvo = await db.usuario.findUnique({ where: { id }, select: { id: true } });
  if (!alvo) {
    throw new ErroHttp(404, MENSAGEM_USUARIO_NAO_ENCONTRADO);
  }

  const senha_hash = await gerarHash(novaSenha);

  // O status NÃO é alterado: bloqueado/desativado continua sem acesso (RN09).
  await gravarNovaSenha(db, {
    id,
    senha_hash,
    trocaSenhaObrigatoria: true,
    auditoria: {
      usuarioId: solicitante.id,
      acao: ACOES_AUDITORIA.SENHA_REDEFINIDA_PELA_GESTAO,
      recurso: recursoAuditoria('usuarios', id),
    },
    agora,
  });
}

/**
 * PUT /conta/senha — o usuário autenticado troca a própria senha.
 * Não devolve token: o token usado aqui também deixa de valer (RN12).
 * @param {unknown} corpo corpo da requisição ({ senhaAtual, novaSenha })
 * @param {{ id: number }} solicitante usuário autenticado (req.usuario)
 * @param {object} [deps]
 * @param {object} [deps.db] client Prisma (injetável em testes)
 * @param {(senha: string) => Promise<string>} [deps.gerarHash]
 * @param {() => Date} [deps.agora]
 * @returns {Promise<void>}
 * @throws {ErroHttp} 400 (dados inválidos, senha atual incorreta ou nova igual à
 *   atual) ou 409 (conflito concorrente)
 */
export async function trocarPropriaSenha(
  corpo,
  solicitante,
  { db = prisma, gerarHash = gerarHashSenha, agora = () => new Date() } = {},
) {
  const { senhaAtual, novaSenha } = validarTrocaPropriaSenha(corpo);

  const usuario = await db.usuario.findUnique({
    where: { id: solicitante?.id },
    // senha_alterada_em também é lido: com o senha_hash, é o que a transação
    // confere para recusar uma troca concorrente (Issue #127).
    select: { id: true, senha_hash: true, senha_alterada_em: true },
  });
  if (!usuario) {
    // O middleware acabou de validar a sessão; só ocorre se o usuário sumir no meio.
    throw erroNaoAutenticado();
  }

  // 400 (não 401): o front-end trata 401 como sessão expirada (Seção 12).
  // Senha atual acima de 72 bytes nunca confere (o bcrypt ignoraria o excesso).
  const dentroDoLimite = Buffer.byteLength(senhaAtual, 'utf8') <= TAMANHO_MAXIMO_BYTES_SENHA;
  const confere = await bcrypt.compare(senhaAtual, usuario.senha_hash);
  if (!confere || !dentroDoLimite) {
    throw new ErroHttp(400, MENSAGEM_SENHA_ATUAL_INCORRETA);
  }
  if (novaSenha === senhaAtual) {
    throw new ErroHttp(400, MENSAGEM_NOVA_SENHA_IGUAL_ATUAL);
  }

  const senha_hash = await gerarHash(novaSenha);

  await gravarNovaSenha(db, {
    id: usuario.id,
    senha_hash,
    trocaSenhaObrigatoria: false,
    auditoria: {
      usuarioId: usuario.id,
      acao: ACOES_AUDITORIA.SENHA_ALTERADA_PELO_USUARIO,
      recurso: recursoAuditoria('usuarios', usuario.id),
    },
    agora,
    esperado: {
      senha_hash: usuario.senha_hash,
      senha_alterada_em: usuario.senha_alterada_em ?? null,
    },
  });
}
