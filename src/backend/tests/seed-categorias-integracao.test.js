// QA (Issue #38): o ponto de entrada prisma/seed.js chama o seed de categorias
// com o process.env e, em produção, não cria categorias. Sem banco: o client
// Prisma e o seed de usuários são substituídos. Somente dados fictícios (RN05).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  createMany: vi.fn(),
  disconnect: vi.fn(),
  seedUsuarios: vi.fn(),
}));

vi.mock('../src/lib/prisma.js', () => ({
  default: {},
  criarPrismaClient: () => ({
    categoria: { findMany: mocks.findMany, createMany: mocks.createMany },
    $disconnect: mocks.disconnect,
  }),
}));

vi.mock('../prisma/seed-usuarios.js', async (importOriginal) => ({
  ...(await importOriginal()),
  executarSeedUsuarios: mocks.seedUsuarios,
}));

const NODE_ENV_ORIGINAL = process.env.NODE_ENV;
let banco;

beforeEach(() => {
  vi.resetModules();
  banco = [];
  mocks.findMany.mockReset().mockImplementation(async () => banco.map((c) => ({ nome: c.nome })));
  mocks.createMany.mockReset().mockImplementation(async ({ data }) => {
    banco.push(...data);
    return { count: data.length };
  });
  mocks.disconnect.mockReset().mockResolvedValue();
  mocks.seedUsuarios.mockReset().mockResolvedValue({ criados: [], existentes: [] });
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  process.env.NODE_ENV = NODE_ENV_ORIGINAL;
  process.exitCode = undefined;
  vi.restoreAllMocks();
});

async function executarSeed() {
  await import('../prisma/seed.js');
  await vi.waitFor(() => expect(mocks.disconnect).toHaveBeenCalled());
}

describe('prisma/seed.js — categorias', () => {
  it('em produção não lê nem cria categorias', async () => {
    process.env.NODE_ENV = 'production';
    await executarSeed();
    expect(mocks.findMany).not.toHaveBeenCalled();
    expect(mocks.createMany).not.toHaveBeenCalled();
    expect(banco).toHaveLength(0);
    expect(process.exitCode).toBeUndefined();
  });

  it('em desenvolvimento cria as 6 categorias e, executado de novo, não duplica', async () => {
    process.env.NODE_ENV = 'development';
    await executarSeed();
    expect(banco.map((c) => c.nome)).toEqual([
      'Indisciplina',
      'Conflitos',
      'Bullying',
      'Agressões',
      'Evasão',
      'Sofrimento emocional',
    ]);

    vi.resetModules();
    mocks.disconnect.mockClear();
    await executarSeed();
    expect(banco).toHaveLength(6);
    expect(mocks.createMany).toHaveBeenCalledTimes(1);
    expect(process.exitCode).toBeUndefined();
  });

  it('falha no banco durante o seed de categorias mostra só a mensagem genérica e sai com código 1', async () => {
    process.env.NODE_ENV = 'development';
    mocks.findMany.mockRejectedValueOnce(new Error('host-ficticio:5432 usuario_ficticio'));
    await executarSeed();
    await vi.waitFor(() => expect(process.exitCode).toBe(1));
    const mensagens = console.error.mock.calls.flat().join(' ');
    expect(mensagens).not.toContain('host-ficticio');
  });
});
