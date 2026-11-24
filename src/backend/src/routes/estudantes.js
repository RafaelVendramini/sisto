import { Router } from 'express';
import { permitirPerfis } from '../middlewares/autenticacao.js';
import { criar, editar, listar } from '../controllers/estudantes.js';

// Rotas de estudantes (Seção 12 do SSD, Issue #42). Montadas em `protegidas`,
// depois do bloqueio de troca de senha pendente (JWT de usuário ativo já
// exigido). GET para os 6 perfis, com dados reduzidos para quem não é Gestão
// (RN20 — o recorte fica no service); cadastrar e editar (inclusive o vínculo
// com o tutor) só GESTAO (matriz da Seção 4, RN13). Não há DELETE: estudantes
// não são excluídos nem inativados (RN21). O 6º perfil, PSICOLOGO, entrou na
// v1.18 (Issue #153).
const rotasEstudantes = Router();

rotasEstudantes.get(
  '/',
  permitirPerfis('PROFESSOR', 'TUTOR', 'GESTAO', 'PEDAGOGICO', 'TECNICO_ADMINISTRATIVO', 'PSICOLOGO'),
  listar,
);
rotasEstudantes.post('/', permitirPerfis('GESTAO'), criar);
rotasEstudantes.put('/:id', permitirPerfis('GESTAO'), editar);

export default rotasEstudantes;
