// Chamadas à API de categorias de ocorrência (RF07 — SSD, Seção 12).
// GET para todos os perfis (RN20); criar e editar só Gestão e Pedagógico.
// A proteção real é do back-end (403). Não há exclusão de categoria (RN21).
// As chamadas são autenticadas: um 401 cai no tratamento central de sessão.
import { requisicaoAutenticada } from './auth.js';

/**
 * Lista as categorias cadastradas (GET /categorias), já ordenadas por nome.
 * @returns {Promise<Array<{ id: number, nome: string, descricao: string | null }>>}
 */
export async function listarCategorias() {
  const dados = await requisicaoAutenticada('/categorias');
  return Array.isArray(dados) ? dados : [];
}

/**
 * Cria uma categoria (POST /categorias — RF07, RN18).
 * @param {{ nome: string, descricao?: string }} dados
 * @returns {Promise<{ id: number, nome: string, descricao: string | null }>}
 */
export function criarCategoria({ nome, descricao }) {
  return requisicaoAutenticada('/categorias', {
    metodo: 'POST',
    corpo: { nome, descricao },
  });
}

/**
 * Edita uma categoria (PUT /categorias/{id} — RF07, RN18).
 * Descrição vazia apaga a descrição atual (o back-end grava null).
 * @param {number} id
 * @param {{ nome: string, descricao?: string }} dados
 * @returns {Promise<{ id: number, nome: string, descricao: string | null }>}
 */
export function atualizarCategoria(id, { nome, descricao }) {
  return requisicaoAutenticada(`/categorias/${encodeURIComponent(id)}`, {
    metodo: 'PUT',
    corpo: { nome, descricao },
  });
}
