// Mensagens e validação da tela de turmas (RF15, RN18, RNF02): nada técnico
// aparece na tela. Para 400/404/409 o texto vem do back-end (campo `erro`).
import { MENSAGEM_SEM_CONEXAO, MENSAGEM_SEM_PERMISSAO } from './mensagens.js';

// Limites técnicos do back-end (Issue #40), após remover espaços nas pontas.
export const TAMANHO_MAXIMO_NOME_TURMA = 150;
export const TAMANHO_MAXIMO_ETAPA_TURMA = 150;
// "Inteiro de 4 dígitos" (Seção 12): de 1000 a 9999.
export const MENOR_ANO_LETIVO = 1000;
export const MAIOR_ANO_LETIVO = 9999;

// Textos do contrato do back-end (POST/PUT /turmas — 409).
export const MENSAGEM_TURMA_DUPLICADA =
  'Já existe uma turma cadastrada com este nome e esta etapa neste ano letivo.';
export const MENSAGEM_ALTERACAO_SIMULTANEA_TURMA =
  'A turma foi alterada por outra operação ao mesmo tempo. Tente novamente.';

const MENSAGEM_NAO_ENCONTRADA = 'Turma não encontrada. Atualize a página e tente novamente.';
const MENSAGEM_GENERICA_CRIAR = 'Não foi possível cadastrar a turma agora. Tente novamente em instantes.';
const MENSAGEM_GENERICA_EDITAR = 'Não foi possível salvar a alteração agora. Tente novamente em instantes.';

/** Ano atual, sugerido no cadastro. */
export function anoAtual() {
  return new Date().getFullYear();
}

/** Texto como o back-end compara e grava: forma NFC, sem espaços nas pontas. */
export function limparTexto(valor) {
  return String(valor ?? '').normalize('NFC').trim();
}

/**
 * Converte o ano letivo digitado em número inteiro de 1000 a 9999.
 * @param {string | number} valor
 * @returns {number | null} o número, ou null se não for um ano válido
 */
export function converterAnoLetivo(valor) {
  const texto = String(valor ?? '').trim();
  if (!/^[0-9]{4}$/.test(texto)) return null;
  const ano = Number(texto);
  if (ano < MENOR_ANO_LETIVO || ano > MAIOR_ANO_LETIVO) return null;
  return ano;
}

/**
 * Valida nome, etapa e ano letivo antes do envio (todos obrigatórios).
 * É só usabilidade: a validação definitiva é a do back-end (400).
 * @returns {{ nome?: string, etapa?: string, anoLetivo?: string }} mensagens por campo
 */
export function validarTurma({ nome, etapa, anoLetivo }) {
  const erros = {};
  const nomeLimpo = limparTexto(nome);
  const etapaLimpa = limparTexto(etapa);

  if (!nomeLimpo) erros.nome = 'Informe o nome da turma.';
  else if (nomeLimpo.length > TAMANHO_MAXIMO_NOME_TURMA) {
    erros.nome = `O nome deve ter no máximo ${TAMANHO_MAXIMO_NOME_TURMA} caracteres.`;
  }

  if (!etapaLimpa) erros.etapa = 'Informe a etapa da turma.';
  else if (etapaLimpa.length > TAMANHO_MAXIMO_ETAPA_TURMA) {
    erros.etapa = `A etapa deve ter no máximo ${TAMANHO_MAXIMO_ETAPA_TURMA} caracteres.`;
  }

  if (String(anoLetivo ?? '').trim() === '') {
    erros.anoLetivo = 'Informe o ano letivo.';
  } else if (converterAnoLetivo(anoLetivo) === null) {
    erros.anoLetivo = `Informe o ano letivo com 4 algarismos, entre ${MENOR_ANO_LETIVO} e ${MAIOR_ANO_LETIVO} (ex.: ${anoAtual()}).`;
  }

  return erros;
}

/**
 * Indica se o 409 é de turma repetida (RN18): nome, etapa e ano letivo iguais
 * aos de outra turma. O outro 409 possível é o de alteração simultânea.
 */
export function ehTurmaDuplicada(falha) {
  return falha?.status === 409 && falha?.message !== MENSAGEM_ALTERACAO_SIMULTANEA_TURMA;
}

/** Mensagem do 409 de turma repetida (texto do back-end, ou o mesmo texto fixo). */
export function mensagemTurmaDuplicada(falha) {
  return falha?.doServidor && falha?.message ? falha.message : MENSAGEM_TURMA_DUPLICADA;
}

/**
 * Indica se a lista na tela pode estar desatualizada: turma não encontrada
 * (404) ou alterada ao mesmo tempo por outra operação (409). Nesses casos a
 * página recarrega a lista em segundo plano.
 */
export function listaPodeEstarDesatualizada(falha) {
  if (falha?.status === 404) return true;
  return falha?.status === 409 && falha?.message === MENSAGEM_ALTERACAO_SIMULTANEA_TURMA;
}

/**
 * Converte a falha do POST/PUT /turmas em mensagem geral para a tela.
 * O 401 não chega aqui na prática: o tratamento central leva ao login.
 * @param {{ status?: number, message?: string, doServidor?: boolean }} falha
 * @param {'criar' | 'editar'} acao
 * @returns {string}
 */
export function mensagemErroTurma(falha, acao) {
  const status = falha?.status;
  if (status === 403) return MENSAGEM_SEM_PERMISSAO;
  if (status === 0) return MENSAGEM_SEM_CONEXAO;
  if ([400, 404, 409].includes(status) && falha?.doServidor && falha?.message) {
    return falha.message;
  }
  if (status === 404) return MENSAGEM_NAO_ENCONTRADA;
  return acao === 'editar' ? MENSAGEM_GENERICA_EDITAR : MENSAGEM_GENERICA_CRIAR;
}

/** Descrição curta da turma para mensagens e rótulos: "1º A (Ensino Médio, 2026)". */
export function descreverTurma({ nome, etapa, anoLetivo }) {
  return `${nome} (${etapa}, ${anoLetivo})`;
}
