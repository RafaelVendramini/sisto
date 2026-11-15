// Mensagens, rótulos e validação da tela de estudantes (RF15, RF16, RN13,
// RN18, RNF02): nada técnico aparece na tela. Para 400/404/409 o texto vem do
// back-end (campo `erro`).
import { CODIGOS_ERRO, falhaTemCodigo } from './codigosErro.js';
import { MENSAGEM_SEM_CONEXAO, MENSAGEM_SEM_PERMISSAO } from './mensagens.js';

// Limites técnicos do back-end (Issue #42), após remover espaços nas pontas.
export const TAMANHO_MAXIMO_NOME_ESTUDANTE = 150;
export const TAMANHO_MAXIMO_CODIGO_ESCOLAR = 150;

// Textos do contrato do back-end (POST/PUT /estudantes). O tipo do 409 é
// identificado pelo `codigo` (Issue #72); o texto só é reserva sem código.
export const MENSAGEM_CODIGO_ESCOLAR_DUPLICADO =
  'Já existe um estudante cadastrado com este código escolar.';
export const MENSAGEM_ALTERACAO_SIMULTANEA_ESTUDANTE =
  'O estudante foi alterado por outra operação ao mesmo tempo. Tente novamente.';

const MENSAGEM_NAO_ENCONTRADO = 'Estudante não encontrado. Atualize a página e tente novamente.';
const MENSAGEM_GENERICA_CRIAR =
  'Não foi possível cadastrar o estudante agora. Tente novamente em instantes.';
const MENSAGEM_GENERICA_EDITAR =
  'Não foi possível salvar a alteração agora. Tente novamente em instantes.';

/** Texto como o back-end grava: forma NFC, sem espaços nas pontas (sem mudar maiúsculas). */
export function limparTexto(valor) {
  return String(valor ?? '').normalize('NFC').trim();
}

/** Código escolar para envio: texto limpo, ou null quando vazio (RN18). */
export function codigoParaEnvio(valor) {
  const codigo = limparTexto(valor);
  return codigo === '' ? null : codigo;
}

/** Id escolhido num seletor (texto) como número, ou null quando vazio. */
export function idParaEnvio(valor) {
  const texto = String(valor ?? '').trim();
  if (!/^[1-9][0-9]*$/.test(texto)) return null;
  return Number(texto);
}

/**
 * Valida os campos antes do envio. É só usabilidade: a validação definitiva
 * é a do back-end (400).
 * @returns {{ nomeCompleto?: string, codigoEscolar?: string, turmaId?: string }}
 */
export function validarEstudante({ nomeCompleto, codigoEscolar, turmaId }) {
  const erros = {};
  const nome = limparTexto(nomeCompleto);
  if (!nome) erros.nomeCompleto = 'Informe o nome completo do estudante.';
  else if (nome.length > TAMANHO_MAXIMO_NOME_ESTUDANTE) {
    erros.nomeCompleto = `O nome completo deve ter no máximo ${TAMANHO_MAXIMO_NOME_ESTUDANTE} caracteres.`;
  }

  if (limparTexto(codigoEscolar).length > TAMANHO_MAXIMO_CODIGO_ESCOLAR) {
    erros.codigoEscolar = `O código escolar deve ter no máximo ${TAMANHO_MAXIMO_CODIGO_ESCOLAR} caracteres.`;
  }

  if (idParaEnvio(turmaId) === null) erros.turmaId = 'Selecione a turma do estudante.';

  return erros;
}

/**
 * Indica se o 409 é de código escolar repetido (RN18 — codigo
 * CODIGO_ESCOLAR_DUPLICADO). O outro 409 possível é o de alteração
 * simultânea. Sem código, vale a reserva pelo texto.
 */
export function ehCodigoDuplicado(falha) {
  return (
    falha?.status === 409 &&
    falhaTemCodigo(
      falha,
      CODIGOS_ERRO.CODIGO_ESCOLAR_DUPLICADO,
      (f) => f.message !== MENSAGEM_ALTERACAO_SIMULTANEA_ESTUDANTE,
    )
  );
}

/** Mensagem do 409 de código repetido (texto do back-end, ou o mesmo texto fixo). */
export function mensagemCodigoDuplicado(falha) {
  return falha?.doServidor && falha?.message ? falha.message : MENSAGEM_CODIGO_ESCOLAR_DUPLICADO;
}

/**
 * Indica se a lista na tela pode estar desatualizada: estudante não encontrado
 * (404) ou alterado ao mesmo tempo por outra operação (409). Nesses casos a
 * página recarrega a lista em segundo plano.
 */
export function listaPodeEstarDesatualizada(falha) {
  if (falha?.status === 404) return true;
  return (
    falha?.status === 409 &&
    falhaTemCodigo(
      falha,
      CODIGOS_ERRO.CONFLITO_CONCORRENTE,
      (f) => f.message === MENSAGEM_ALTERACAO_SIMULTANEA_ESTUDANTE,
    )
  );
}

/**
 * Converte a falha do POST/PUT /estudantes em mensagem geral para a tela.
 * O 401 não chega aqui na prática: o tratamento central leva ao login.
 * @param {{ status?: number, message?: string, doServidor?: boolean }} falha
 * @param {'criar' | 'editar'} acao
 */
export function mensagemErroEstudante(falha, acao) {
  const status = falha?.status;
  if (status === 403) return MENSAGEM_SEM_PERMISSAO;
  if (status === 0) return MENSAGEM_SEM_CONEXAO;
  if ([400, 404, 409].includes(status) && falha?.doServidor && falha?.message) {
    return falha.message;
  }
  if (status === 404) return MENSAGEM_NAO_ENCONTRADO;
  return acao === 'editar' ? MENSAGEM_GENERICA_EDITAR : MENSAGEM_GENERICA_CRIAR;
}

/** Rótulo legível da turma: "6º A — Ensino Fundamental - Anos Finais (2026)". */
export function rotuloTurma(turma) {
  if (!turma) return '';
  return `${turma.nome} — ${turma.etapa} (${turma.anoLetivo})`;
}

// Tutor vinculado que não está mais ativo (RN13): a Gestão vê o status e
// pode trocar o tutor ou desvincular o estudante.
const SINALIZACAO_TUTOR = Object.freeze({
  BLOQUEADO: 'bloqueado',
  DESATIVADO: 'desativado',
});

/** "bloqueado" / "desativado" para tutor que não está ativo; '' quando ativo. */
export function sinalizacaoTutor(tutor) {
  return SINALIZACAO_TUTOR[tutor?.status] ?? '';
}

/** Rótulo do tutor no seletor: "Nome" ou "Nome (bloqueado)". */
export function rotuloOpcaoTutor(tutor) {
  const sinal = sinalizacaoTutor(tutor);
  return sinal ? `${tutor.nome} (${sinal})` : tutor.nome;
}
