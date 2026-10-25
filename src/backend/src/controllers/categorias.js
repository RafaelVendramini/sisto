// Controller de categorias — somente entrada/saída HTTP (regras em services/categorias.js).
import { atualizarCategoria, criarCategoria, listarCategorias } from '../services/categorias.js';

/** GET /categorias */
export async function listar(req, res) {
  const categorias = await listarCategorias();
  res.status(200).json(categorias);
}

/** POST /categorias */
export async function criar(req, res) {
  const categoria = await criarCategoria(req.body, req.usuario);
  res.status(201).json(categoria);
}

/** PUT /categorias/:id */
export async function editar(req, res) {
  const categoria = await atualizarCategoria(req.params.id, req.body, req.usuario);
  res.status(200).json(categoria);
}
