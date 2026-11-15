// Testes do seed de categorias de exemplo (Issue #38) — sem banco, client injetado.
import { describe, it, expect } from 'vitest';
import { CATEGORIAS_EXEMPLO, executarSeedCategorias } from '../prisma/seed-categorias.js';

/** Client Prisma falso, em memória, só com o que o seed de categorias usa. */
function criarClientFake(iniciais = []) {
  const categorias = iniciais.map((nome, i) => ({ id: i + 1, nome, descricao: null }));
  const chamadas = { findMany: 0, createMany: 0 };
  return {
    categorias,
    chamadas,
    categoria: {
      async findMany({ select }) {
        chamadas.findMany += 1;
        return categorias.map((c) => (select?.nome ? { nome: c.nome } : { ...c }));
      },
      async createMany({ data }) {
        chamadas.createMany += 1;
        for (const item of data) {
          categorias.push({ id: categorias.length + 1, descricao: null, ...item });
        }
        return { count: data.length };
      },
    },
  };
}

describe('Seed de categorias de exemplo', () => {
  it('lista as 6 categorias de exemplo da Seção 11', () => {
    expect(CATEGORIAS_EXEMPLO).toEqual([
      'Indisciplina',
      'Conflitos',
      'Bullying',
      'Agressões',
      'Evasão',
      'Sofrimento emocional',
    ]);
  });

  it('fora de produção cria as 6 categorias', async () => {
    const db = criarClientFake();
    const resultado = await executarSeedCategorias(db, {});
    expect(resultado).toEqual({ ignorado: false, criadas: [...CATEGORIAS_EXEMPLO], existentes: [] });
    expect(db.categorias.map((c) => c.nome)).toEqual([...CATEGORIAS_EXEMPLO]);
  });

  it('é idempotente: a segunda execução não duplica nem grava', async () => {
    const db = criarClientFake();
    await executarSeedCategorias(db, { NODE_ENV: 'development' });
    const segunda = await executarSeedCategorias(db, { NODE_ENV: 'development' });
    expect(segunda.criadas).toEqual([]);
    expect(segunda.existentes).toEqual([...CATEGORIAS_EXEMPLO]);
    expect(db.categorias).toHaveLength(CATEGORIAS_EXEMPLO.length);
    expect(db.chamadas.createMany).toBe(1);
  });

  it('cria só as ausentes, comparando nomes como na RN18 (caixa e espaços)', async () => {
    const db = criarClientFake(['  BULLYING ', 'evasão', 'Categoria Fictícia Própria']);
    const resultado = await executarSeedCategorias(db, {});
    expect(resultado.existentes).toEqual(['Bullying', 'Evasão']);
    expect(resultado.criadas).toEqual(['Indisciplina', 'Conflitos', 'Agressões', 'Sofrimento emocional']);
    expect(db.categorias).toHaveLength(7);
    // Existentes não são alteradas.
    expect(db.categorias[0].nome).toBe('  BULLYING ');
  });

  it('em produção não cria categorias e não acessa o banco', async () => {
    const db = criarClientFake();
    const resultado = await executarSeedCategorias(db, { NODE_ENV: 'production' });
    expect(resultado).toEqual({ ignorado: true, criadas: [], existentes: [] });
    expect(db.chamadas).toEqual({ findMany: 0, createMany: 0 });
    expect(db.categorias).toHaveLength(0);
  });
});
