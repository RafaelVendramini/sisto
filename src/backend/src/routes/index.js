import { Router } from 'express';
import rotasAuth from './auth.js';
import rotasUsuarios from './usuarios.js';
import { exigirAutenticacao } from '../middlewares/autenticacao.js';
import { rotaNaoEncontrada } from '../middlewares/erros.js';

// Roteador principal (Seção 12 do SSD).
const rotas = Router();

// Rotas públicas: /auth/* não exige JWT (Seção 12). Um caminho inexistente
// sob /auth responde 404 aqui mesmo, sem passar pela autenticação.
rotas.use('/auth', rotasAuth, rotaNaoEncontrada);

/**
 * Sub-roteador das rotas de negócio: TODA rota registrada aqui exige JWT de
 * usuário ativo (RN09, Seção 12) — a proteção é estrutural, não depende de
 * lembrar do middleware em cada rota. As próximas Issues devem registrar os
 * endpoints de negócio neste roteador e restringir por perfil com
 * permitirPerfis(...) (RN01 / RF14), por exemplo:
 *
 *   protegidas.use('/usuarios', rotasUsuarios);
 *
 * Como é montado sem prefixo, qualquer caminho fora de /auth passa pela
 * autenticação: rota inexistente responde 401 sem token e 404 com token válido.
 */
export const protegidas = Router();
protegidas.use(exigirAutenticacao);

// Rotas de negócio (Seção 12).
protegidas.use('/usuarios', rotasUsuarios);

rotas.use(protegidas);

export default rotas;
