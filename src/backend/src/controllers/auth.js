// Controller de autenticação — somente entrada/saída HTTP (regras em services/auth.js).
import { autenticar } from '../services/auth.js';

/** POST /auth/login */
export async function login(req, res) {
  const resultado = await autenticar(req.body);
  res.status(200).json(resultado);
}
