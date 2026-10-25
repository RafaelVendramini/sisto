// Lógica do seed de turmas fictícias — Sisto (Issue #40).
// Separada da execução (prisma/seed.js) para ser testada sem banco: o client
// Prisma e as variáveis de ambiente são injetados.
//
// Regras (Seção 11 do SSD, "Seeds"; RN05):
// - Somente no seed de DESENVOLVIMENTO (NODE_ENV !== 'production'). Em
//   produção nenhuma turma é criada: a Gestão cadastra as turmas reais.
// - Turmas FICTÍCIAS, apenas para desenvolvimento e testes manuais.
// - Idempotente: a turma só é criada se ainda não existir outra com o mesmo
//   trio (nome, etapa, ano letivo), comparado como na RN18. Turmas existentes
//   não são alteradas.
import { chaveTurma } from '../src/services/turmas.js';
import { ehProducao } from './seed-usuarios.js';

/** Turmas fictícias do seed de desenvolvimento (RN05). */
export const TURMAS_EXEMPLO = Object.freeze([
  Object.freeze({ nome: '6º A', etapa: 'Ensino Fundamental - Anos Finais', anoLetivo: 2026 }),
  Object.freeze({ nome: '7º B', etapa: 'Ensino Fundamental - Anos Finais', anoLetivo: 2026 }),
  Object.freeze({ nome: '1º A', etapa: 'Ensino Médio', anoLetivo: 2026 }),
  Object.freeze({ nome: '2º B', etapa: 'Ensino Médio', anoLetivo: 2026 }),
]);

/**
 * Executa o seed de turmas com o client Prisma informado.
 * @param {object} prisma PrismaClient (ou fake com turma.findMany/createMany)
 * @param {Record<string, string | undefined>} [env] padrão: process.env
 * @returns {Promise<{ ignorado: boolean, criadas: object[], existentes: object[] }>}
 *   ignorado = true em produção (nada é lido nem gravado)
 */
export async function executarSeedTurmas(prisma, env = process.env) {
  if (ehProducao(env)) {
    return { ignorado: true, criadas: [], existentes: [] };
  }

  const atuais = await prisma.turma.findMany({
    select: { nome: true, etapa: true, ano_letivo: true },
  });
  const chavesAtuais = new Set(
    atuais.map((t) => chaveTurma({ nome: t.nome, etapa: t.etapa, anoLetivo: t.ano_letivo })),
  );

  const criadas = TURMAS_EXEMPLO.filter((t) => !chavesAtuais.has(chaveTurma(t)));
  const existentes = TURMAS_EXEMPLO.filter((t) => chavesAtuais.has(chaveTurma(t)));

  if (criadas.length > 0) {
    await prisma.turma.createMany({
      data: criadas.map(({ nome, etapa, anoLetivo }) => ({ nome, etapa, ano_letivo: anoLetivo })),
    });
  }

  return { ignorado: false, criadas, existentes };
}
