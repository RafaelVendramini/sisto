// Testes do seed de turmas fictícias (Issue #40) — sem banco, client injetado.
// Somente dados fictícios (RN05).
import { describe, it, expect } from 'vitest';
import { TURMAS_EXEMPLO, executarSeedTurmas } from '../prisma/seed-turmas.js';

/** Client Prisma falso, em memória, só com o que o seed de turmas usa. */
function criarClientFake(iniciais = []) {
  const turmas = iniciais.map((t, i) => ({ id: i + 1, ...t }));
  const chamadas = { findMany: 0, createMany: 0 };
  return {
    turmas,
    chamadas,
    turma: {
      async findMany() {
        chamadas.findMany += 1;
        return turmas.map(({ nome, etapa, ano_letivo }) => ({ nome, etapa, ano_letivo }));
      },
      async createMany({ data }) {
        chamadas.createMany += 1;
        for (const item of data) turmas.push({ id: turmas.length + 1, ...item });
        return { count: data.length };
      },
    },
  };
}

describe('Seed de turmas fictícias', () => {
  it('tem turmas fictícias com nome, etapa e ano letivo de 4 dígitos, sem trio repetido', () => {
    expect(TURMAS_EXEMPLO.length).toBeGreaterThan(0);
    for (const turma of TURMAS_EXEMPLO) {
      expect(turma.nome.trim()).not.toBe('');
      expect(turma.etapa.trim()).not.toBe('');
      expect(Number.isInteger(turma.anoLetivo)).toBe(true);
      expect(String(turma.anoLetivo)).toMatch(/^\d{4}$/);
    }
    const chaves = TURMAS_EXEMPLO.map((t) => `${t.nome}|${t.etapa}|${t.anoLetivo}`.toLowerCase());
    expect(new Set(chaves).size).toBe(chaves.length);
  });

  it('fora de produção cria todas as turmas, gravando ano_letivo (snake_case)', async () => {
    const db = criarClientFake();
    const resultado = await executarSeedTurmas(db, {});
    expect(resultado.ignorado).toBe(false);
    expect(resultado.criadas).toEqual([...TURMAS_EXEMPLO]);
    expect(resultado.existentes).toEqual([]);
    expect(db.turmas.map(({ nome, etapa, ano_letivo }) => ({ nome, etapa, anoLetivo: ano_letivo }))).toEqual(
      TURMAS_EXEMPLO.map((t) => ({ ...t })),
    );
  });

  it('é idempotente: a segunda execução não duplica nem grava', async () => {
    const db = criarClientFake();
    await executarSeedTurmas(db, { NODE_ENV: 'development' });
    const segunda = await executarSeedTurmas(db, { NODE_ENV: 'development' });
    expect(segunda.criadas).toEqual([]);
    expect(segunda.existentes).toEqual([...TURMAS_EXEMPLO]);
    expect(db.turmas).toHaveLength(TURMAS_EXEMPLO.length);
    expect(db.chamadas.createMany).toBe(1);
  });

  it('compara o trio como na RN18 (caixa e espaços) e trata outro ano letivo como turma diferente', async () => {
    const [primeira] = TURMAS_EXEMPLO;
    const db = criarClientFake([
      { nome: `  ${primeira.nome.toUpperCase()} `, etapa: primeira.etapa.toLowerCase(), ano_letivo: primeira.anoLetivo },
      { nome: primeira.nome, etapa: primeira.etapa, ano_letivo: primeira.anoLetivo - 1 },
    ]);
    const resultado = await executarSeedTurmas(db, {});
    expect(resultado.existentes).toEqual([primeira]);
    expect(resultado.criadas).toEqual(TURMAS_EXEMPLO.slice(1));
    // Existentes não são alteradas.
    expect(db.turmas[0].nome).toBe(`  ${primeira.nome.toUpperCase()} `);
  });

  it('em produção não cria turmas e não acessa o banco', async () => {
    const db = criarClientFake();
    const resultado = await executarSeedTurmas(db, { NODE_ENV: 'production' });
    expect(resultado).toEqual({ ignorado: true, criadas: [], existentes: [] });
    expect(db.chamadas).toEqual({ findMany: 0, createMany: 0 });
  });
});
