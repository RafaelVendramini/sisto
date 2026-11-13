// Issue #88 — ordem natural dos rótulos (decisão do Rafael, 12/11/2026):
// números no rótulo são comparados pelo valor ("6º A" antes de "10º A").
import { describe, it, expect } from 'vitest';
import { COMPARADOR_ROTULO } from '../src/services/relatorios.js';

describe('COMPARADOR_ROTULO (#88)', () => {
  it('ordena turmas pelo número, não pelo primeiro dígito', () => {
    const rotulos = ['10º A — Ensino Médio (2026)', '6º A — Ensino Fundamental (2026)', '1º A — Ensino Médio (2026)'];
    expect([...rotulos].sort(COMPARADOR_ROTULO.compare)).toEqual([
      '1º A — Ensino Médio (2026)',
      '6º A — Ensino Fundamental (2026)',
      '10º A — Ensino Médio (2026)',
    ]);
  });

  it('continua alfabético em pt-BR para texto sem números', () => {
    expect(['Ética', 'conflitos', 'Bullying'].sort(COMPARADOR_ROTULO.compare)).toEqual(['Bullying', 'conflitos', 'Ética']);
  });
});
