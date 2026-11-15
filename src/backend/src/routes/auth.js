import { Router } from 'express';
import { login } from '../controllers/auth.js';
import { limitarTentativasLogin } from '../middlewares/limite-tentativas.js';

// Rotas públicas de autenticação (/auth/*, Seção 12 do SSD) — sem JWT.
const rotasAuth = Router();

// Limite de tentativas com falha por IP + e-mail (Issue #90).
rotasAuth.post('/login', limitarTentativasLogin, login);

export default rotasAuth;
