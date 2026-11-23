import { ErroHttp } from '../lib/erros.js';

/** Cabeçalhos (em minúsculas) que um ErroHttp pode definir na resposta. */
const CABECALHOS_PERMITIDOS = new Set(['www-authenticate']);

/**
 * Mensagens em português para os erros do leitor de JSON (body-parser, usado
 * pelo express.json()), identificados por `err.type` (Issue #128). O status
 * é o que o body-parser definiu (400, 413 ou 415).
 */
export const MENSAGENS_ERRO_CORPO = Object.freeze({
  'entity.parse.failed': 'JSON inválido no corpo da requisição',
  'entity.too.large': 'O corpo da requisição passa do tamanho máximo permitido.',
  'charset.unsupported':
    'Codificação de caracteres não suportada no corpo da requisição. Use UTF-8.',
  'encoding.unsupported': 'Compressão (Content-Encoding) não suportada no corpo da requisição.',
});

/** Demais erros do leitor de JSON (ex.: requisição interrompida, tamanho inconsistente). */
export const MENSAGEM_ERRO_CORPO_GENERICA = 'Não foi possível ler o corpo da requisição.';

/**
 * Mensagem de um erro 4xx: a do ErroHttp, a traduzida do body-parser ou, para
 * outros erros, a original só quando `expose` permite.
 */
function mensagemErroCliente(err) {
  if (err instanceof ErroHttp) return err.message || 'Requisição inválida';
  // Os erros do body-parser trazem `type` (texto) e mensagem em inglês.
  if (typeof err.type === 'string') {
    return Object.hasOwn(MENSAGENS_ERRO_CORPO, err.type)
      ? MENSAGENS_ERRO_CORPO[err.type]
      : MENSAGEM_ERRO_CORPO_GENERICA;
  }
  return err.expose && err.message ? err.message : 'Requisição inválida';
}

/**
 * Responde 404 em JSON para qualquer rota não registrada.
 */
export function rotaNaoEncontrada(req, res) {
  res.status(404).json({ erro: 'Rota não encontrada' });
}

/**
 * Middleware central de erros. Sempre responde em JSON no formato
 * { "erro": "mensagem" } — acrescido de "codigo" quando o ErroHttp tiver um
 * código estável (todo 409 e o 403 da RN10 — Issue #72, D1) — e nunca expõe
 * a stack trace ao cliente.
 */
// eslint-disable-next-line no-unused-vars
export function tratarErros(err, req, res, next) {
  const status = Number(err?.status ?? err?.statusCode);

  if (status >= 400 && status < 500) {
    const mensagem = mensagemErroCliente(err);
    // Só ErroHttp (src/lib/erros.js) pode definir cabeçalhos, e apenas os da
    // lista permitida (ex.: WWW-Authenticate no 401); os demais são ignorados.
    if (err instanceof ErroHttp && err.cabecalhos) {
      for (const [nome, valor] of Object.entries(err.cabecalhos)) {
        if (CABECALHOS_PERMITIDOS.has(nome.toLowerCase()) && typeof valor === 'string') {
          res.set(nome, valor);
        }
      }
    }
    // Só ErroHttp define o código estável; sem código, o corpo segue { erro }.
    if (err instanceof ErroHttp && typeof err.codigo === 'string' && err.codigo) {
      return res.status(status).json({ erro: mensagem, codigo: err.codigo });
    }
    return res.status(status).json({ erro: mensagem });
  }

  // Registra só nome e stack: o objeto completo (ex.: erros do Prisma) pode
  // carregar dados pessoais de estudantes (LGPD).
  if (process.env.NODE_ENV !== 'test') {
    console.error(err?.name, err?.stack);
  }

  return res.status(500).json({ erro: 'Erro interno do servidor' });
}
