import { useEffect } from 'react';

/**
 * Monta o título da aba do navegador no padrão "<tela> · Sisto".
 * Nunca deve receber dado pessoal (nome de usuário ou de estudante — RNF06).
 * @param {string} titulo - nome da tela (ex.: 'Ocorrências')
 * @returns {string}
 */
export function formatarTituloPagina(titulo) {
  return `${titulo} · Sisto`;
}

/**
 * Define o título da aba do navegador para a tela atual.
 * @param {string} titulo - nome da tela (ex.: 'Ocorrências')
 */
export function useTituloPagina(titulo) {
  useEffect(() => {
    document.title = formatarTituloPagina(titulo);
  }, [titulo]);
}
