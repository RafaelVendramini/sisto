/**
 * Responde 404 em JSON para qualquer rota não registrada.
 */
export function rotaNaoEncontrada(req, res) {
  res.status(404).json({ erro: 'Rota não encontrada' });
}

/**
 * Middleware central de erros. Sempre responde em JSON no formato
 * { "erro": "mensagem" } e nunca expõe a stack trace ao cliente.
 */
// eslint-disable-next-line no-unused-vars
export function tratarErros(err, req, res, next) {
  const status = Number(err?.status ?? err?.statusCode);

  if (status >= 400 && status < 500) {
    const mensagem =
      err.type === 'entity.parse.failed'
        ? 'JSON inválido no corpo da requisição'
        : err.expose && err.message
          ? err.message
          : 'Requisição inválida';
    return res.status(status).json({ erro: mensagem });
  }

  // Registra só nome e stack: o objeto completo (ex.: erros do Prisma) pode
  // carregar dados pessoais de estudantes (LGPD).
  if (process.env.NODE_ENV !== 'test') {
    console.error(err?.name, err?.stack);
  }

  return res.status(500).json({ erro: 'Erro interno do servidor' });
}
