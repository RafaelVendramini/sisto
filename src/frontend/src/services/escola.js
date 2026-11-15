// Dados de contato da escola exibidos no rodapé e nos textos legais (#92).
// Ponto único de configuração: para corrigir o telefone depois da homologação
// (#95), altere somente este arquivo. Sem endereço e sem e-mail (decisão da #92).

export const NOME_ESCOLA = 'EE José Carlos Nogueira Reverendo – Professor';

// Obtido em cadastros públicos de escolas; a confirmar com a escola na homologação (#95).
export const TELEFONE_ESCOLA = '(19) 3245-1266';

/** Endereço para o link "tel:" (apenas dígitos, com o código do país). */
export function linkTelefone(telefone = TELEFONE_ESCOLA) {
  return `tel:+55${telefone.replace(/\D/g, '')}`;
}
