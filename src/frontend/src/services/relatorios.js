// Chamadas à API de relatórios (UC05, RF13, RF14 — SSD, Seção 12; Issue #88).
// Só Gestão e Pedagógico (403 para os demais). A resposta traz apenas
// contagens, sem dados pessoais. Exportação de arquivo e gráficos estão fora
// do escopo (Seção 5). A chamada é autenticada: um 401 cai no tratamento
// central de sessão.
import { requisicaoAutenticada } from './auth.js';

// Tipos aceitos pelo back-end (`tipo` na query) e o rótulo mostrado na tela.
export const TIPOS_RELATORIO = Object.freeze([
  Object.freeze({ valor: 'periodo', rotulo: 'Total do período' }),
  Object.freeze({ valor: 'turma', rotulo: 'Por turma' }),
  Object.freeze({ valor: 'categoria', rotulo: 'Por categoria' }),
]);

/**
 * Converte o valor técnico do tipo no rótulo exibido na tela.
 * @param {string} tipo - ex.: 'turma'
 * @returns {string} ex.: 'Por turma' (ou string vazia se desconhecido)
 */
export function rotuloTipoRelatorio(tipo) {
  return TIPOS_RELATORIO.find((item) => item.valor === tipo)?.rotulo ?? '';
}

/**
 * Gera o relatório de quantidade de ocorrências (GET /relatorios).
 * @param {{ tipo: 'periodo' | 'turma' | 'categoria', dataInicio: string,
 *   dataFim: string }} filtro - datas no formato AAAA-MM-DD
 * @returns {Promise<{ tipo: string, dataInicio: string, dataFim: string, total: number,
 *   linhas: Array<{ id: number, rotulo: string, quantidade: number }> }>}
 *   no tipo 'periodo', `linhas` vem vazio
 */
export async function gerarRelatorio({ tipo, dataInicio, dataFim }) {
  const parametros = new URLSearchParams({ tipo, dataInicio, dataFim });
  const dados = await requisicaoAutenticada(`/relatorios?${parametros.toString()}`);
  return {
    tipo: dados?.tipo ?? tipo,
    dataInicio: dados?.dataInicio ?? dataInicio,
    dataFim: dados?.dataFim ?? dataFim,
    total: Number(dados?.total) || 0,
    linhas: Array.isArray(dados?.linhas) ? dados.linhas : [],
  };
}
