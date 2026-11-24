// Prova temporária da Issue #6: este teste falha de propósito para mostrar
// que o CI fica vermelho e bloqueia o merge. O PR é fechado sem merge.
import { describe, expect, it } from 'vitest';

describe('Prova do CI (Issue #6)', () => {
  it('falha de propósito', () => {
    expect(1 + 1).toBe(3);
  });
});
