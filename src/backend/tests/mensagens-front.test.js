// Contrato de texto entre back-end e front-end (Issue #18, RN10): o 403 da
// troca de senha pendente não tem código próprio, e o front-end o reconhece
// pela mensagem (src/frontend/src/services/mensagens.js). Se o texto mudar só
// de um lado, este teste quebra. Lê o arquivo do front-end como TEXTO (não o
// importa), sem dependência do front-end.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const { MENSAGEM_TROCA_SENHA_OBRIGATORIA } = await import('../src/middlewares/autenticacao.js');

const arquivoMensagensFront = fileURLToPath(
  new URL('../../frontend/src/services/mensagens.js', import.meta.url),
);

describe('Mensagens compartilhadas com o front-end', () => {
  it('mensagens.js do front-end contém exatamente o texto de MENSAGEM_TROCA_SENHA_OBRIGATORIA', () => {
    const texto = readFileSync(arquivoMensagensFront, 'utf8');

    expect(MENSAGEM_TROCA_SENHA_OBRIGATORIA).toBe(
      'Sua senha foi redefinida pela Gestão. Troque a senha para continuar usando o sistema.',
    );
    // Literal completo entre aspas simples: não basta um trecho parecido.
    expect(texto).toContain(`'${MENSAGEM_TROCA_SENHA_OBRIGATORIA}'`);
    expect(texto).toMatch(/export const MENSAGEM_TROCA_SENHA_PENDENTE\s*=/);
  });
});
