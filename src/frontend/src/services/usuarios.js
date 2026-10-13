// Chamadas à API de usuários (RF01 — SSD, Seção 12). Somente o perfil Gestão
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
