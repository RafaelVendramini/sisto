// Chamadas à API da conta do próprio usuário (RF03 — SSD, Seção 12).
// Todos os perfis podem trocar a própria senha (matriz da Seção 4).
import { requisicaoAutenticada } from './auth.js';

/** Rota da tela "Alterar minha senha" (também usada na troca obrigatória — RN10). */
export const ROTA_ALTERAR_SENHA = '/conta/senha';

// Textos do contrato do back-end (PUT /conta/senha — 400).
export const MENSAGEM_SENHA_ATUAL_INCORRETA = 'A senha atual está incorreta.';
export const MENSAGEM_NOVA_SENHA_IGUAL_ATUAL = 'A nova senha deve ser diferente da senha atual.';

/**
 * Troca a senha do usuário logado (PUT /conta/senha — RF03, RN10, RN12).
 * Responde 204 sem corpo e sem token novo: o token atual deixa de valer e é
 * preciso entrar de novo. As senhas não são guardadas em lugar nenhum.
 * @param {{ senhaAtual: string, novaSenha: string }} dados
 * @returns {Promise<void>}
 */
export async function trocarPropriaSenha({ senhaAtual, novaSenha }) {
  await requisicaoAutenticada('/conta/senha', {
    metodo: 'PUT',
    corpo: { senhaAtual, novaSenha },
  });
}
