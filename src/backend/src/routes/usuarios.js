import { Router } from 'express';
import { permitirPerfis } from '../middlewares/autenticacao.js';
import { cadastrar, editar, listar, redefinirSenha } from '../controllers/usuarios.js';

// Rotas de usuários (Seção 12 do SSD). Montadas em `protegidas` (JWT de
// usuário ativo já exigido). GET para os 6 perfis (RN20, #44; PSICOLOGO desde
// a v1.18, #153): a Gestão recebe a lista completa; os demais, só id, nome e
// perfil dos usuários ativos que podem ser destinatários (Tutor, Psicólogo
// escolar, Pedagógico, Gestão) — o recorte fica no service. Apenas GESTAO cadastra (RN01, Seção 4). Apenas GESTAO edita, bloqueia,
// desativa e reativa (RF04, #13). Apenas GESTAO redefine a senha de outro
// usuário (RF03, #18). Não há DELETE: usuários nunca são
// excluídos (RN07).
const rotasUsuarios = Router();

rotasUsuarios.get(
  '/',
  permitirPerfis('PROFESSOR', 'TUTOR', 'GESTAO', 'PEDAGOGICO', 'TECNICO_ADMINISTRATIVO', 'PSICOLOGO'),
  listar,
);
rotasUsuarios.post('/', permitirPerfis('GESTAO'), cadastrar);
rotasUsuarios.put('/:id', permitirPerfis('GESTAO'), editar);
rotasUsuarios.put('/:id/senha', permitirPerfis('GESTAO'), redefinirSenha);

export default rotasUsuarios;
