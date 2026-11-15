import { defineConfig } from 'vitest/config';

// Testes de ponta a ponta pela API (Issue #93): app real (Supertest) + banco
// de testes REAL (PostgreSQL, DATABASE_URL do .env.test). Rodar com
// `npm run test:e2e` (o script carrega o .env.test); o `npm test` normal não
// roda esta pasta (ver vitest.config.js).
//
// - setupFiles: trava de segurança (aborta se a DATABASE_URL não for de um
//   banco "_test") e segredo JWT fictício, antes de qualquer teste.
// - fileParallelism: false — todos os arquivos usam o MESMO banco e cada um
//   limpa as tabelas no início; em paralelo, um apagaria os dados do outro.
// - execArgv: mesma mitigação do vitest.config.js (quedas 0xC0000409 no Windows).
export default defineConfig({
  test: {
    include: ['tests/e2e/**/*.test.js'],
    setupFiles: ['tests/e2e/apoio/ambiente.js'],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
    execArgv: ['--no-maglev'],
  },
});
