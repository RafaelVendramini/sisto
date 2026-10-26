// Lógica do seed de estudantes fictícios — Sisto (Issue #42).
// Separada da execução (prisma/seed.js) para ser testada sem banco: o client
// Prisma e as variáveis de ambiente são injetados.
//
// Regras (Seção 11 do SSD, "Seeds"; RN05, RNF06):
// - Somente no seed de DESENVOLVIMENTO (NODE_ENV !== 'production'). Em
//   produção nenhum estudante é criado: a Gestão cadastra os estudantes reais.
// - Estudantes FICTÍCIOS ("Estudante Fictício NN", código "TESTE-NNNN"), nas
//   turmas fictícias de seed-turmas.js, alguns vinculados ao tutor fictício de
//   seed-usuarios.js.
// - Roda depois dos seeds de usuários e turmas (ver prisma/seed.js).
// - Idempotente: o estudante é identificado pelo código escolar (único —
//   RN18). Estudantes existentes não são alterados.
// - RN13: o tutor só é vinculado se tiver perfil TUTOR e status ATIVO; senão o
//   estudante é criado sem tutor.
// - Turma fictícia não encontrada (ex.: editada pela Gestão): o estudante é
//   pulado e informado no resumo, sem interromper o seed.
import { chaveTurma } from '../src/services/turmas.js';
import { TURMAS_EXEMPLO } from './seed-turmas.js';
import { USUARIOS_FICTICIOS, ehProducao } from './seed-usuarios.js';

/** E-mail do tutor fictício criado por seed-usuarios.js. */
export const EMAIL_TUTOR_FICTICIO = USUARIOS_FICTICIOS.find((u) => u.perfil === 'TUTOR').email;

const [TURMA_6A, TURMA_7B, TURMA_1A_EM, TURMA_2B_EM] = TURMAS_EXEMPLO;

/** Estudantes fictícios do seed de desenvolvimento (RN05). */
export const ESTUDANTES_EXEMPLO = Object.freeze([
  Object.freeze({ nomeCompleto: 'Estudante Fictício 01', codigoEscolar: 'TESTE-0001', turma: TURMA_6A, comTutor: true }),
  Object.freeze({ nomeCompleto: 'Estudante Fictício 02', codigoEscolar: 'TESTE-0002', turma: TURMA_6A, comTutor: false }),
  Object.freeze({ nomeCompleto: 'Estudante Fictício 03', codigoEscolar: 'TESTE-0003', turma: TURMA_7B, comTutor: true }),
  Object.freeze({ nomeCompleto: 'Estudante Fictício 04', codigoEscolar: 'TESTE-0004', turma: TURMA_1A_EM, comTutor: true }),
  Object.freeze({ nomeCompleto: 'Estudante Fictício 05', codigoEscolar: 'TESTE-0005', turma: TURMA_2B_EM, comTutor: false }),
  Object.freeze({ nomeCompleto: 'Estudante Fictício 06', codigoEscolar: 'TESTE-0006', turma: TURMA_2B_EM, comTutor: true }),
]);

/**
 * Executa o seed de estudantes com o client Prisma informado.
 * @param {object} prisma PrismaClient (ou fake com turma.findMany,
 *   usuario.findUnique, estudante.findMany e estudante.createMany)
 * @param {Record<string, string | undefined>} [env] padrão: process.env
 * @returns {Promise<{ ignorado: boolean, criados: object[], existentes: object[],
 *   semTurma: object[], tutorIndisponivel: boolean }>}
 *   ignorado = true em produção (nada é lido nem gravado)
 */
export async function executarSeedEstudantes(prisma, env = process.env) {
  if (ehProducao(env)) {
    return { ignorado: true, criados: [], existentes: [], semTurma: [], tutorIndisponivel: false };
  }

  const turmas = await prisma.turma.findMany({
    select: { id: true, nome: true, etapa: true, ano_letivo: true },
    orderBy: { id: 'asc' },
  });
  const idPorChave = new Map();
  for (const t of turmas) {
    const chave = chaveTurma({ nome: t.nome, etapa: t.etapa, anoLetivo: t.ano_letivo });
    if (!idPorChave.has(chave)) idPorChave.set(chave, t.id);
  }

  const tutor = await prisma.usuario.findUnique({
    where: { email: EMAIL_TUTOR_FICTICIO },
    select: { id: true, perfil: true, status: true },
  });
  const tutorId = tutor && tutor.perfil === 'TUTOR' && tutor.status === 'ATIVO' ? tutor.id : null;

  const codigos = ESTUDANTES_EXEMPLO.map((e) => e.codigoEscolar);
  const jaExistentes = await prisma.estudante.findMany({
    where: { codigo_escolar: { in: codigos } },
    select: { codigo_escolar: true },
  });
  const codigosExistentes = new Set(jaExistentes.map((e) => e.codigo_escolar));

  const existentes = ESTUDANTES_EXEMPLO.filter((e) => codigosExistentes.has(e.codigoEscolar));
  const pendentes = ESTUDANTES_EXEMPLO.filter((e) => !codigosExistentes.has(e.codigoEscolar));
  const semTurma = pendentes.filter((e) => !idPorChave.has(chaveTurma(e.turma)));
  const criados = pendentes.filter((e) => idPorChave.has(chaveTurma(e.turma)));

  if (criados.length > 0) {
    await prisma.estudante.createMany({
      data: criados.map((e) => ({
        nome_completo: e.nomeCompleto,
        codigo_escolar: e.codigoEscolar,
        turma_id: idPorChave.get(chaveTurma(e.turma)),
        tutor_id: e.comTutor ? tutorId : null,
      })),
    });
  }

  return {
    ignorado: false,
    criados,
    existentes,
    semTurma,
    tutorIndisponivel: tutorId === null && criados.some((e) => e.comTutor),
  };
}
