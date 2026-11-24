// Erros de aplicação compartilhados entre services e middlewares — Sisto.

/**
 * Códigos estáveis do corpo de erro (SSD v1.8, Seção 12 — Issue #72, D1).
 * Todo 409 da API traz um destes códigos em `codigo`, e o 403 da troca de
 * senha obrigatória pendente (RN10) traz TROCA_SENHA_OBRIGATORIA. O front-end
 * identifica o caso pelo código, não pelo texto da mensagem. Cada situação
 * distinta tem um código próprio; a mesma situação em recursos diferentes
 * compartilha o código (ex.: CONFLITO_CONCORRENTE). Os valores não mudam:
 * renomear um código quebra o contrato da API.
 */
export const CODIGOS_ERRO = Object.freeze({
  /** Transação serializável abortada (P2034 ou conflito no COMMIT) até esgotar as tentativas, ou com o tempo esgotado (P2028), em qualquer recurso (lib/transacao.js). */
  CONFLITO_CONCORRENTE: 'CONFLITO_CONCORRENTE',
  /** E-mail já usado por outro usuário. */
  EMAIL_DUPLICADO: 'EMAIL_DUPLICADO',
  /** RN18: nome de categoria já usado. */
  CATEGORIA_DUPLICADA: 'CATEGORIA_DUPLICADA',
  /** RN18: trio (nome, etapa, ano letivo) de turma já usado. */
  TURMA_DUPLICADA: 'TURMA_DUPLICADA',
  /** RN18: código escolar já usado por outro estudante. */
  CODIGO_ESCOLAR_DUPLICADO: 'CODIGO_ESCOLAR_DUPLICADO',
  /** RN11: a edição reduziria a menos de dois os usuários Gestão ativos. */
  GESTAO_ATIVA_MINIMA: 'GESTAO_ATIVA_MINIMA',
  /** RN11: bloquear, desativar ou alterar o perfil do próprio usuário. */
  ALTERAR_PROPRIO_ACESSO: 'ALTERAR_PROPRIO_ACESSO',
  /** RF03: PUT /usuarios/{id}/senha na própria conta. */
  REDEFINIR_PROPRIA_SENHA: 'REDEFINIR_PROPRIA_SENHA',
  /** RN13: troca de perfil de um Tutor com estudantes vinculados. */
  TUTOR_COM_TUTORADOS: 'TUTOR_COM_TUTORADOS',
  /** RN23 (SSD 1.13, 1.18): mudar para Professor/Técnico-administrativo/Psicólogo escolar o perfil do responsável pelo acompanhamento de ocorrências não encerradas. */
  RESPONSAVEL_COM_OCORRENCIAS: 'RESPONSAVEL_COM_OCORRENCIAS',
  /** RN04/RN15/RN16: operação recusada porque a ocorrência está encerrada. */
  OCORRENCIA_ENCERRADA: 'OCORRENCIA_ENCERRADA',
  /** RN04: providência ou encerramento com a ocorrência ainda aberta. */
  OCORRENCIA_ABERTA: 'OCORRENCIA_ABERTA',
  /** RN04: encerramento sem nenhuma providência registrada. */
  ENCERRAMENTO_SEM_PROVIDENCIA: 'ENCERRAMENTO_SEM_PROVIDENCIA',
  /** RN10 (403): troca de senha obrigatória pendente. */
  TROCA_SENHA_OBRIGATORIA: 'TROCA_SENHA_OBRIGATORIA',
});

/**
 * Erro de negócio com status HTTP; a mensagem é segura para o cliente
 * (o middleware central de erros a devolve como { "erro": mensagem } ou,
 * com código, { "erro": mensagem, "codigo": codigo }).
 */
export class ErroHttp extends Error {
  /**
   * @param {number} status código HTTP (4xx)
   * @param {string} mensagem mensagem exibida ao cliente
   * @param {object} [opcoes]
   * @param {Record<string, string>} [opcoes.cabecalhos] cabeçalhos HTTP extras da resposta
   * @param {string} [opcoes.codigo] código estável do erro (um valor de CODIGOS_ERRO)
   */
  constructor(status, mensagem, { cabecalhos, codigo } = {}) {
    super(mensagem);
    this.name = 'ErroHttp';
    this.status = status;
    this.expose = true;
    if (cabecalhos) this.cabecalhos = cabecalhos;
    if (codigo) this.codigo = codigo;
  }
}
