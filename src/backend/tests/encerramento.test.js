// Testes do encerramento limpo da API (lib/encerramento.js — Issue #129).
// Sem abrir portas: o servidor HTTP e o processo são falsos (EventEmitter),
// e o "tempo" do prazo é controlado com timers falsos do Vitest.
import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  PRAZO_ENCERRAMENTO_MS,
  SINAIS_ENCERRAMENTO,
  registrarEncerramentoLimpo,
} from '../src/lib/encerramento.js';

function processoFalso() {
  const processo = new EventEmitter();
  processo.exit = vi.fn();
  return processo;
}

function servidorFalso({ erro = null, manual = false } = {}) {
  const servidor = { close: vi.fn(), fechar: null };
  servidor.close.mockImplementation((callback) => {
    if (manual) servidor.fechar = callback;
    else callback(erro ?? undefined);
  });
  return servidor;
}

const registroMudo = () => ({ log: vi.fn(), error: vi.fn() });

/** Espera as promessas pendentes do encerramento. */
const aguardar = () => new Promise((resolver) => setImmediate(resolver));

afterEach(() => {
  vi.useRealTimers();
});

describe('registrarEncerramentoLimpo', () => {
  it('registra SIGTERM e SIGINT', () => {
    const processo = processoFalso();
    registrarEncerramentoLimpo(servidorFalso(), { processo, registro: registroMudo() });
    expect(SINAIS_ENCERRAMENTO).toEqual(['SIGTERM', 'SIGINT']);
    for (const sinal of SINAIS_ENCERRAMENTO) expect(processo.listenerCount(sinal)).toBe(1);
  });

  it.each(['SIGTERM', 'SIGINT'])('%s: fecha o servidor, depois desconecta o Prisma e sai com 0', async (sinal) => {
    const ordem = [];
    const processo = processoFalso();
    processo.exit.mockImplementation((codigo) => ordem.push(`exit(${codigo})`));
    const servidor = servidorFalso();
    servidor.close.mockImplementation((callback) => {
      ordem.push('close');
      callback();
    });
    const desconectar = vi.fn(async () => {
      ordem.push('desconectar');
    });
    registrarEncerramentoLimpo(servidor, { processo, desconectar, registro: registroMudo() });

    processo.emit(sinal);
    await aguardar();

    expect(ordem).toEqual(['close', 'desconectar', 'exit(0)']);
  });

  it('espera as requisições em andamento (close) antes de desconectar o banco', async () => {
    const processo = processoFalso();
    const servidor = servidorFalso({ manual: true });
    const desconectar = vi.fn(async () => {});
    registrarEncerramentoLimpo(servidor, { processo, desconectar, registro: registroMudo() });

    processo.emit('SIGTERM');
    await aguardar();
    expect(desconectar).not.toHaveBeenCalled();
    expect(processo.exit).not.toHaveBeenCalled();

    servidor.fechar(); // a última requisição terminou
    await aguardar();
    expect(desconectar).toHaveBeenCalledTimes(1);
    expect(processo.exit).toHaveBeenCalledWith(0);
  });

  it('SIGTERM seguido de SIGINT não repete o encerramento', async () => {
    const processo = processoFalso();
    const servidor = servidorFalso();
    const desconectar = vi.fn(async () => {});
    registrarEncerramentoLimpo(servidor, { processo, desconectar, registro: registroMudo() });

    processo.emit('SIGTERM');
    processo.emit('SIGINT');
    await aguardar();

    expect(servidor.close).toHaveBeenCalledTimes(1);
    expect(desconectar).toHaveBeenCalledTimes(1);
    expect(processo.exit).toHaveBeenCalledTimes(1);
  });

  it('falha ao fechar o servidor: ainda desconecta o banco e sai com 1', async () => {
    const processo = processoFalso();
    const registro = registroMudo();
    const desconectar = vi.fn(async () => {});
    registrarEncerramentoLimpo(servidorFalso({ erro: new Error('falha fictícia') }), {
      processo,
      desconectar,
      registro,
    });

    processo.emit('SIGTERM');
    await aguardar();

    expect(desconectar).toHaveBeenCalledTimes(1);
    expect(processo.exit).toHaveBeenCalledWith(1);
    expect(registro.error).toHaveBeenCalled();
  });

  it('falha ao desconectar do banco: sai com 1', async () => {
    const processo = processoFalso();
    registrarEncerramentoLimpo(servidorFalso(), {
      processo,
      desconectar: vi.fn(async () => {
        throw new Error('falha fictícia');
      }),
      registro: registroMudo(),
    });

    processo.emit('SIGTERM');
    await aguardar();

    expect(processo.exit).toHaveBeenCalledWith(1);
  });

  it('requisição presa: esgotado o prazo, sai com 1 sem esperar mais', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const processo = processoFalso();
    const desconectar = vi.fn(async () => {});
    registrarEncerramentoLimpo(servidorFalso({ manual: true }), {
      processo,
      desconectar,
      registro: registroMudo(),
    });

    processo.emit('SIGTERM');
    vi.advanceTimersByTime(PRAZO_ENCERRAMENTO_MS - 1);
    expect(processo.exit).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(processo.exit).toHaveBeenCalledWith(1);
    expect(desconectar).not.toHaveBeenCalled();
  });
});
