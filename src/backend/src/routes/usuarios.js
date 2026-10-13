import { Router } from 'express';
import { permitirPerfis } from '../middlewares/autenticacao.js';
import { cadastrar, editar, listar } from '../controllers/usuarios.js';

// Rotas de usuários (Seção 12 do SSD). Montadas em `protegidas` (JWT de
// usuário ativo já exigido). Apenas GESTAO cadastra e lista (RN01, Seção 4);
// a restrição do GET será revista na Sprint 2. Apenas GESTAO edita, bloqueia,
// desativa e reativa (RF04, #13). Não há DELETE: usuários nunca são
// excluídos (RN07).
const rotasUsuarios = Router();

rotasUsuarios.get('/', permitirPerfis('GESTAO'), listar);
rotasUsuarios.post('/', permitirPerfis('GESTAO'), cadastrar);
rotasUsuarios.put('/:id', permitirPerfis('GESTAO'), editar);

export default rotasUsuarios;
