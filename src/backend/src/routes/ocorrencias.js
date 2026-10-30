import { Router } from 'express';
import { permitirPerfis } from '../middlewares/autenticacao.js';
import { detalhar, encaminhar, listar, registrar } from '../controllers/ocorrencias.js';
import { PERFIS_ENCAMINHAMENTO } from '../services/ocorrencias.js';

// Rotas de ocorrências (Seção 12 do SSD). Montadas em `protegidas`, depois do
// bloqueio de troca de senha pendente (JWT de usuário ativo já exigido).
// Issue #45: POST /ocorrencias para os 5 perfis (matriz da Seção 4, RN03).
// Issue #47: GET /ocorrencias e GET /ocorrencias/{id} para os 5 perfis; o que
// cada um vê (RN19) e o código escolar só para a Gestão (RN20) ficam no
// service.
// Issue #49: POST /ocorrencias/{id}/encaminhamentos só para GESTAO e
// PEDAGOGICO (matriz da Seção 4, RN15); os demais perfis recebem 403.
// PUT, status, providências, comunicações e histórico ficam para as
// próximas Issues.
const rotasOcorrencias = Router();

const TODOS_OS_PERFIS = ['PROFESSOR', 'TUTOR', 'GESTAO', 'PEDAGOGICO', 'TECNICO_ADMINISTRATIVO'];

rotasOcorrencias.post('/', permitirPerfis(TODOS_OS_PERFIS), registrar);
rotasOcorrencias.get('/', permitirPerfis(TODOS_OS_PERFIS), listar);
rotasOcorrencias.get('/:id', permitirPerfis(TODOS_OS_PERFIS), detalhar);
rotasOcorrencias.post('/:id/encaminhamentos', permitirPerfis(PERFIS_ENCAMINHAMENTO), encaminhar);

export default rotasOcorrencias;
