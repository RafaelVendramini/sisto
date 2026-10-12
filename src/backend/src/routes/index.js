import { Router } from 'express';
import rotasAuth from './auth.js';

// Roteador principal. Os endpoints de negócio (Seção 12 do SSD) são
// registrados aqui pelas Issues correspondentes.
const rotas = Router();

rotas.use('/auth', rotasAuth);

export default rotas;
