// Seed do banco — Sisto. Executado por `npm run db:seed` (prisma db seed).
// Sprint 1 (Subtask #9): somente usuários, todos ATIVO (RN05, RNF06).
// - NODE_ENV=production: cria apenas o administrador de Gestão.
// - Outros ambientes: 1 usuário por perfil (Gestão + 4 fictícios).
// Sem turmas, estudantes ou categorias nesta Sprint.
// A lógica fica em seed-usuarios.js (testável sem banco).
// O .env já é carregado por prisma7.config.js quando executado via Prisma CLI.
import { criarPrismaClient } from '../src/lib/prisma.js';
import { executarSeedUsuarios, ErroValidacaoSeed } from './seed-usuarios.js';

const MENSAGEM_FALHA_BANCO =
  'Falha ao conectar/gravar no banco — verifique DATABASE_URL e se o PostgreSQL está rodando.';

async function main() {
  const prisma = criarPrismaClient();
  try {
    const { criados, existentes } = await executarSeedUsuarios(prisma, process.env);
    // Somente contagens e perfis — nunca senhas, hashes, e-mails ou a DATABASE_URL.
    console.log(
      `Seed de usuários: ${criados.length} criado(s), ${existentes.length} já existente(s) (mantido(s) sem alteração).`,
    );
    for (const { perfil } of criados) console.log(`  + perfil ${perfil}`);
  } finally {
    await prisma.$disconnect().catch(() => {});
  }
}

main().catch((erro) => {
  // Só as mensagens de validação do próprio seed são exibidas por completo
  // (não contêm valores). Erros do Prisma/pg podem trazer detalhes internos
  // (host, usuário, consultas), então mostramos apenas uma mensagem genérica.
  console.error(erro instanceof ErroValidacaoSeed ? erro.message : MENSAGEM_FALHA_BANCO);
  process.exitCode = 1;
});
