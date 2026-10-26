// Testes do seed de estudantes fictícios (Issue #42) — sem banco, client injetado.
// Somente dados fictícios (RN05).
import { describe, it, expect } from 'vitest';
import {
  ESTUDANTES_EXEMPLO,
  EMAIL_TUTOR_FICTICIO,
  executarSeedEstudantes,
} from '../prisma/seed-estudantes.js';
import { TURMAS_EXEMPLO } from '../prisma/seed-turmas.js';

const TURMAS_DO_BANCO = TURMAS_EXEMPLO.map((t, i) => ({
  id: i + 10,
  nome: t.nome,
  etapa: t.etapa,
  ano_letivo: t.anoLetivo,
}));

function criarClientFake({ turmas = TURMAS_DO_BANCO, tutor, estudantes = [] } = {}) {
  const gravados = [...estudantes];
  const chamadas = { createMany: 0, leituras: 0 };
  return {
    gravados,
    chamadas,
    turma: {
      async findMany() {
        chamadas.leituras += 1;
        return turmas;
      },
    },
    usuario: {
      async findUnique({ where }) {
        chamadas.leituras += 1;
        return tutor && where.email === EMAIL_TUTOR_FICTICIO ? tutor : null;
      },
    },
    estudante: {
      async findMany({ where }) {
        chamadas.leituras += 1;
        return gravados
          .filter((e) => where.codigo_escolar.in.includes(e.codigo_escolar))
          .map((e) => ({ codigo_escolar: e.codigo_escolar }));
      },
      async createMany({ data }) {
        chamadas.createMany += 1;
        gravados.push(...data);
        return { count: data.length };
      },
    },
  };
}

const TUTOR_ATIVO = { id: 2, perfil: 'TUTOR', status: 'ATIVO' };

describe('Seed de estudantes fictícios', () => {
  it('só tem estudantes fictícios, com códigos TESTE- únicos e turmas do seed de turmas (RN05)', () => {
    expect(ESTUDANTES_EXEMPLO.length).toBeGreaterThan(0);
    for (const e of ESTUDANTES_EXEMPLO) {
      expect(e.nomeCompleto).toMatch(/^Estudante Fictício \d{2}$/);
      expect(e.codigoEscolar).toMatch(/^TESTE-\d{4}$/);
      expect(TURMAS_EXEMPLO).toContain(e.turma);
    }
    const codigos = ESTUDANTES_EXEMPLO.map((e) => e.codigoEscolar);
    expect(new Set(codigos).size).toBe(codigos.length);
    expect(ESTUDANTES_EXEMPLO.some((e) => e.comTutor)).toBe(true);
    expect(ESTUDANTES_EXEMPLO.some((e) => !e.comTutor)).toBe(true);
    expect(EMAIL_TUTOR_FICTICIO).toMatch(/@sisto\.exemplo$/);
  });

  it('fora de produção cria todos, nas turmas certas, com o tutor fictício ativo', async () => {
    const client = criarClientFake({ tutor: TUTOR_ATIVO });
    const resultado = await executarSeedEstudantes(client, { NODE_ENV: 'development' });
    expect(resultado.criados).toHaveLength(ESTUDANTES_EXEMPLO.length);
    expect(resultado.tutorIndisponivel).toBe(false);
    for (const exemplo of ESTUDANTES_EXEMPLO) {
      const gravado = client.gravados.find((g) => g.codigo_escolar === exemplo.codigoEscolar);
      const turma = TURMAS_DO_BANCO.find((t) => t.nome === exemplo.turma.nome && t.etapa === exemplo.turma.etapa);
      expect(gravado).toEqual({
        nome_completo: exemplo.nomeCompleto,
        codigo_escolar: exemplo.codigoEscolar,
        turma_id: turma.id,
        tutor_id: exemplo.comTutor ? TUTOR_ATIVO.id : null,
      });
    }
  });

  it('é idempotente: na segunda execução nada é criado', async () => {
    const client = criarClientFake({ tutor: TUTOR_ATIVO });
    await executarSeedEstudantes(client, {});
    const segunda = await executarSeedEstudantes(client, {});
    expect(segunda.criados).toHaveLength(0);
    expect(segunda.existentes).toHaveLength(ESTUDANTES_EXEMPLO.length);
    expect(client.chamadas.createMany).toBe(1);
  });

  it.each([
    ['ausente', undefined],
    ['bloqueado', { id: 2, perfil: 'TUTOR', status: 'BLOQUEADO' }],
    ['com outro perfil', { id: 2, perfil: 'PROFESSOR', status: 'ATIVO' }],
  ])('tutor fictício %s: cria sem tutor (RN13) e avisa', async (_caso, tutor) => {
    const client = criarClientFake({ tutor });
    const resultado = await executarSeedEstudantes(client, {});
    expect(client.gravados.every((g) => g.tutor_id === null)).toBe(true);
    expect(resultado.tutorIndisponivel).toBe(true);
  });

  it('turma fictícia ausente: o estudante é pulado e informado', async () => {
    const client = criarClientFake({ tutor: TUTOR_ATIVO, turmas: TURMAS_DO_BANCO.slice(1) });
    const resultado = await executarSeedEstudantes(client, {});
    const daPrimeira = ESTUDANTES_EXEMPLO.filter((e) => e.turma === TURMAS_EXEMPLO[0]);
    expect(resultado.semTurma).toEqual(daPrimeira);
    expect(client.gravados).toHaveLength(ESTUDANTES_EXEMPLO.length - daPrimeira.length);
  });

  it('em produção não lê nem grava nada', async () => {
    const client = criarClientFake({ tutor: TUTOR_ATIVO });
    const resultado = await executarSeedEstudantes(client, { NODE_ENV: 'production' });
    expect(resultado).toMatchObject({ ignorado: true, criados: [] });
    expect(client.chamadas).toEqual({ createMany: 0, leituras: 0 });
  });
});
