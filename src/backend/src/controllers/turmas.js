// Controller de turmas — somente entrada/saída HTTP (regras em services/turmas.js).
import { atualizarTurma, criarTurma, listarTurmas } from '../services/turmas.js';

/** GET /turmas */
export async function listar(req, res) {
  const turmas = await listarTurmas();
  res.status(200).json(turmas);
}

/** POST /turmas */
export async function criar(req, res) {
  const turma = await criarTurma(req.body, req.usuario);
  res.status(201).json(turma);
}

/** PUT /turmas/:id */
export async function editar(req, res) {
  const turma = await atualizarTurma(req.params.id, req.body, req.usuario);
  res.status(200).json(turma);
}
