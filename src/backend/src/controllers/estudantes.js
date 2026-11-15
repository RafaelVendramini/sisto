// Controller de estudantes — somente entrada/saída HTTP (regras em services/estudantes.js).
import {
  atualizarEstudante,
  criarEstudante,
  listarEstudantes,
} from '../services/estudantes.js';

/** GET /estudantes[?turmaId=] */
export async function listar(req, res) {
  const estudantes = await listarEstudantes(req.usuario, req.query);
  res.status(200).json(estudantes);
}

/** POST /estudantes */
export async function criar(req, res) {
  const estudante = await criarEstudante(req.body, req.usuario);
  res.status(201).json(estudante);
}

/** PUT /estudantes/:id */
export async function editar(req, res) {
  const estudante = await atualizarEstudante(req.params.id, req.body, req.usuario);
  res.status(200).json(estudante);
}
