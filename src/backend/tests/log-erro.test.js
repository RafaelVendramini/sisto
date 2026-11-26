// Log do erro 500 sem dados pessoais (Issue #42, LGPD): o texto registrado
// traz o nome, o código e as linhas "at ..." da stack, mas nunca a mensagem
// do erro, que no Prisma pode repetir os valores enviados. Somente dados
// fictícios (RN05); sem banco.
import { describe, it, expect } from 'vitest';
import { resumoErroParaLog } from '../src/middlewares/erros.js';

const NOME_FICTICIO = 'Estudante Fictício da Silva';

describe('resumoErroParaLog (Issue #42)', () => {
  it('não inclui a mensagem do erro, mesmo com várias linhas', () => {
    const erro = new Error(`Valor inválido:\n  nomeCompleto: "${NOME_FICTICIO}"`);
    const texto = resumoErroParaLog(erro);

    expect(texto).not.toContain(NOME_FICTICIO);
    expect(texto).not.toContain('Valor inválido');
    expect(texto.split('\n')[0]).toBe('Error');
    expect(texto).toMatch(/^\s+at /m);
  });

  it('inclui o código do erro (ex.: Prisma) quando existe', () => {
    const erro = new Error(`Unique constraint failed: ${NOME_FICTICIO}`);
    erro.name = 'PrismaClientKnownRequestError';
    erro.code = 'P2002';
    const linhas = resumoErroParaLog(erro).split('\n');

    expect(linhas.slice(0, 2)).toEqual(['PrismaClientKnownRequestError', 'P2002']);
    expect(linhas.join('\n')).not.toContain(NOME_FICTICIO);
  });

  it('não quebra com valores que não são Error', () => {
    expect(resumoErroParaLog(undefined)).toBe('');
    expect(resumoErroParaLog(`texto com ${NOME_FICTICIO}`)).toBe('');
    expect(resumoErroParaLog({ name: 'Falha', stack: 42 })).toBe('Falha');
  });
});
