// Testes unitários da regra de período compartilhada (services/periodo.js,
// Issues #86 e #88): dias inteiros no fuso de São Paulo, pontas incluídas,
// convertidos para UTC (RN17). Não dependem do banco.
import { describe, it, expect } from 'vitest';
import { ErroHttp } from '../src/lib/erros.js';
import { MENSAGENS_PERIODO, interpretarPeriodo } from '../src/services/periodo.js';

const obrigatorio = { obrigatorio: true };

function erroDe(funcao) {
  try {
    funcao();
  } catch (erro) {
    return erro;
  }
  throw new Error('esperava um erro');
}

function esperar400(parametros, mensagem, opcoes = obrigatorio) {
  const erro = erroDe(() => interpretarPeriodo(parametros, opcoes));
  expect(erro).toBeInstanceOf(ErroHttp);
  expect(erro.status).toBe(400);
  expect(erro.message).toBe(mensagem);
}

/** O instante está dentro do período (pontas incluídas)? */
const dentro = ({ inicio, fim }, iso) => {
  const t = new Date(iso).getTime();
  return t >= inicio.getTime() && t <= fim.getTime();
};

describe('interpretarPeriodo — limites em São Paulo', () => {
  it('um dia: 00:00:00.000 a 23:59:59.999 de São Paulo, em UTC (-03:00)', () => {
    const { inicio, fim } = interpretarPeriodo({ dataInicio: '2026-10-10', dataFim: '2026-10-10' }, obrigatorio);
    expect(inicio.toISOString()).toBe('2026-10-10T03:00:00.000Z');
    expect(fim.toISOString()).toBe('2026-10-11T02:59:59.999Z');
  });

  it('vários dias: as duas pontas entram inteiras', () => {
    const { inicio, fim } = interpretarPeriodo({ dataInicio: '2026-10-01', dataFim: '2026-10-31' }, obrigatorio);
    expect(inicio.toISOString()).toBe('2026-10-01T03:00:00.000Z');
    expect(fim.toISOString()).toBe('2026-11-01T02:59:59.999Z');
  });

  it('23h30 de São Paulo (02h30 UTC do dia seguinte) entra no dia de São Paulo', () => {
    const periodo = interpretarPeriodo({ dataInicio: '2026-10-10', dataFim: '2026-10-10' }, obrigatorio);
    expect(dentro(periodo, '2026-10-11T02:30:00.000Z')).toBe(true); // 10/10 23h30 em SP
    expect(dentro(periodo, '2026-10-10T23:30:00-03:00')).toBe(true);
    expect(dentro(periodo, '2026-10-11T03:00:00.000Z')).toBe(false); // 11/10 00h00 em SP
    expect(dentro(periodo, '2026-10-10T02:59:59.999Z')).toBe(false); // 09/10 23h59 em SP
    expect(dentro(periodo, '2026-10-10T03:00:00.000Z')).toBe(true); // 10/10 00h00 em SP
  });

  it('virada de mês e ano bissexto', () => {
    const { inicio, fim } = interpretarPeriodo({ dataInicio: '2024-02-29', dataFim: '2024-12-31' }, obrigatorio);
    expect(inicio.toISOString()).toBe('2024-02-29T03:00:00.000Z');
    expect(fim.toISOString()).toBe('2025-01-01T02:59:59.999Z');
  });

  it('usa o deslocamento real do fuso (horário de verão de 2018/2019)', () => {
    // 04/11/2018: início do horário de verão, a meia-noite não existiu (o dia começou à 01h00, -02:00).
    const inicioVerao = interpretarPeriodo({ dataInicio: '2018-11-04', dataFim: '2018-11-04' }, obrigatorio);
    expect(inicioVerao.inicio.toISOString()).toBe('2018-11-04T03:00:00.000Z');
    expect(inicioVerao.fim.toISOString()).toBe('2018-11-05T01:59:59.999Z');
    // 16/02/2019: fim do horário de verão, dia de 25 horas.
    const fimVerao = interpretarPeriodo({ dataInicio: '2019-02-16', dataFim: '2019-02-16' }, obrigatorio);
    expect(fimVerao.inicio.toISOString()).toBe('2019-02-16T02:00:00.000Z');
    expect(fimVerao.fim.toISOString()).toBe('2019-02-17T02:59:59.999Z');
  });

  it('faixa técnica: anos 0001 a 9999 (o fim não passa do maior instante gravável)', () => {
    const { inicio, fim } = interpretarPeriodo({ dataInicio: '0001-01-01', dataFim: '9999-12-31' }, obrigatorio);
    expect(inicio.getUTCFullYear()).toBe(1);
    expect(fim.toISOString()).toBe('9999-12-31T23:59:59.999Z');
  });
});

describe('interpretarPeriodo — validação (400)', () => {
  it('obrigatório: datas ausentes', () => {
    esperar400({}, MENSAGENS_PERIODO.dataInicioObrigatoria);
    esperar400({ dataFim: '2026-10-10' }, MENSAGENS_PERIODO.dataInicioObrigatoria);
    esperar400({ dataInicio: '2026-10-10' }, MENSAGENS_PERIODO.dataFimObrigatoria);
    esperar400({ dataInicio: '2026-10-10', dataFim: null }, MENSAGENS_PERIODO.dataFimObrigatoria);
  });

  it.each([
    '',
    ' 2026-10-10',
    '2026-10-10 ',
    '2026-1-10',
    '10/10/2026',
    '2026-10-10T00:00:00Z',
    '20261010',
    'abc',
  ])('formato fora de AAAA-MM-DD: %j', (valor) => {
    esperar400({ dataInicio: valor, dataFim: '2026-10-10' }, MENSAGENS_PERIODO.dataInicioInvalida);
    esperar400({ dataInicio: '2026-10-10', dataFim: valor }, MENSAGENS_PERIODO.dataFimInvalida);
  });

  it.each(['2026-02-29', '2026-02-30', '2026-04-31', '2026-13-01', '2026-00-10', '2026-10-00', '0000-01-01'])(
    'data inexistente: %s',
    (valor) => {
      esperar400({ dataInicio: valor, dataFim: '2026-10-10' }, MENSAGENS_PERIODO.dataInicioInvalida);
    },
  );

  it('valor que não é texto (ex.: parâmetro repetido na query) é inválido', () => {
    esperar400({ dataInicio: ['2026-10-10', '2026-10-11'], dataFim: '2026-10-11' }, MENSAGENS_PERIODO.dataInicioInvalida);
    esperar400({ dataInicio: '2026-10-10', dataFim: { a: '1' } }, MENSAGENS_PERIODO.dataFimInvalida);
  });

  it('dataInicio posterior a dataFim', () => {
    esperar400({ dataInicio: '2026-10-11', dataFim: '2026-10-10' }, MENSAGENS_PERIODO.intervaloInvalido);
    esperar400({ dataInicio: '2027-01-01', dataFim: '2026-12-31' }, MENSAGENS_PERIODO.intervaloInvalido);
  });

  it('as mensagens são claras e não vazias', () => {
    for (const mensagem of Object.values(MENSAGENS_PERIODO)) {
      expect(typeof mensagem).toBe('string');
      expect(mensagem.length).toBeGreaterThan(10);
    }
  });
});

describe('interpretarPeriodo — não obrigatório (filtros opcionais)', () => {
  it('sem datas: as duas pontas null', () => {
    expect(interpretarPeriodo({})).toEqual({ inicio: null, fim: null });
    expect(interpretarPeriodo()).toEqual({ inicio: null, fim: null });
  });

  it('só uma ponta', () => {
    const soInicio = interpretarPeriodo({ dataInicio: '2026-10-10' });
    expect(soInicio.inicio.toISOString()).toBe('2026-10-10T03:00:00.000Z');
    expect(soInicio.fim).toBeNull();
    const soFim = interpretarPeriodo({ dataFim: '2026-10-10' });
    expect(soFim.inicio).toBeNull();
    expect(soFim.fim.toISOString()).toBe('2026-10-11T02:59:59.999Z');
  });

  it('valor informado continua sendo validado', () => {
    esperar400({ dataInicio: '' }, MENSAGENS_PERIODO.dataInicioInvalida, {});
    esperar400({ dataFim: '2026-02-30' }, MENSAGENS_PERIODO.dataFimInvalida, {});
    esperar400({ dataInicio: '2026-10-11', dataFim: '2026-10-10' }, MENSAGENS_PERIODO.intervaloInvalido, {});
  });
});
