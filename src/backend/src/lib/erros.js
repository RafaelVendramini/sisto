// Erros de aplicação compartilhados entre services e middlewares — Sisto.

/**
 * Erro de negócio com status HTTP; a mensagem é segura para o cliente
 * (o middleware central de erros a devolve como { "erro": mensagem }).
 */
export class ErroHttp extends Error {
  /**
   * @param {number} status código HTTP (4xx)
   * @param {string} mensagem mensagem exibida ao cliente
   * @param {object} [opcoes]
   * @param {Record<string, string>} [opcoes.cabecalhos] cabeçalhos HTTP extras da resposta
   */
  constructor(status, mensagem, { cabecalhos } = {}) {
    super(mensagem);
    this.name = 'ErroHttp';
    this.status = status;
    this.expose = true;
    if (cabecalhos) this.cabecalhos = cabecalhos;
  }
}
