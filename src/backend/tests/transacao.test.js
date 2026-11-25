// Testes do helper único da transação serializável (lib/transacao.js — Issue
// #129) e do mapeamento do P2002 dos índices únicos da RN18 para o 409 dos
// services de categorias e turmas. Sem banco: o client é um fake com
// $transaction. Somente dados fictícios (RN05).
import { describe, it, expect, vi } from 'vitest';
import { CODIGOS_ERRO, ErroHttp } from '../src/lib/erros.js';
import {
  ESPERA_MAXIMA_MS,
  ESPERA_MINIMA_MS,
  TENTATIVAS_TRANSACAO,
  calcularEspera,
  ehConflitoDeSerializacao,
  emTransacaoSerializavel,
} from '../src/lib/transacao.js';
import {
  MENSAGEM_CATEGORIA_DUPLICADA,
  MENSAGEM_CONFLITO_CONCORRENTE_CATEGORIA,
  atualizarCategoria,
  criarCategoria,
} from '../src/services/categorias.js';
import {
  MENSAGEM_CONFLITO_CONCORRENTE_TURMA,
  MENSAGEM_TURMA_DUPLICADA,
  atualizarTurma,
  criarTurma,
} from '../src/services/turmas.js';

const MENSAGEM = 'Conflito fictício. Tente novamente.';
const erroPrisma = (code) => Object.assign(new Error(`Erro fictício do Prisma (${code})`), { code });

/** Fake do client: cada chamada de $transaction consome o próximo resultado da fila. */
function dbComResultados(...resultados) {
  const fila = [...resultados];
  return {
    $transaction: vi.fn(async (operacao) => {
      const proximo = fila.shift();
      if (proximo instanceof Error) throw proximo;
      return operacao({ marcador: 'tx', valor: proximo });
    }),
  };
}

const semEspera = () => vi.fn(async () => {});

describe('emTransacaoSerializavel — caminho feliz', () => {
  it('devolve o resultado da operação e usa o nível SERIALIZABLE', async () => {
    const db = dbComResultados('ok');
    const resultado = await emTransacaoSerializavel(db, async (tx) => `resultado-${tx.valor}`, {
      mensagemConflito: MENSAGEM,
    });
    expect(resultado).toBe('resultado-ok');
    expect(db.$transaction).toHaveBeenCalledTimes(1);
    expect(db.$transaction.mock.calls[0][1]).toEqual({ isolationLevel: 'Serializable' });
  });
});

describe('emTransacaoSerializavel — P2034 (conflito de serialização)', () => {
  it('repete após uma espera e devolve o resultado da tentativa seguinte', async () => {
    const esperar = semEspera();
    const db = dbComResultados(erroPrisma('P2034'), 'segunda');
    const resultado = await emTransacaoSerializavel(db, async (tx) => tx.valor, {
      mensagemConflito: MENSAGEM,
      esperar,
    });
    expect(resultado).toBe('segunda');
    expect(db.$transaction).toHaveBeenCalledTimes(2);
    expect(esperar).toHaveBeenCalledTimes(1);
    expect(esperar).toHaveBeenCalledWith(1);
  });

  it(`esgotadas as ${TENTATIVAS_TRANSACAO} tentativas, responde 409 CONFLITO_CONCORRENTE com a mensagem do service`, async () => {
    const esperar = semEspera();
    const conflitos = Array.from({ length: TENTATIVAS_TRANSACAO }, () => erroPrisma('P2034'));
    const db = dbComResultados(...conflitos, 'nunca');
    const promessa = emTransacaoSerializavel(db, async () => 'nunca', {
      mensagemConflito: MENSAGEM,
      esperar,
    });
    await expect(promessa).rejects.toMatchObject({
      status: 409,
      message: MENSAGEM,
      codigo: CODIGOS_ERRO.CONFLITO_CONCORRENTE,
    });
    await expect(promessa).rejects.toBeInstanceOf(ErroHttp);
    expect(db.$transaction).toHaveBeenCalledTimes(TENTATIVAS_TRANSACAO);
    // Espera só ENTRE as tentativas (não depois da última).
    expect(esperar.mock.calls).toEqual(Array.from({ length: TENTATIVAS_TRANSACAO - 1 }, (_, i) => [i + 1]));
  });

  it('usa 5 tentativas (Issue #12): 3 conflitos seguidos ainda se resolvem na 4ª', async () => {
    expect(TENTATIVAS_TRANSACAO).toBe(5);
    const esperar = semEspera();
    const db = dbComResultados(erroPrisma('P2034'), erroPrisma('P2034'), erroPrisma('P2034'), 'quarta');
    const resultado = await emTransacaoSerializavel(db, async (tx) => tx.valor, {
      mensagemConflito: MENSAGEM,
      esperar,
    });
    expect(resultado).toBe('quarta');
    expect(db.$transaction).toHaveBeenCalledTimes(4);
    expect(esperar.mock.calls).toEqual([[1], [2], [3]]);
  });

  it('não chama traduzirErro no P2034', async () => {
    const traduzirErro = vi.fn(() => new Error('não deveria'));
    const db = dbComResultados(erroPrisma('P2034'), 'ok');
    await emTransacaoSerializavel(db, async (tx) => tx.valor, {
      mensagemConflito: MENSAGEM,
      traduzirErro,
      esperar: semEspera(),
    });
    expect(traduzirErro).not.toHaveBeenCalled();
  });

  it('conflito detectado no COMMIT (DriverAdapterError "TransactionWriteConflict" do adapter-pg) também é repetido', async () => {
    // Formato medido no PostgreSQL real (Prisma 7.10 + adapter-pg): sem `code`.
    const conflitoNoCommit = Object.assign(new Error('TransactionWriteConflict'), {
      name: 'DriverAdapterError',
      cause: { originalCode: '40001', kind: 'TransactionWriteConflict' },
    });
    expect(ehConflitoDeSerializacao(conflitoNoCommit)).toBe(true);
    const esperar = semEspera();
    const db = dbComResultados(conflitoNoCommit, 'segunda');
    await expect(
      emTransacaoSerializavel(db, async (tx) => tx.valor, { mensagemConflito: MENSAGEM, esperar }),
    ).resolves.toBe('segunda');
    expect(esperar).toHaveBeenCalledTimes(1);

    const sempre = dbComResultados(...Array.from({ length: TENTATIVAS_TRANSACAO }, () => conflitoNoCommit));
    await expect(
      emTransacaoSerializavel(sempre, async () => 'x', { mensagemConflito: MENSAGEM, esperar: semEspera() }),
    ).rejects.toMatchObject({ status: 409, codigo: CODIGOS_ERRO.CONFLITO_CONCORRENTE });
  });

  it('outros erros do adapter (ex.: violação de unicidade) não são tratados como conflito', () => {
    const outro = Object.assign(new Error('UniqueConstraintViolation'), {
      name: 'DriverAdapterError',
      cause: { kind: 'UniqueConstraintViolation' },
    });
    expect(ehConflitoDeSerializacao(outro)).toBe(false);
    expect(ehConflitoDeSerializacao(erroPrisma('P2028'))).toBe(false);
    expect(ehConflitoDeSerializacao(undefined)).toBe(false);
  });

  it('a espera padrão é real e curta (sem injeção): a nova tentativa acontece', async () => {
    const db = dbComResultados(erroPrisma('P2034'), 'ok');
    await expect(
      emTransacaoSerializavel(db, async (tx) => tx.valor, { mensagemConflito: MENSAGEM }),
    ).resolves.toBe('ok');
  });
});

describe('emTransacaoSerializavel — P2028 (tempo da transação esgotado)', () => {
  it('responde 409 CONFLITO_CONCORRENTE sem nova tentativa e sem espera', async () => {
    const esperar = semEspera();
    const traduzirErro = vi.fn();
    const db = dbComResultados(erroPrisma('P2028'), 'nunca');
    await expect(
      emTransacaoSerializavel(db, async () => 'nunca', {
        mensagemConflito: MENSAGEM,
        traduzirErro,
        esperar,
      }),
    ).rejects.toMatchObject({ status: 409, message: MENSAGEM, codigo: CODIGOS_ERRO.CONFLITO_CONCORRENTE });
    expect(db.$transaction).toHaveBeenCalledTimes(1);
    expect(esperar).not.toHaveBeenCalled();
    expect(traduzirErro).not.toHaveBeenCalled();
  });
});

describe('emTransacaoSerializavel — outros erros', () => {
  it('ErroHttp da operação sobe sem repetição e sem tradução', async () => {
    const traduzirErro = vi.fn();
    const erro = new ErroHttp(404, 'Recurso fictício não encontrado.');
    const db = { $transaction: vi.fn(async (operacao) => operacao({})) };
    await expect(
      emTransacaoSerializavel(
        db,
        async () => {
          throw erro;
        },
        { mensagemConflito: MENSAGEM, traduzirErro, esperar: semEspera() },
      ),
    ).rejects.toBe(erro);
    expect(db.$transaction).toHaveBeenCalledTimes(1);
    expect(traduzirErro).not.toHaveBeenCalled();
  });

  it('usa o erro devolvido por traduzirErro (mapeamento próprio do service)', async () => {
    const traduzido = new ErroHttp(409, 'Duplicado fictício.');
    const db = dbComResultados(erroPrisma('P2002'));
    await expect(
      emTransacaoSerializavel(db, async () => 'nunca', {
        mensagemConflito: MENSAGEM,
        traduzirErro: (erro) => (erro.code === 'P2002' ? traduzido : undefined),
      }),
    ).rejects.toBe(traduzido);
    expect(db.$transaction).toHaveBeenCalledTimes(1);
  });

  it('erro não traduzido (ou sem traduzirErro) sobe como está', async () => {
    const original = erroPrisma('P1001');
    await expect(
      emTransacaoSerializavel(dbComResultados(original), async () => 'x', {
        mensagemConflito: MENSAGEM,
        traduzirErro: () => undefined,
      }),
    ).rejects.toBe(original);
    const semCodigo = new Error('falha fictícia');
    await expect(
      emTransacaoSerializavel(dbComResultados(semCodigo), async () => 'x', { mensagemConflito: MENSAGEM }),
    ).rejects.toBe(semCodigo);
  });
});

describe('calcularEspera', () => {
  it.each([1, 2, 3])('fica entre o mínimo e o máximo multiplicados pela tentativa %i', (tentativa) => {
    expect(calcularEspera(tentativa, () => 0)).toBe(ESPERA_MINIMA_MS * tentativa);
    expect(calcularEspera(tentativa, () => 0.999999)).toBe(ESPERA_MAXIMA_MS * tentativa);
    const meio = calcularEspera(tentativa, () => 0.5);
    expect(meio).toBe(((ESPERA_MINIMA_MS + ESPERA_MAXIMA_MS) / 2) * tentativa);
  });

  it('com Math.random, o valor fica na faixa (10 a 50 ms × tentativa)', () => {
    for (let i = 0; i < 50; i += 1) {
      const espera = calcularEspera(2);
      expect(espera).toBeGreaterThanOrEqual(ESPERA_MINIMA_MS * 2);
      expect(espera).toBeLessThanOrEqual(ESPERA_MAXIMA_MS * 2);
    }
  });
});

// ---------------------------------------------------------------------------
// RN18 no banco (Issue #129): a violação dos índices únicos por expressão
// (P2002) vira o MESMO 409 da checagem do service.
// ---------------------------------------------------------------------------

/** Client fake: a checagem do service não acha duplicata, mas o banco recusa a gravação. */
function dbQueRecusaGravacao(modelo, codigo) {
  const tx = {
    [modelo]: {
      findMany: async () => [],
      findUnique: async () => ({ id: 1 }),
      create: async () => {
        throw erroPrisma(codigo);
      },
      update: async () => {
        throw erroPrisma(codigo);
      },
    },
    logAuditoria: { create: async () => ({ id: 1 }) },
  };
  return { $transaction: vi.fn(async (operacao) => operacao(tx)) };
}

const SOLICITANTE = { id: 1 };

describe('RN18 — P2002 do índice único vira 409 de duplicidade', () => {
  it('categoria (criação e edição): 409 CATEGORIA_DUPLICADA, sem nova tentativa', async () => {
    const db = dbQueRecusaGravacao('categoria', 'P2002');
    const esperado = {
      status: 409,
      message: MENSAGEM_CATEGORIA_DUPLICADA,
      codigo: CODIGOS_ERRO.CATEGORIA_DUPLICADA,
    };
    await expect(criarCategoria({ nome: ' bullying ' }, SOLICITANTE, { db })).rejects.toMatchObject(esperado);
    await expect(atualizarCategoria('1', { nome: 'Bullying' }, SOLICITANTE, { db })).rejects.toMatchObject(
      esperado,
    );
    expect(db.$transaction).toHaveBeenCalledTimes(2);
  });

  it('turma (criação e edição): 409 TURMA_DUPLICADA, sem nova tentativa', async () => {
    const db = dbQueRecusaGravacao('turma', 'P2002');
    const corpo = { nome: '6º A', etapa: 'Ensino Fundamental', anoLetivo: 2026 };
    const esperado = {
      status: 409,
      message: MENSAGEM_TURMA_DUPLICADA,
      codigo: CODIGOS_ERRO.TURMA_DUPLICADA,
    };
    await expect(criarTurma(corpo, SOLICITANTE, { db })).rejects.toMatchObject(esperado);
    await expect(atualizarTurma('1', corpo, SOLICITANTE, { db })).rejects.toMatchObject(esperado);
    expect(db.$transaction).toHaveBeenCalledTimes(2);
  });

  it('P2028 nas gravações de categoria e turma: 409 CONFLITO_CONCORRENTE com a mensagem de cada service', async () => {
    await expect(
      criarCategoria({ nome: 'Categoria Fictícia' }, SOLICITANTE, { db: dbQueRecusaGravacao('categoria', 'P2028') }),
    ).rejects.toMatchObject({
      status: 409,
      message: MENSAGEM_CONFLITO_CONCORRENTE_CATEGORIA,
      codigo: CODIGOS_ERRO.CONFLITO_CONCORRENTE,
    });
    await expect(
      criarTurma({ nome: '6º A', etapa: 'Ensino Fundamental', anoLetivo: 2026 }, SOLICITANTE, {
        db: dbQueRecusaGravacao('turma', 'P2028'),
      }),
    ).rejects.toMatchObject({
      status: 409,
      message: MENSAGEM_CONFLITO_CONCORRENTE_TURMA,
      codigo: CODIGOS_ERRO.CONFLITO_CONCORRENTE,
    });
  });
});
