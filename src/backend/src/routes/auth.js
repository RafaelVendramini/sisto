import { Router } from 'express';
import { login } from '../controllers/auth.js';

// Rotas públicas de autenticação (/auth/*, Seção 12 do SSD) — sem JWT.
const rotasAuth = Router();

rotasAuth.post('/login', login);

export default rotasAuth;
