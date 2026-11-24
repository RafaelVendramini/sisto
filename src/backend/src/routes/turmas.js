import { Router } from 'express';
import { permitirPerfis } from '../middlewares/autenticacao.js';
import { criar, editar, listar } from '../controllers/turmas.js';

// Rotas de turmas (Seção 12 do SSD, Issue #40). Montadas em `protegidas`,
// depois do bloqueio de troca de senha pendente (JWT de usuário ativo já
// exigido). GET para os 6 perfis (RN20); cadastrar e editar só GESTAO (matriz
// da Seção 4, "Gerenciar usuários, turmas e estudantes"). Não há DELETE:
// turmas não são excluídas nem inativadas (RN21). O 6º perfil, PSICOLOGO,
// entrou na v1.18 (Issue #153).
const rotasTurmas = Router();

rotasTurmas.get(
  '/',
  permitirPerfis('PROFESSOR', 'TUTOR', 'GESTAO', 'PEDAGOGICO', 'TECNICO_ADMINISTRATIVO', 'PSICOLOGO'),
  listar,
);
rotasTurmas.post('/', permitirPerfis('GESTAO'), criar);
rotasTurmas.put('/:id', permitirPerfis('GESTAO'), editar);

export default rotasTurmas;
