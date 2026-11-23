// Testes do validador único de ids (lib/ids.js — Issue #129). Sem banco.
import { describe, it, expect } from 'vitest';
import { ErroHttp } from '../src/lib/erros.js';
import { MAIOR_ID, converterIdTexto, ehIdNumerico, ehIdTexto } from '../src/lib/ids.js';
import { validarIdCategoria } from '../src/services/categorias.js';
import { validarIdEstudante } from '../src/services/estudantes.js';
import { validarIdOcorrencia } from '../src/services/ocorrencias.js';
import { validarIdTurma } from '../src/services/turmas.js';
import { validarIdUsuario } from '../src/services/usuarios.js';

const MENSAGEM = 'Identificador fictício inválido.';

describe('MAIOR_ID', () => {
  it('é o maior Int do PostgreSQL (tipo dos ids — Seção 11)', () => {
    expect(MAIOR_ID).toBe(2 ** 31 - 1);
  });
});

describe('converterIdTexto / ehIdTexto (id da URL e da query)', () => {
  it.each([
    ['1', 1],
    ['42', 42],
    [String(MAIOR_ID), MAIOR_ID],
  ])('aceita %s', (texto, numero) => {
    expect(ehIdTexto(texto)).toBe(true);
    expect(converterIdTexto(texto, MENSAGEM)).toBe(numero);
  });

  it.each([
    ['zero', '0'],
    ['negativo', '-1'],
    ['zero à esquerda', '01'],
    ['sinal de mais', '+1'],
    ['decimal', '1.5'],
    ['expoente', '1e3'],
    ['espaço', ' 1'],
    ['hexadecimal', '0x1'],
    ['vazio', ''],
    ['acima do Int', String(MAIOR_ID + 1)],
    ['11 dígitos', '10000000000'],
    ['número (não texto)', 1],
    ['lista (parâmetro repetido)', ['1', '2']],
    ['undefined', undefined],
    ['null', null],
  ])('recusa %s com 400 e a mensagem do recurso', (_caso, valor) => {
    expect(ehIdTexto(valor)).toBe(false);
    let erro;
    try {
      converterIdTexto(valor, MENSAGEM);
    } catch (e) {
      erro = e;
    }
    expect(erro).toBeInstanceOf(ErroHttp);
    expect(erro).toMatchObject({ status: 400, message: MENSAGEM });
  });
});

describe('ehIdNumerico (id no corpo JSON)', () => {
  it.each([1, 42, MAIOR_ID])('aceita %s', (valor) => {
    expect(ehIdNumerico(valor)).toBe(true);
  });

  it.each([0, -1, 1.5, MAIOR_ID + 1, '1', null, undefined, Number.NaN, Infinity])('recusa %s', (valor) => {
    expect(ehIdNumerico(valor)).toBe(false);
  });
});

describe('validadores de id dos services usam o mesmo critério', () => {
  it.each([
    ['categorias', validarIdCategoria],
    ['estudantes', validarIdEstudante],
    ['ocorrencias', validarIdOcorrencia],
    ['turmas', validarIdTurma],
    ['usuarios', validarIdUsuario],
  ])('%s: aceita o limite e recusa acima dele', (_recurso, validar) => {
    expect(validar(String(MAIOR_ID))).toBe(MAIOR_ID);
    expect(() => validar(String(MAIOR_ID + 1))).toThrow(ErroHttp);
    expect(() => validar('01')).toThrow(ErroHttp);
  });
});
