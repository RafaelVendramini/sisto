import { Router } from 'express';
import { trocarSenha } from '../controllers/conta.js';
import { limitarTentativasTrocaSenha } from '../middlewares/limite-tentativas.js';

// Rotas da conta do próprio usuário (Seção 12 do SSD). Montadas em
// `protegidas` ANTES do bloqueio de troca de senha pendente (RN10): por isso
// PUT /conta/senha é a única rota liberada enquanto a troca é obrigatória.
// Todos os perfis podem trocar a própria senha (matriz da Seção 4).
const rotasConta = Router();

// Limite de tentativas com falha por IP + usuário logado (Issue #90).
rotasConta.put('/senha', limitarTentativasTrocaSenha, trocarSenha);

export default rotasConta;
