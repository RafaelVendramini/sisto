// Seed do banco — Sisto. Executado por `npm run db:seed` (prisma db seed).
// Somente dados fictícios (RN05, RNF06).
// - Usuários (Subtask #9), todos ATIVO:
//   - NODE_ENV=production: cria apenas o administrador de Gestão.
//   - Outros ambientes: 1 usuário por perfil (Gestão + 4 fictícios).
// - Categorias de exemplo (Issue #38): somente fora de produção; o seed de
//   produção não cria categorias (Seção 11 do SSD).
// Turmas e estudantes fictícios ainda não são criados pelo seed.
// A lógica fica em seed-usuarios.js e seed-categorias.js (testáveis sem banco).
// O .env já é carregado por prisma7.config.js quando executado via Prisma CLI.
import { criarPrismaClient } from '../src/lib/prisma.js';
import { executarSeedUsuarios, ErroValidacaoSeed } from './seed-usuarios.js';
import { executarSeedCategorias } from './seed-categorias.js';

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

    const categorias = await executarSeedCategorias(prisma, process.env);
    if (categorias.ignorado) {
      console.log('Seed de categorias: ignorado em produção (nenhuma categoria criada).');
    } else {
      console.log(
        `Seed de categorias: ${categorias.criadas.length} criada(s), ${categorias.existentes.length} já existente(s) (mantida(s) sem alteração).`,
      );
    }
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
