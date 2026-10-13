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
