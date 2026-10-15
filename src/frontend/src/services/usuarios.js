// Chamadas à API de usuários (RF01, RF04 — SSD, Seção 12). Somente o perfil Gestão
// tem acesso; a proteção real é do back-end (403 para os demais perfis).
// As chamadas são autenticadas: um 401 cai no tratamento central de sessão.
import { requisicaoAutenticada } from './auth.js';

/**
 * Lista os usuários cadastrados (GET /usuarios), já ordenados por nome.
 * @returns {Promise<Array<{ id: number, nome: string, email: string, perfil: string, status: string }>>}
 */
export async function listarUsuarios() {
  const dados = await requisicaoAutenticada('/usuarios');
  return Array.isArray(dados) ? dados : [];
}

/**
 * Cadastra um usuário com senha temporária (POST /usuarios — RF01, RN10).
 * Envia somente os campos do contrato; a senha não é guardada em lugar nenhum.
 * @param {{ nome: string, email: string, perfil: string, senha: string }} dados
 * @returns {Promise<{ id: number, nome: string, email: string, perfil: string, status: string }>}
 */
export function cadastrarUsuario({ nome, email, perfil, senha }) {
  return requisicaoAutenticada('/usuarios', {
    metodo: 'POST',
    corpo: { nome, email, perfil, senha },
  });
}

// Campos aceitos pelo PUT /usuarios/{id} (SSD, Seção 12). Senha fica de fora.
const CAMPOS_EDITAVEIS = ['nome', 'email', 'perfil', 'status'];

/**
 * Altera dados e/ou status de um usuário (PUT /usuarios/{id} — RF04, RN07, RN09, RN11).
 * Envia somente os campos informados entre nome, email, perfil e status.
 * Não existe exclusão de usuário (RN07): para retirar o acesso, use o status.
 * @param {number} id
 * @param {{ nome?: string, email?: string, perfil?: string, status?: string }} alteracoes
 * @returns {Promise<{ id: number, nome: string, email: string, perfil: string, status: string }>}
 */
export function atualizarUsuario(id, alteracoes) {
  const corpo = {};
  for (const campo of CAMPOS_EDITAVEIS) {
    if (alteracoes?.[campo] !== undefined) corpo[campo] = alteracoes[campo];
  }
  return requisicaoAutenticada(`/usuarios/${encodeURIComponent(id)}`, {
    metodo: 'PUT',
    corpo,
  });
}
