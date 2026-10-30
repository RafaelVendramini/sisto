import { Router } from 'express';
import { permitirPerfis } from '../middlewares/autenticacao.js';
import { registrar } from '../controllers/ocorrencias.js';

// Rotas de ocorrências (Seção 12 do SSD). Montadas em `protegidas`, depois do
// bloqueio de troca de senha pendente (JWT de usuário ativo já exigido).
// Issue #45: POST /ocorrencias para os 5 perfis (matriz da Seção 4, RN03).
// GET, PUT, status, encaminhamentos, providências e comunicações ficam para
// as próximas Issues.
const rotasOcorrencias = Router();

rotasOcorrencias.post(
  '/',
  permitirPerfis('PROFESSOR', 'TUTOR', 'GESTAO', 'PEDAGOGICO', 'TECNICO_ADMINISTRATIVO'),
  registrar,
);

export default rotasOcorrencias;
