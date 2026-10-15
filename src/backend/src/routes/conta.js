import { Router } from 'express';
import { trocarSenha } from '../controllers/conta.js';

// Rotas da conta do próprio usuário (Seção 12 do SSD). Montadas em
// `protegidas` ANTES do bloqueio de troca de senha pendente (RN10): por isso
// PUT /conta/senha é a única rota liberada enquanto a troca é obrigatória.
// Todos os perfis podem trocar a própria senha (matriz da Seção 4).
const rotasConta = Router();

rotasConta.put('/senha', trocarSenha);

export default rotasConta;
