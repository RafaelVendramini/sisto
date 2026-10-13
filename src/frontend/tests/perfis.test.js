import { describe, it, expect } from 'vitest';
import { ROTULOS_PERFIL, rotuloPerfil } from '../src/services/perfis.js';

describe('utils/perfis', () => {
  it('converte cada valor técnico no rótulo amigável (SSD, Seção 11)', () => {
    expect(rotuloPerfil('PROFESSOR')).toBe('Professor');
    expect(rotuloPerfil('TUTOR')).toBe('Tutor');
    expect(rotuloPerfil('GESTAO')).toBe('Gestão');
    expect(rotuloPerfil('PEDAGOGICO')).toBe('Pedagógico');
    expect(rotuloPerfil('TECNICO_ADMINISTRATIVO')).toBe('Técnico-administrativo');
    expect(Object.keys(ROTULOS_PERFIL)).toHaveLength(5);
  });

  it('devolve texto vazio para perfil desconhecido', () => {
    expect(rotuloPerfil('INEXISTENTE')).toBe('');
    expect(rotuloPerfil(undefined)).toBe('');
  });
});
