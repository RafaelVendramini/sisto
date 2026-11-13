// Relatórios de quantidade de ocorrências — Sisto (Issue #88, RF13, UC05).
//
// - Contrato (Seção 12): GET /relatorios?tipo=&dataInicio=&dataFim=, todos
//   obrigatórios, restrito a GESTAO e PEDAGOGICO (permitirPerfis na rota).
//   Resposta: { tipo, dataInicio, dataFim, total, linhas: [{ id, rotulo, quantidade }] }.
// - Período: data/hora do FATO (data_hora — RN17), dias inteiros em São
//   Paulo com as duas pontas incluídas (services/periodo.js, mesma regra do
//   GET /ocorrencias).
// - RF14/RN19: a contagem SEMPRE passa por filtroVisibilidadeOcorrencias.
//   Hoje os dois perfis veem todas as ocorrências; se a matriz mudar, o
//   relatório acompanha sem alteração aqui.
// - Contagem: cada ocorrência conta UMA vez (conta-se a tabela de
//   ocorrências, não a de estudantes envolvidos) e entram todos os status.
// - Tipos: `periodo` só o total (linhas vazias); `turma` uma linha por turma
//   DA OCORRÊNCIA (turma_id gravado no registro — RN14), mesmo que o
//   estudante tenha mudado de turma; `categoria` uma linha por categoria.
//   Sem linhas com zero (o groupBy só devolve grupos existentes), em ordem
//   alfabética do rótulo (pt-BR) e, no empate, pelo id.
// - Sem dados pessoais: só ids e rótulos de turma/categoria e quantidades.
// - Leitura não grava histórico nem auditoria.
// - Desempenho: contagem no banco (count/groupBy), sem carregar ocorrências.
import prisma from '../lib/prisma.js';
import { ErroHttp } from '../lib/erros.js';
import { filtroVisibilidadeOcorrencias } from './ocorrencias.js';
import { interpretarPeriodo } from './periodo.js';

export const TIPOS_RELATORIO = Object.freeze(['periodo', 'turma', 'categoria']);

export const MENSAGEM_TIPO_RELATORIO_INVALIDO = `Informe tipo com um destes valores: ${TIPOS_RELATORIO.join(', ')}.`;

/** Perfis com acesso ao GET /relatorios (matriz da Seção 4, UC05). */
export const PERFIS_RELATORIOS = Object.freeze(['GESTAO', 'PEDAGOGICO']);

// Ordem alfabética natural (decisão do Rafael, 12/11/2026): números dentro do
// rótulo comparados pelo valor, então "6º A" vem antes de "10º A".
export const COMPARADOR_ROTULO = new Intl.Collator('pt-BR', { numeric: true });

/** Rótulo da turma: nome, etapa e ano letivo (mesmo formato das telas). */
export function rotuloTurma({ nome, etapa, ano_letivo: anoLetivo }) {
  return `${nome} — ${etapa} (${anoLetivo})`;
}

/**
 * Valida os parâmetros da query (tipo e período obrigatórios).
 * @param {{ tipo?: unknown, dataInicio?: unknown, dataFim?: unknown }} query req.query
 * @returns {{ tipo: string, dataInicio: string, dataFim: string, inicio: Date, fim: Date }}
 * @throws {ErroHttp} 400
 */
export function validarParametrosRelatorio(query = {}) {
  const { tipo, dataInicio, dataFim } = query ?? {};
  if (typeof tipo !== 'string' || !TIPOS_RELATORIO.includes(tipo)) {
    throw new ErroHttp(400, MENSAGEM_TIPO_RELATORIO_INVALIDO);
  }
  const { inicio, fim } = interpretarPeriodo({ dataInicio, dataFim }, { obrigatorio: true });
  return { tipo, dataInicio, dataFim, inicio, fim };
}

const ordenarLinhas = (linhas) =>
  linhas.sort((a, b) => COMPARADOR_ROTULO.compare(a.rotulo, b.rotulo) || a.id - b.id);

/**
 * Agrupa as ocorrências do filtro pelo campo informado e monta as linhas com
 * os rótulos lidos do cadastro (turmas/categorias não são excluídas — RN21).
 */
async function contarPorGrupo(db, where, campo, lerRotulos) {
  const grupos = await db.ocorrencia.groupBy({ by: [campo], where, _count: { _all: true } });
  if (grupos.length === 0) return { total: 0, linhas: [] };

  const rotuloPorId = await lerRotulos(grupos.map((g) => g[campo]));
  const linhas = grupos.map((g) => ({
    id: g[campo],
    rotulo: rotuloPorId.get(g[campo]),
    quantidade: g._count._all,
  }));
  // Cada ocorrência tem exatamente uma turma e uma categoria: o total é a
  // soma das linhas, da mesma consulta (não diverge por gravação concorrente).
  const total = linhas.reduce((soma, l) => soma + l.quantidade, 0);
  return { total, linhas: ordenarLinhas(linhas) };
}

/**
 * Gera o relatório de quantidade de ocorrências (RF13).
 * @param {object} query req.query ({ tipo, dataInicio, dataFim })
 * @param {{ id: number, perfil: string }} solicitante req.usuario
 * @param {object} [deps]
 * @param {object} [deps.db] client Prisma (injetável em testes)
 * @returns {Promise<{ tipo: string, dataInicio: string, dataFim: string, total: number,
 *   linhas: { id: number, rotulo: string, quantidade: number }[] }>}
 * @throws {ErroHttp} 400 (parâmetros inválidos)
 */
export async function gerarRelatorio(query, solicitante, { db = prisma } = {}) {
  const { tipo, dataInicio, dataFim, inicio, fim } = validarParametrosRelatorio(query);
  const where = {
    AND: [{ data_hora: { gte: inicio, lte: fim } }, filtroVisibilidadeOcorrencias(solicitante)],
  };

  let resultado;
  if (tipo === 'periodo') {
    resultado = { total: await db.ocorrencia.count({ where }), linhas: [] };
  } else if (tipo === 'turma') {
    resultado = await contarPorGrupo(db, where, 'turma_id', async (ids) => {
      const turmas = await db.turma.findMany({
        where: { id: { in: ids } },
        select: { id: true, nome: true, etapa: true, ano_letivo: true },
      });
      return new Map(turmas.map((t) => [t.id, rotuloTurma(t)]));
    });
  } else {
    resultado = await contarPorGrupo(db, where, 'categoria_id', async (ids) => {
      const categorias = await db.categoria.findMany({
        where: { id: { in: ids } },
        select: { id: true, nome: true },
      });
      return new Map(categorias.map((c) => [c.id, c.nome]));
    });
  }

  return { tipo, dataInicio, dataFim, total: resultado.total, linhas: resultado.linhas };
}
