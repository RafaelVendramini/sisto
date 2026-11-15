// Controller de relatórios — somente entrada/saída HTTP (regras em services/relatorios.js).
import { gerarRelatorio } from '../services/relatorios.js';

/** GET /relatorios */
export async function gerar(req, res) {
  const relatorio = await gerarRelatorio(req.query, req.usuario);
  res.status(200).json(relatorio);
}
