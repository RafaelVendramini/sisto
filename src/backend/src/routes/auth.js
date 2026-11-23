import { Router } from 'express';
import { login } from '../controllers/auth.js';
import { limitarTentativasLogin } from '../middlewares/limite-tentativas.js';
import { registrarDiagnosticoProxy } from '../middlewares/diagnostico-proxy.js';

// Rotas públicas de autenticação (/auth/*, Seção 12 do SSD) — sem JWT.
const rotasAuth = Router();

// Limite de tentativas com falha só por IP (Issue #134) e por IP + e-mail
// (Issue #90), no mesmo middleware. Antes dele, o
// diagnóstico temporário do 'trust proxy' (= 3 em app.js; Issue #127), desligado por padrão
// (DIAGNOSTICO_PROXY=1 liga): registra req.ip e X-Forwarded-For uma vez por
// requisição, inclusive as recusadas com 429.
rotasAuth.post('/login', registrarDiagnosticoProxy, limitarTentativasLogin, login);

export default rotasAuth;
