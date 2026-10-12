import { defineConfig } from 'vitest/config';

// Mitigação de queda intermitente dos workers do Vitest no Windows
// ("Worker exited unexpectedly with exit code 3221226505" = 0xC0000409,
// fast-fail nativo, sem relatório de erro do Node). Medições locais
// (Node 24.15, Vitest 5.0.3, Windows 11), rodando
// tests/autenticacao.test.js + tests/usuarios.test.js 30 vezes:
//   - sem flags ............ 4/30 quedas
//   - --max-opt=0 .......... 3/30 quedas
//   - --no-maglev .......... 0/60 quedas
// A queda também ocorria em arquivos já existentes (autenticacao 6/40,
// auth 2/40) e com o bcrypt nativo substituído por um fake, ou seja, não é
// causada pelo bcrypt. A evidência aponta para o compilador JIT Maglev do V8.
// --no-maglev só afeta os processos de teste (os demais níveis do JIT seguem
// ativos); não muda o comportamento do código testado.
export default defineConfig({
  test: {
    execArgv: ['--no-maglev'],
  },
});
