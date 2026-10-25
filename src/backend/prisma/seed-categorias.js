// Lógica do seed de categorias de exemplo — Sisto (Issue #38).
// Separada da execução (prisma/seed.js) para ser testada sem banco: o client
// Prisma e as variáveis de ambiente são injetados.
//
// Regras (Seção 11 do SSD, "Seeds"; RN05):
// - Somente no seed de DESENVOLVIMENTO (NODE_ENV !== 'production'). Em
//   produção nenhuma categoria é criada: a Gestão cadastra as categorias reais.
// - Categorias de exemplo da Seção 11 do SSD (que remete à Seção 2): indisciplina, conflitos, bullying,
//   agressões, evasão e sofrimento emocional (sem descrição).
// - Idempotente: a categoria só é criada se ainda não existir outra com o
//   mesmo nome, comparado como na RN18 (sem diferenciar maiúsculas/minúsculas
//   e ignorando espaços nas pontas). Categorias existentes não são alteradas.
import { chaveNomeCategoria } from '../src/services/categorias.js';
import { ehProducao } from './seed-usuarios.js';

/** Categorias de exemplo do seed de desenvolvimento (Seção 11 do SSD). */
export const CATEGORIAS_EXEMPLO = Object.freeze([
  'Indisciplina',
  'Conflitos',
  'Bullying',
  'Agressões',
  'Evasão',
  'Sofrimento emocional',
]);

/**
 * Executa o seed de categorias com o client Prisma informado.
 * @param {object} prisma PrismaClient (ou fake com categoria.findMany/createMany)
 * @param {Record<string, string | undefined>} [env] padrão: process.env
 * @returns {Promise<{ ignorado: boolean, criadas: string[], existentes: string[] }>}
 *   ignorado = true em produção (nada é lido nem gravado)
 */
export async function executarSeedCategorias(prisma, env = process.env) {
  if (ehProducao(env)) {
    return { ignorado: true, criadas: [], existentes: [] };
  }

  const atuais = await prisma.categoria.findMany({ select: { nome: true } });
  const chavesAtuais = new Set(atuais.map((c) => chaveNomeCategoria(c.nome)));

  const criadas = CATEGORIAS_EXEMPLO.filter((nome) => !chavesAtuais.has(chaveNomeCategoria(nome)));
  const existentes = CATEGORIAS_EXEMPLO.filter((nome) => chavesAtuais.has(chaveNomeCategoria(nome)));

  if (criadas.length > 0) {
    await prisma.categoria.createMany({ data: criadas.map((nome) => ({ nome })) });
  }

  return { ignorado: false, criadas, existentes };
}
