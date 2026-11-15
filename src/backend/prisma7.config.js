// Configuração do Prisma CLI (Prisma 7) — Sisto.
// O Prisma 7 não carrega o .env sozinho: usamos o carregador nativo do Node
// (process.loadEnvFile), sem dependência extra. Variáveis já definidas no
// ambiente têm prioridade sobre o .env — é assim que o banco de testes
// sobrescreve a DATABASE_URL (ver scripts db:test:* e .env.example).
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'prisma/config';

const arquivoEnv = fileURLToPath(new URL('./.env', import.meta.url));

if (existsSync(arquivoEnv)) {
  process.loadEnvFile(arquivoEnv);
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'node prisma/seed.js',
  },
  datasource: {
    url: process.env.DATABASE_URL,
  },
});
