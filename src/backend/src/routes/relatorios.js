import { Router } from 'express';
import { permitirPerfis } from '../middlewares/autenticacao.js';
import { gerar } from '../controllers/relatorios.js';
import { PERFIS_RELATORIOS } from '../services/relatorios.js';

// Rotas de relatórios (Seção 12 do SSD). Montadas em `protegidas`, depois do
// bloqueio de troca de senha pendente (JWT de usuário ativo já exigido).
// Issue #88: GET /relatorios só para GESTAO e PEDAGOGICO (matriz da Seção 4,
// UC05); os demais perfis recebem 403.
const rotasRelatorios = Router();

rotasRelatorios.get('/', permitirPerfis(PERFIS_RELATORIOS), gerar);

export default rotasRelatorios;
