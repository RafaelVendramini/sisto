// Controller da conta do usuário logado — somente entrada/saída HTTP
// (regras em services/troca-senha.js).
import { trocarPropriaSenha } from '../services/troca-senha.js';

/** PUT /conta/senha — 204 sem corpo e sem token novo (RN12: é preciso entrar de novo). */
export async function trocarSenha(req, res) {
  await trocarPropriaSenha(req.body, req.usuario);
  res.status(204).end();
}
