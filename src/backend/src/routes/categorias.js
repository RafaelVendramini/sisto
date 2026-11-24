import { Router } from 'express';
import { permitirPerfis } from '../middlewares/autenticacao.js';
import { criar, editar, listar } from '../controllers/categorias.js';

// Rotas de categorias de ocorrência (Seção 12 do SSD, Issue #38). Montadas em
// `protegidas`, depois do bloqueio de troca de senha pendente (JWT de usuário
// ativo já exigido). GET para os 6 perfis (RN20); criar e editar só GESTAO e
// PEDAGOGICO (matriz da Seção 4, "Gerenciar categorias"). Não há DELETE:
// categorias não são excluídas nem inativadas (RN21). O 6º perfil, PSICOLOGO,
// entrou na v1.18 (Issue #153).
const rotasCategorias = Router();

rotasCategorias.get(
  '/',
  permitirPerfis('PROFESSOR', 'TUTOR', 'GESTAO', 'PEDAGOGICO', 'TECNICO_ADMINISTRATIVO', 'PSICOLOGO'),
  listar,
);
rotasCategorias.post('/', permitirPerfis('GESTAO', 'PEDAGOGICO'), criar);
rotasCategorias.put('/:id', permitirPerfis('GESTAO', 'PEDAGOGICO'), editar);

export default rotasCategorias;
