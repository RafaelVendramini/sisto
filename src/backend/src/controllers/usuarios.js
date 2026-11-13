// Controller de usuários — somente entrada/saída HTTP (regras em services/usuarios.js).
import { atualizarUsuario, cadastrarUsuario, listarUsuarios } from '../services/usuarios.js';
import { redefinirSenhaUsuario } from '../services/troca-senha.js';

/** POST /usuarios */
export async function cadastrar(req, res) {
  const usuario = await cadastrarUsuario(req.body, req.usuario);
  res.status(201).json(usuario);
}

/** GET /usuarios[?perfil=] — completa para a Gestão, reduzida para os demais (RN20). */
export async function listar(req, res) {
  const usuarios = await listarUsuarios(req.usuario, req.query);
  res.status(200).json(usuarios);
}

/** PUT /usuarios/:id — edição, bloqueio, desativação e reativação (#13). */
export async function editar(req, res) {
  const usuario = await atualizarUsuario(req.params.id, req.body, req.usuario);
  res.status(200).json(usuario);
}

/** PUT /usuarios/:id/senha — redefinição da senha pela Gestão (#18); 204 sem corpo. */
export async function redefinirSenha(req, res) {
  await redefinirSenhaUsuario(req.params.id, req.body, req.usuario);
  res.status(204).end();
}
