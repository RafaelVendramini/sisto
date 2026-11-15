import { Router } from 'express';
import rotasAuth from './auth.js';
import rotasUsuarios from './usuarios.js';
import rotasConta from './conta.js';
import rotasCategorias from './categorias.js';
import rotasTurmas from './turmas.js';
import rotasEstudantes from './estudantes.js';
import rotasOcorrencias from './ocorrencias.js';
import rotasRelatorios from './relatorios.js';
import {
  bloquearComTrocaDeSenhaPendente,
  exigirAutenticacao,
} from '../middlewares/autenticacao.js';
import { rotaNaoEncontrada } from '../middlewares/erros.js';

// Roteador principal (Seção 12 do SSD).
const rotas = Router();

// Rotas públicas: /auth/* não exige JWT (Seção 12). Um caminho inexistente
// sob /auth responde 404 aqui mesmo, sem passar pela autenticação.
rotas.use('/auth', rotasAuth, rotaNaoEncontrada);

/**
 * Sub-roteador das rotas de negócio: TODA rota registrada aqui exige JWT de
 * usuário ativo, emitido depois da última troca de senha (RN09, RN12,
 * Seção 12) — a proteção é estrutural, não depende de lembrar do middleware
 * em cada rota. A ordem das camadas é fixa:
 *
 *   1. exigirAutenticacao              (JWT, status ATIVO, RN12)
 *   2. /conta                          (PUT /conta/senha — ÚNICA exceção do RN10)
 *   3. bloquearComTrocaDeSenhaPendente (403 enquanto a troca obrigatória estiver pendente)
 *   4. demais rotas de negócio
 *
 * IMPORTANTE: as próximas Issues devem registrar os endpoints de negócio no
 * FIM deste arquivo, DEPOIS de bloquearComTrocaDeSenhaPendente, e restringir
 * por perfil com permitirPerfis(...) (RN01 / RF14), por exemplo:
 *
 *   protegidas.use('/turmas', rotasTurmas);
 *
 * Nada além de /conta pode ficar antes do bloqueio: uma rota montada antes
 * dele ficaria acessível com a troca de senha pendente, violando a RN10. O
 * teste tests/rotas-ordem.test.js falha se isso acontecer.
 *
 * Como é montado sem prefixo, qualquer caminho fora de /auth passa pela
 * autenticação: rota inexistente responde 401 sem token, 403 com a troca de
 * senha pendente e 404 com token válido.
 */
export const protegidas = Router();
protegidas.use(exigirAutenticacao);

// Troca da própria senha: única rota liberada com troca obrigatória pendente
// (RN10), por isso vem ANTES do bloqueio abaixo. Não adicione outras rotas aqui.
protegidas.use('/conta', rotasConta);

// RN10: com a troca de senha pendente, tudo o que vem depois responde 403 —
// inclusive rotas registradas por Issues futuras e caminhos inexistentes.
protegidas.use(bloquearComTrocaDeSenhaPendente);

// Rotas de negócio (Seção 12) — registre as novas rotas a partir daqui.
protegidas.use('/usuarios', rotasUsuarios);
protegidas.use('/categorias', rotasCategorias);
protegidas.use('/turmas', rotasTurmas);
protegidas.use('/estudantes', rotasEstudantes);
protegidas.use('/ocorrencias', rotasOcorrencias);
protegidas.use('/relatorios', rotasRelatorios);

rotas.use(protegidas);

export default rotas;
