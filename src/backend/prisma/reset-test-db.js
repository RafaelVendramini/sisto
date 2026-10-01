// Recria o banco de testes (migrate reset) usando a DATABASE_URL do .env.test.
// Trava de segurança: só executa se o nome do banco terminar em "_test",
// para nunca apagar o banco de desenvolvimento por engano.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const arquivoEnvTest = fileURLToPath(new URL('../.env.test', import.meta.url));

if (!existsSync(arquivoEnvTest)) {
  console.error('Arquivo .env.test não encontrado em src/backend (ver .env.example).');
  process.exit(1);
}

process.loadEnvFile(arquivoEnvTest);

let nomeBanco = '';
try {
  nomeBanco = new URL(process.env.DATABASE_URL).pathname.replace(/^\//, '');
} catch {
  console.error('DATABASE_URL ausente ou inválida no .env.test.');
  process.exit(1);
}

if (!nomeBanco.endsWith('_test')) {
  console.error(`Reset recusado: o banco "${nomeBanco}" não termina em "_test".`);
  process.exit(1);
}

const cli = fileURLToPath(new URL('../node_modules/prisma/build/index.js', import.meta.url));
const resultado = spawnSync(process.execPath, [cli, 'migrate', 'reset', '--force'], {
  stdio: 'inherit',
  env: process.env,
});

process.exit(resultado.status ?? 1);
