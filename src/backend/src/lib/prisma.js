// Módulo único de acesso ao banco (camada de dados) — Sisto.
// Os services devem importar daqui; não instancie PrismaClient em outro lugar.
//
//   import prisma from '../lib/prisma.js';
//   const turmas = await prisma.turma.findMany();
//
// O client é criado de forma preguiçosa (no primeiro uso), para que importar
// este módulo não exija DATABASE_URL nem conexão — os testes que não usam
// banco continuam independentes do PostgreSQL.
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

let instancia = null;

/**
 * Cria um novo PrismaClient conectado ao PostgreSQL via driver adapter (Prisma 7).
 * A conexão só é aberta na primeira consulta.
 * @param {string} [connectionString] padrão: process.env.DATABASE_URL
 */
export function criarPrismaClient(connectionString = process.env.DATABASE_URL) {
  if (!connectionString) {
    throw new Error(
      'DATABASE_URL não definida. Configure-a no arquivo .env do back-end (veja .env.example).',
    );
  }

  const adapter = new PrismaPg({ connectionString });
  return new PrismaClient({ adapter });
}

/** Retorna a instância única do PrismaClient, criando-a no primeiro uso. */
export function obterPrisma() {
  if (!instancia) {
    instancia = criarPrismaClient();
  }
  return instancia;
}

/** Encerra a conexão da instância única (ex.: desligamento do servidor, testes). */
export async function desconectarPrisma() {
  if (instancia) {
    const atual = instancia;
    instancia = null;
    await atual.$disconnect();
  }
}

// Exporta um objeto que delega para a instância única, criada sob demanda.
const prisma = new Proxy(
  {},
  {
    get(_alvo, propriedade) {
      const cliente = obterPrisma();
      const valor = Reflect.get(cliente, propriedade);
      return typeof valor === 'function' ? valor.bind(cliente) : valor;
    },
  },
);

export default prisma;
