import { describe, it, expect } from 'vitest';
import bcrypt from 'bcrypt';
import {
  validarPoliticaSenha,
  mensagemPoliticaSenha,
  gerarHashSenha,
  TAMANHO_MINIMO_SENHA,
  TAMANHO_MAXIMO_BYTES_SENHA,
  CUSTO_BCRYPT,
} from '../src/services/senha.js';

// Senhas fictícias, usadas só nos testes.
const SENHA_VALIDA = 'senhaFicticia123';
// Custo baixo do bcrypt nos testes que não verificam o custo em si (mais rápido).
const CUSTO_TESTE = 4;

/** Captura o erro de uma promise que deve rejeitar (falha o teste se resolver). */
async function erroRejeitado(promessa) {
  await expect(promessa).rejects.toBeInstanceOf(Error);
  return promessa.catch((erro) => erro);
}

describe('Política de senha (RN10)', () => {
  it('exige no mínimo 8 caracteres', () => {
    expect(TAMANHO_MINIMO_SENHA).toBe(8);
    expect(validarPoliticaSenha('1234567')).toBe(false);
    expect(validarPoliticaSenha('12345678')).toBe(true);
    expect(validarPoliticaSenha(SENHA_VALIDA)).toBe(true);
  });

  it('rejeita valores ausentes ou que não são texto', () => {
    expect(validarPoliticaSenha(undefined)).toBe(false);
    expect(validarPoliticaSenha(null)).toBe(false);
    expect(validarPoliticaSenha('')).toBe(false);
    expect(validarPoliticaSenha(12345678)).toBe(false);
  });
});

describe('Limite técnico do bcrypt: 72 bytes', () => {
  it('aceita exatamente 72 bytes e recusa 73', () => {
    expect(TAMANHO_MAXIMO_BYTES_SENHA).toBe(72);
    expect(validarPoliticaSenha('a'.repeat(72))).toBe(true);
    expect(validarPoliticaSenha('a'.repeat(73))).toBe(false);
  });

  it('conta bytes UTF-8, não caracteres: acentos podem passar de 72 bytes com menos de 72 caracteres', () => {
    const acentuada = 'é'.repeat(37); // 37 caracteres, 74 bytes
    expect(acentuada.length).toBeLessThan(72);
    expect(Buffer.byteLength(acentuada, 'utf8')).toBe(74);
    expect(validarPoliticaSenha(acentuada)).toBe(false);
    expect(validarPoliticaSenha('é'.repeat(36))).toBe(true); // 72 bytes
  });

  it('mensagem clara, sem o valor da senha', () => {
    const longa = 'ã'.repeat(40);
    const mensagem = mensagemPoliticaSenha(longa);
    expect(mensagem).toMatch(/no máximo 72 bytes/);
    expect(mensagem).not.toContain(longa);
    expect(mensagemPoliticaSenha(SENHA_VALIDA)).toBeNull();
  });
});

describe('Hash de senha com bcrypt (RNF03)', () => {
  it('usa custo padrão 12 (entre 10 e 12)', async () => {
    expect(CUSTO_BCRYPT).toBe(12);
    const hash = await gerarHashSenha(SENHA_VALIDA);
    expect(bcrypt.getRounds(hash)).toBe(12);
  });

  it('gera hash bcrypt válido, diferente da senha, que confere com bcrypt.compare', async () => {
    const hash = await gerarHashSenha(SENHA_VALIDA, CUSTO_TESTE);

    expect(hash).not.toBe(SENHA_VALIDA);
    expect(hash).not.toContain(SENHA_VALIDA);
    expect(hash).toMatch(/^\$2[aby]\$\d{2}\$/);
    expect(bcrypt.getRounds(hash)).toBe(CUSTO_TESTE);
    expect(await bcrypt.compare(SENHA_VALIDA, hash)).toBe(true);
    expect(await bcrypt.compare('outraSenhaFicticia', hash)).toBe(false);
  });

  it('gera hashes diferentes para a mesma senha (salt aleatório)', async () => {
    const [a, b] = await Promise.all([
      gerarHashSenha(SENHA_VALIDA, CUSTO_TESTE),
      gerarHashSenha(SENHA_VALIDA, CUSTO_TESTE),
    ]);
    expect(a).not.toBe(b);
  });

  it('recusa senha curta sem expor a senha na mensagem', async () => {
    const curta = 'abc1234';
    const erro = await erroRejeitado(gerarHashSenha(curta, CUSTO_TESTE));
    expect(erro.message).toMatch(/no mínimo 8 caracteres/);
    expect(erro.message).not.toContain(curta);
  });

  it('recusa senha acima de 72 bytes sem expor a senha na mensagem', async () => {
    const longa = 'é'.repeat(37);
    const erro = await erroRejeitado(gerarHashSenha(longa, CUSTO_TESTE));
    expect(erro.message).toMatch(/no máximo 72 bytes/);
    expect(erro.message).not.toContain(longa);
  });
});
