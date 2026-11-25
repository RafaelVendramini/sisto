// Transação SERIALIZABLE com novas tentativas — Sisto (Issue #129).
//
// Helper único usado pelos services de gravação (usuários, troca de senha,
// turmas, categorias, estudantes e ocorrências). Antes havia uma cópia em
// cada service; as mensagens e os mapeamentos de erro próprios de cada um
// continuam nos services, passados aqui por opção.
//
// Por que SERIALIZABLE: as regras checadas dentro da transação (RN11, RN18,
// RN03, RN04...) leem o estado e depois gravam. Se duas operações simultâneas
// passarem pela mesma checagem, o PostgreSQL aborta uma delas (SQLSTATE 40001,
// que o Prisma expõe como P2034). Ela é repetida e passa a enxergar a gravação
// da outra. Esgotadas as tentativas, responde 409 CONFLITO_CONCORRENTE.
//
// Conflito no COMMIT (achado da Issue #129, e2e de concorrência da RN11): no
// Prisma 7 com o adapter-pg, quando o PostgreSQL só detecta o conflito de
// serialização ao CONFIRMAR a transação, o erro não vira P2034: chega o
// DriverAdapterError bruto do adapter, com cause.kind
// "TransactionWriteConflict" (SQLSTATE 40001 ou 40P01). Antes deste helper
// ele não era reconhecido, e a API respondia 500 em vez de repetir. Os dois
// formatos são tratados aqui como o mesmo conflito.
//
// Espera entre tentativas: as transações abortadas costumam colidir de novo
// se repetirem no mesmo instante. Uma espera curta e aleatória (10 a 50 ms,
// multiplicada pelo número da tentativa) as desencontra.
//
// P2028 (problema na API de transações do Prisma: tempo da transação
// esgotado, transação já encerrada ou sem conexão livre no tempo de espera):
// também vira 409 CONFLITO_CONCORRENTE, mas SEM nova tentativa. A transação
// já gastou o tempo-limite inteiro (em geral esperando bloqueios de outra
// operação ou uma conexão do pool); repeti-la triplicaria a demora e aumentaria
// a carga justamente quando o banco está sobrecarregado. Antes, o P2028 subia
// como erro genérico e a API respondia 500.
import { Prisma } from '@prisma/client';
import { CODIGOS_ERRO, ErroHttp } from './erros.js';

/** Tentativas da transação serializável antes de desistir com 409. */
export const TENTATIVAS_TRANSACAO = 3;

/** Faixa da espera aleatória entre tentativas, multiplicada pelo número da tentativa. */
export const ESPERA_MINIMA_MS = 10;
export const ESPERA_MAXIMA_MS = 50;

/** Conflito de serialização ou de escrita (SQLSTATE 40001/40P01): repetir. */
const CODIGO_CONFLITO_SERIALIZACAO = 'P2034';
/** Mesmo conflito, detectado no COMMIT (DriverAdapterError do adapter-pg). */
const TIPO_CONFLITO_ADAPTER = 'TransactionWriteConflict';
/** Tempo da transação esgotado (ou transação encerrada): 409 sem repetir. */
const CODIGO_TEMPO_TRANSACAO_ESGOTADO = 'P2028';

/**
 * Duração da espera antes da próxima tentativa: aleatória entre
 * ESPERA_MINIMA_MS e ESPERA_MAXIMA_MS, multiplicada pela tentativa que falhou.
 * @param {number} tentativa número da tentativa que acabou de falhar (1, 2, ...)
 * @param {() => number} [sortear] fonte de aleatoriedade em [0, 1) (injetável em testes)
 * @returns {number} milissegundos
 */
export function calcularEspera(tentativa, sortear = Math.random) {
  const base = ESPERA_MINIMA_MS + sortear() * (ESPERA_MAXIMA_MS - ESPERA_MINIMA_MS);
  return Math.round(base * tentativa);
}

/**
 * Indica se o erro é um conflito de serialização/escrita que deve ser
 * repetido: P2034 do Prisma ou, no COMMIT, o DriverAdapterError do adapter
 * com cause.kind "TransactionWriteConflict".
 * @param {unknown} erro
 * @returns {boolean}
 */
export function ehConflitoDeSerializacao(erro) {
  if (erro?.code === CODIGO_CONFLITO_SERIALIZACAO) return true;
  return erro?.name === 'DriverAdapterError' && erro?.cause?.kind === TIPO_CONFLITO_ADAPTER;
}

function esperarPadrao(tentativa) {
  return new Promise((resolver) => {
    setTimeout(resolver, calcularEspera(tentativa));
  });
}

/**
 * Executa `operacao` numa transação SERIALIZABLE.
 *
 * Ordem de tratamento do erro:
 * 1. ErroHttp lançado pela operação (regra de negócio): sobe sem repetição.
 * 2. P2034 (conflito de serialização), ou o mesmo conflito detectado no
 *    COMMIT (DriverAdapterError "TransactionWriteConflict"): repete após uma espera curta;
 *    esgotadas as tentativas, 409 CONFLITO_CONCORRENTE com `mensagemConflito`.
 * 3. P2028 (tempo da transação esgotado): 409 CONFLITO_CONCORRENTE com
 *    `mensagemConflito`, sem repetir.
 * 4. `traduzirErro(erro)`: mapeamentos próprios do service (ex.: P2002 → 409
 *    de duplicidade, P2025 → 404). Se devolver um erro, ele é lançado.
 * 5. Qualquer outro erro sobe como está (o middleware responde 500).
 *
 * @template T
 * @param {object} db client Prisma (ou fake com $transaction)
 * @param {(tx: object) => Promise<T>} operacao
 * @param {object} opcoes
 * @param {string} opcoes.mensagemConflito mensagem do 409 de conflito concorrente
 * @param {(erro: unknown) => Error | undefined} [opcoes.traduzirErro]
 * @param {number} [opcoes.tentativas] padrão TENTATIVAS_TRANSACAO
 * @param {(tentativa: number) => Promise<void>} [opcoes.esperar] espera entre tentativas (injetável em testes)
 * @returns {Promise<T>}
 * @throws {ErroHttp} 409 (conflito concorrente), o erro traduzido ou o erro original
 */
export async function emTransacaoSerializavel(
  db,
  operacao,
  { mensagemConflito, traduzirErro, tentativas = TENTATIVAS_TRANSACAO, esperar = esperarPadrao },
) {
  const erroConflito = () =>
    new ErroHttp(409, mensagemConflito, { codigo: CODIGOS_ERRO.CONFLITO_CONCORRENTE });

  for (let tentativa = 1; ; tentativa += 1) {
    try {
      return await db.$transaction(operacao, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (erro) {
      // DIAGNÓSTICO TEMPORÁRIO da Issue #12 (PR fechado sem merge).
      if (!(erro instanceof ErroHttp)) console.warn(`[DIAG-12] tentativa=${tentativa} code=${erro?.code} name=${erro?.name} kind=${erro?.cause?.kind}`);
      if (erro instanceof ErroHttp) throw erro;
      if (ehConflitoDeSerializacao(erro)) {
        if (tentativa >= tentativas) throw erroConflito();
        await esperar(tentativa);
        continue;
      }
      if (erro?.code === CODIGO_TEMPO_TRANSACAO_ESGOTADO) throw erroConflito();
      const traduzido = traduzirErro?.(erro);
      if (traduzido) throw traduzido;
      throw erro;
    }
  }
}
