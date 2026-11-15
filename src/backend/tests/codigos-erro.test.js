// Testes do código estável no corpo de erro (Issue #72, D1 — SSD v1.8,
// Seção 12): todo 409 traz { erro, codigo } e o 403 da troca de senha
// obrigatória pendente (RN10) traz codigo TROCA_SENHA_OBRIGATORIA. Os demais
// erros continuam só com { erro }. Somente dados fictícios (RN05); sem banco.
import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CODIGOS_ERRO, ErroHttp } from '../src/lib/erros.js';
import { tratarErros } from '../src/middlewares/erros.js';

const RAIZ_SRC = fileURLToPath(new URL('../src/', import.meta.url));

/** Conteúdo de todos os .js de src/ (recursivo). */
function lerFontes(dir = RAIZ_SRC) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((item) => {
    const caminho = join(dir, item.name);
    if (item.isDirectory()) return lerFontes(caminho);
    return item.name.endsWith('.js') ? [{ caminho, texto: readFileSync(caminho, 'utf8') }] : [];
  });
}

/** Cada `new ErroHttp(...)` do código-fonte, com o status e o texto da chamada. */
function chamadasErroHttp() {
  const chamadas = [];
  for (const { caminho, texto } of lerFontes()) {
    const re = /new ErroHttp\(\s*(\d{3})\s*,([\s\S]*?)\);/g;
    for (const m of texto.matchAll(re)) {
      chamadas.push({ caminho, status: Number(m[1]), argumentos: m[2] });
    }
  }
  return chamadas;
}

/** App mínima que lança `erro` e usa o middleware central de erros. */
function appQueLanca(erro) {
  const app = express();
  app.get('/x', () => {
    throw erro;
  });
  app.use(tratarErros);
  return app;
}

describe('CODIGOS_ERRO — catálogo único dos códigos estáveis', () => {
  const valores = Object.values(CODIGOS_ERRO);

  it('está congelado (não pode ser alterado em tempo de execução)', () => {
    expect(Object.isFrozen(CODIGOS_ERRO)).toBe(true);
  });

  it('não está vazio e cada chave é igual ao seu valor', () => {
    expect(valores.length).toBeGreaterThan(0);
    for (const [chave, valor] of Object.entries(CODIGOS_ERRO)) {
      expect(valor).toBe(chave);
    }
  });

  it('todos os códigos são MAIÚSCULAS_COM_SUBLINHADO, sem acento', () => {
    for (const valor of valores) {
      expect(valor).toMatch(/^[A-Z]+(_[A-Z]+)*$/);
    }
  });

  it('não há códigos repetidos', () => {
    expect(new Set(valores).size).toBe(valores.length);
  });

  it('contém os códigos das situações de 409 e o da RN10', () => {
    expect(Object.keys(CODIGOS_ERRO).sort()).toEqual(
      [
        'ALTERAR_PROPRIO_ACESSO',
        'CATEGORIA_DUPLICADA',
        'CODIGO_ESCOLAR_DUPLICADO',
        'CONFLITO_CONCORRENTE',
        'EMAIL_DUPLICADO',
        'ENCERRAMENTO_SEM_PROVIDENCIA',
        'GESTAO_ATIVA_MINIMA',
        'OCORRENCIA_ABERTA',
        'OCORRENCIA_ENCERRADA',
        'REDEFINIR_PROPRIA_SENHA',
        'TROCA_SENHA_OBRIGATORIA',
        'TURMA_DUPLICADA',
        'TUTOR_COM_TUTORADOS',
      ].sort(),
    );
  });
});

describe('código-fonte — todo 409 tem código, e só o 403 da RN10 entre os demais', () => {
  const chamadas = chamadasErroHttp();

  it('encontra lançamentos de 409 no back-end', () => {
    expect(chamadas.filter((c) => c.status === 409).length).toBeGreaterThanOrEqual(20);
  });

  it('todo `new ErroHttp(409, ...)` informa `codigo: CODIGOS_ERRO.<código existente>`', () => {
    for (const { caminho, status, argumentos } of chamadas.filter((c) => c.status === 409)) {
      const m = argumentos.match(/codigo:\s*CODIGOS_ERRO\.([A-Z_]+)/);
      expect(m, `${caminho}: 409 sem codigo`).not.toBeNull();
      expect(CODIGOS_ERRO, `${caminho}: código ${m[1]} inexistente`).toHaveProperty(m[1]);
      expect(status).toBe(409);
    }
  });

  it('fora do 409, só o 403 da troca de senha obrigatória (RN10) tem código', () => {
    const comCodigo = chamadas.filter((c) => c.status !== 409 && /codigo:/.test(c.argumentos));
    expect(comCodigo).toHaveLength(1);
    expect(comCodigo[0].status).toBe(403);
    expect(comCodigo[0].argumentos).toMatch(/CODIGOS_ERRO\.TROCA_SENHA_OBRIGATORIA/);
  });

  it('todo código do catálogo é usado em algum lugar do back-end', () => {
    const fontes = lerFontes()
      .map((f) => f.texto)
      .join('\n');
    for (const chave of Object.keys(CODIGOS_ERRO)) {
      expect(fontes, chave).toContain(`CODIGOS_ERRO.${chave}`);
    }
  });
});

describe('ErroHttp e middleware de erros — campo `codigo`', () => {
  it('ErroHttp guarda o código quando informado e não cria a propriedade sem ele', () => {
    const comCodigo = new ErroHttp(409, 'Conflito fictício.', { codigo: CODIGOS_ERRO.EMAIL_DUPLICADO });
    expect(comCodigo.codigo).toBe('EMAIL_DUPLICADO');
    const semCodigo = new ErroHttp(400, 'Entrada fictícia inválida.');
    expect(semCodigo).not.toHaveProperty('codigo');
  });

  it('com código: responde { erro, codigo } com o status do erro', async () => {
    const erro = new ErroHttp(409, 'Conflito fictício.', { codigo: CODIGOS_ERRO.CONFLITO_CONCORRENTE });
    const res = await request(appQueLanca(erro)).get('/x');
    expect(res.status).toBe(409);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.body).toEqual({ erro: 'Conflito fictício.', codigo: 'CONFLITO_CONCORRENTE' });
  });

  it('sem código: o corpo continua só { erro }', async () => {
    const res = await request(appQueLanca(new ErroHttp(400, 'Entrada fictícia inválida.'))).get('/x');
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ erro: 'Entrada fictícia inválida.' });
  });

  it('código e cabeçalhos juntos convivem (a lista de cabeçalhos permitidos segue valendo)', async () => {
    const erro = new ErroHttp(409, 'Conflito fictício.', {
      codigo: CODIGOS_ERRO.CONFLITO_CONCORRENTE,
      cabecalhos: { 'X-Nao-Permitido': 'x' },
    });
    const res = await request(appQueLanca(erro)).get('/x');
    expect(res.body).toEqual({ erro: 'Conflito fictício.', codigo: 'CONFLITO_CONCORRENTE' });
    expect(res.headers['x-nao-permitido']).toBeUndefined();
  });

  it('erro que não é ErroHttp não define `codigo`, mesmo com a propriedade', async () => {
    // Mesmo formato dos erros do Express/body-parser (status + expose).
    const erro = Object.assign(new Error('Conflito de biblioteca fictício.'), {
      status: 409,
      expose: true,
      codigo: 'QUALQUER_COISA',
    });
    const res = await request(appQueLanca(erro)).get('/x');
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ erro: 'Conflito de biblioteca fictício.' });
  });

  it('o 500 nunca traz código, mesmo que o erro tenha um', async () => {
    const erro = new Error('falha interna fictícia');
    erro.codigo = CODIGOS_ERRO.CONFLITO_CONCORRENTE;
    const res = await request(appQueLanca(erro)).get('/x');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ erro: 'Erro interno do servidor' });
  });
});
