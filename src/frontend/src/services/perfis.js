// Rótulos amigáveis dos perfis (SSD, Seção 11). A API trafega os valores
// técnicos; a interface sempre mostra o rótulo correspondente (RNF02).
export const ROTULOS_PERFIL = Object.freeze({
  PROFESSOR: 'Professor',
  TUTOR: 'Tutor',
  GESTAO: 'Gestão',
  PEDAGOGICO: 'Pedagógico',
  TECNICO_ADMINISTRATIVO: 'Técnico-administrativo',
});

/**
 * Converte o valor técnico do perfil no rótulo exibido na tela.
 * @param {string} perfil - ex.: 'GESTAO'
 * @returns {string} ex.: 'Gestão' (ou string vazia se desconhecido)
 */
export function rotuloPerfil(perfil) {
  return ROTULOS_PERFIL[perfil] ?? '';
}

// Rótulos amigáveis do status do usuário (SSD, Seção 11; RN07).
export const ROTULOS_STATUS = Object.freeze({
  ATIVO: 'Ativo',
  BLOQUEADO: 'Bloqueado',
  DESATIVADO: 'Desativado',
});

/**
 * Converte o valor técnico do status no rótulo exibido na tela.
 * @param {string} status - ex.: 'BLOQUEADO'
 * @returns {string} ex.: 'Bloqueado' (ou string vazia se desconhecido)
 */
export function rotuloStatus(status) {
  return ROTULOS_STATUS[status] ?? '';
}

// Perfis que acessam a gestão de usuários (RF01, matriz da Seção 4).
// Usado no menu e na rota; a proteção real é do back-end (403).
export const PERFIS_GESTAO_USUARIOS = Object.freeze(['GESTAO']);

/** Indica se o perfil pode ver a página de usuários. */
export function podeGerenciarUsuarios(perfil) {
  return PERFIS_GESTAO_USUARIOS.includes(perfil);
}
