// Controller de usuários — somente entrada/saída HTTP (regras em services/usuarios.js).
import { atualizarUsuario, cadastrarUsuario, listarUsuarios } from '../services/usuarios.js';

/** POST /usuarios */
export async function cadastrar(req, res) {
  const usuario = await cadastrarUsuario(req.body);
  res.status(201).json(usuario);
}

/** GET /usuarios */
export async function listar(req, res) {
  const usuarios = await listarUsuarios();
  res.status(200).json(usuarios);
}

/** PUT /usuarios/:id — edição, bloqueio, desativação e reativação (#13). */
export async function editar(req, res) {
  const usuario = await atualizarUsuario(req.params.id, req.body, req.usuario);
  res.status(200).json(usuario);
}
