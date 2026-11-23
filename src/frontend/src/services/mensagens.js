// Mensagens de erro comuns às telas (RNF02), definidas num só lugar.
export const MENSAGEM_SEM_PERMISSAO = 'Acesso não permitido para o seu perfil.';
export const MENSAGEM_SEM_CONEXAO =
  'Não foi possível conectar ao servidor. Verifique sua internet e tente novamente.';

// Texto do 403 do back-end enquanto a troca de senha obrigatória está pendente
// (RN10, Issue #18). Desde a #72 (D1), o 403 é reconhecido pelo código
// TROCA_SENHA_OBRIGATORIA (codigosErro.js); este texto é exibido na tela de
// troca e serve de reserva quando a resposta vem sem código.
export const MENSAGEM_TROCA_SENHA_PENDENTE =
  'Você precisa trocar a sua senha temporária para continuar usando o sistema.';

// 429 do limite de tentativas com falha no login e na troca de senha (Issue #90,
// SSD 1.8). As telas mostram o texto `erro` da API; este é o reserva, se a
// resposta vier sem ele. O 429 nunca é tratado como sessão expirada.
export const MENSAGEM_MUITAS_TENTATIVAS =
  'Muitas tentativas. Tente novamente em alguns minutos.';

/**
 * Mensagem de erro ao carregar dados de apoio de uma tela (listas, opções):
 * 403 -> sem permissão; status 0 -> sem conexão; demais -> `generica`, o
 * texto próprio de cada tela. O 401 é tratado antes, pelo fluxo central.
 */
export function mensagemErroCarga(falha, generica) {
  if (falha?.status === 403) return MENSAGEM_SEM_PERMISSAO;
  if (falha?.status === 0) return MENSAGEM_SEM_CONEXAO;
  return generica;
}
