import { Router } from 'express';
import { verificarSaude } from '../controllers/saude.js';

// Rota pública de saúde (Issue #138) — sem JWT, sem banco e fora do limite de
// tentativas. Só GET (e HEAD, que o Express atende pelo handler do GET); os
// demais métodos seguem adiante e recebem a resposta padrão do app para
// rota/método inexistente (401 sem token, 404 com token).
const rotasSaude = Router();

rotasSaude.get('/', verificarSaude);

export default rotasSaude;
