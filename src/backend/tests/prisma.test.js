import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// URL fictícia: nenhum destes testes abre conexão com o banco.
const URL_FICTICIA = 'postgresql://usuario_ficticio:senha_ficticia@localhost:5432/banco_ficticio';

async function importarModulo() {
  vi.resetModules();
  return import('../src/lib/prisma.js');
}

// O PrismaClient do Prisma 7 não é verificável por `instanceof` (o construtor
// devolve um objeto encapsulado), então checamos a interface pública.
function ehPrismaClient(objeto) {
  return (
    typeof objeto?.$connect === 'function' &&
    typeof objeto?.$disconnect === 'function' &&
    typeof objeto?.$transaction === 'function' &&
    typeof objeto?.$queryRaw === 'function'
  );
}

describe('Módulo único do PrismaClient (src/lib/prisma.js)', () => {
  beforeEach(() => {
    vi.stubEnv('DATABASE_URL', '');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('pode ser importado sem DATABASE_URL e sem conexão', async () => {
    const modulo = await importarModulo();

    expect(modulo.default).toBeDefined();
    expect(typeof modulo.obterPrisma).toBe('function');
    expect(typeof modulo.criarPrismaClient).toBe('function');
    expect(typeof modulo.desconectarPrisma).toBe('function');
  });

  it('criarPrismaClient falha com mensagem clara quando DATABASE_URL não está definida', async () => {
    const { criarPrismaClient } = await importarModulo();

    expect(() => criarPrismaClient()).toThrow(/DATABASE_URL não definida/);
  });

  it('o uso do cliente padrão sem DATABASE_URL também falha com mensagem clara', async () => {
    const { default: prisma } = await importarModulo();

    expect(() => prisma.$connect).toThrow(/DATABASE_URL não definida/);
  });

  it('criarPrismaClient retorna um PrismaClient quando recebe a URL', async () => {
    const { criarPrismaClient } = await importarModulo();

    const cliente = criarPrismaClient(URL_FICTICIA);

    expect(ehPrismaClient(cliente)).toBe(true);
    await cliente.$disconnect();
  });

  it('obterPrisma devolve sempre a mesma instância (singleton)', async () => {
    vi.stubEnv('DATABASE_URL', URL_FICTICIA);
    const { obterPrisma, desconectarPrisma } = await importarModulo();

    const primeira = obterPrisma();
    const segunda = obterPrisma();

    expect(ehPrismaClient(primeira)).toBe(true);
    expect(segunda === primeira).toBe(true);
    await desconectarPrisma();
  });

  it('o export padrão delega para a instância única', async () => {
    vi.stubEnv('DATABASE_URL', URL_FICTICIA);
    const { default: prisma, desconectarPrisma } = await importarModulo();

    expect(ehPrismaClient(prisma)).toBe(true);
    await desconectarPrisma();
  });

  it('desconectarPrisma descarta a instância, e o próximo uso cria outra', async () => {
    vi.stubEnv('DATABASE_URL', URL_FICTICIA);
    const { obterPrisma, desconectarPrisma } = await importarModulo();

    const antes = obterPrisma();
    await desconectarPrisma();
    const depois = obterPrisma();

    expect(depois === antes).toBe(false);
    await desconectarPrisma();
  });
});
