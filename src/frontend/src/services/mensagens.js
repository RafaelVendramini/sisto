// Mensagens de erro comuns às telas (RNF02), definidas num só lugar.
export const MENSAGEM_SEM_PERMISSAO = 'Acesso não permitido para o seu perfil.';
export const MENSAGEM_SEM_CONEXAO =
  'Não foi possível conectar ao servidor. Verifique sua internet e tente novamente.';

// Texto do 403 do back-end enquanto a troca de senha obrigatória está pendente
// (RN10, Issue #18). O contrato não traz um código próprio para esse caso:
// o front-end reconhece o 403 por esta mensagem e leva o usuário à troca.
export const MENSAGEM_TROCA_SENHA_PENDENTE =
  'Você precisa trocar a sua senha temporária para continuar usando o sistema.';
