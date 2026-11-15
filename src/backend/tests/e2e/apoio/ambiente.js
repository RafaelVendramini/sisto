// Preparação do ambiente dos testes de ponta a ponta (Issue #93) — roda antes
// de cada arquivo de tests/e2e (setupFiles do vitest.e2e.config.js).
//
// TRAVA DE SEGURANÇA: estes testes APAGAM todas as tabelas do banco. Só
// seguem se a DATABASE_URL apontar para um banco cujo nome termina em
// "_test" (a mesma regra de prisma/reset-test-db.js). Qualquer outro banco —
// em especial o de desenvolvimento — aborta a suíte antes de conectar.
//
// Somente dados fictícios (RN05).

/** Segredo JWT fictício, usado só nos testes (mesmo padrão dos testes unitários). */
export const SEGREDO_JWT_TESTE = 'segredo-ficticio-de-teste-e2e-com-mais-de-32-caracteres';

/**
 * Nome do banco da DATABASE_URL, ou lança erro se ela não for de um banco de testes.
 * @param {string | undefined} url
 * @returns {string}
 */
export function nomeBancoDeTeste(url) {
  if (!url) {
    throw new Error(
      'Testes e2e abortados: DATABASE_URL não definida. Crie o src/backend/.env.test ' +
        '(DATABASE_URL do banco sisto_test), rode `npm run db:test:reset` e use `npm run test:e2e`.',
    );
  }
  let nome;
  let host;
  try {
    const endereco = new URL(url);
    nome = decodeURIComponent(endereco.pathname.replace(/^\//, ''));
    host = endereco.hostname;
  } catch {
    throw new Error('Testes e2e abortados: DATABASE_URL inválida (confira o .env.test).');
  }
  if (!nome.endsWith('_test')) {
    // Não mostra a URL (pode ter senha); só o nome do banco.
    throw new Error(
      `Testes e2e abortados: o banco "${nome}" não termina em "_test". ` +
        'Estes testes apagam todas as tabelas e só rodam no banco de testes. ' +
        'Se a DATABASE_URL estiver definida no terminal, ela vence a do .env.test.',
    );
  }
  // Só banco local: nunca apagar um banco remoto que por acaso termine em "_test".
  if (!['localhost', '127.0.0.1', '[::1]', '::1'].includes(host)) {
    throw new Error(
      `Testes e2e abortados: o banco de testes precisa ser local (host "${host}" não é localhost).`,
    );
  }
  return nome;
}

nomeBancoDeTeste(process.env.DATABASE_URL);

process.env.JWT_SECRET = SEGREDO_JWT_TESTE;
process.env.NODE_ENV = 'test';
