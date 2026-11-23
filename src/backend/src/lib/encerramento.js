// Encerramento limpo da API — Sisto (Issue #129).
//
// Ao receber SIGTERM (enviado pelo Render a cada deploy ou reinício) ou SIGINT
// (Ctrl+C no terminal), o servidor:
// 1. para de aceitar conexões novas e espera as requisições em andamento
//    terminarem (server.close; desde o Node 19 ele também fecha as conexões
//    keep-alive ociosas);
// 2. encerra a conexão com o banco (desconectarPrisma, lib/prisma.js), para
//    não deixar conexões abertas no PostgreSQL (Neon);
// 3. sai do processo com código 0 (ou 1, se algo falhar).
// Se as requisições em andamento não terminarem dentro do prazo, o processo
// sai com código 1 em vez de ficar preso (o Render mata o processo depois de
// 30 s de qualquer forma).
import { desconectarPrisma } from './prisma.js';

/** Sinais que iniciam o encerramento limpo. */
export const SINAIS_ENCERRAMENTO = Object.freeze(['SIGTERM', 'SIGINT']);

/** Prazo para as requisições em andamento terminarem (abaixo dos 30 s do Render). */
export const PRAZO_ENCERRAMENTO_MS = 10_000;

/**
 * Registra o encerramento limpo nos sinais SIGTERM e SIGINT.
 * @param {{ close: (callback: (erro?: Error) => void) => void }} servidor servidor HTTP (app.listen)
 * @param {object} [deps] dependências injetáveis (testes)
 * @param {NodeJS.Process} [deps.processo] padrão: process
 * @param {() => Promise<void>} [deps.desconectar] padrão: desconectarPrisma
 * @param {{ log: Function, error: Function }} [deps.registro] padrão: console
 * @param {number} [deps.prazoMs] padrão: PRAZO_ENCERRAMENTO_MS
 * @returns {(sinal: string) => Promise<void>} a função de encerramento (para testes)
 */
export function registrarEncerramentoLimpo(
  servidor,
  {
    processo = process,
    desconectar = desconectarPrisma,
    registro = console,
    prazoMs = PRAZO_ENCERRAMENTO_MS,
  } = {},
) {
  let encerrando = false;

  async function encerrar(sinal) {
    // SIGTERM seguido de SIGINT (ou o contrário) não reinicia o encerramento.
    // O MESMO sinal repetido (ex.: Ctrl+C duas vezes) volta ao comportamento
    // padrão do Node e força a saída, porque o ouvinte é registrado com once.
    if (encerrando) return;
    encerrando = true;
    registro.log(`Sinal ${sinal} recebido: encerrando a API.`);

    const prazo = setTimeout(() => {
      registro.error('Encerramento: prazo esgotado esperando as requisições em andamento.');
      processo.exit(1);
    }, prazoMs);
    // O timer não segura o processo vivo sozinho.
    prazo.unref?.();

    let codigo = 0;
    try {
      await new Promise((resolver, rejeitar) => {
        servidor.close((erro) => (erro ? rejeitar(erro) : resolver()));
      });
    } catch (erro) {
      codigo = 1;
      registro.error('Encerramento: falha ao fechar o servidor HTTP.', erro?.message);
    }
    try {
      await desconectar();
    } catch (erro) {
      codigo = 1;
      registro.error('Encerramento: falha ao desconectar do banco.', erro?.message);
    }
    clearTimeout(prazo);
    processo.exit(codigo);
  }

  for (const sinal of SINAIS_ENCERRAMENTO) {
    processo.once(sinal, () => {
      encerrar(sinal);
    });
  }
  return encerrar;
}
