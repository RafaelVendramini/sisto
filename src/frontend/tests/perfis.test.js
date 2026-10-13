import { describe, it, expect } from 'vitest';
import {
  ROTULOS_PERFIL,
  ROTULOS_STATUS,
  PERFIS_GESTAO_USUARIOS,
  podeGerenciarUsuarios,
  rotuloPerfil,
  rotuloStatus,
} from '../src/services/perfis.js';

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

describe('services/perfis — status do usuário', () => {
  it('converte cada status técnico no rótulo amigável (SSD, Seção 11)', () => {
    expect(rotuloStatus('ATIVO')).toBe('Ativo');
    expect(rotuloStatus('BLOQUEADO')).toBe('Bloqueado');
    expect(rotuloStatus('DESATIVADO')).toBe('Desativado');
    expect(Object.keys(ROTULOS_STATUS)).toHaveLength(3);
  });

  it('devolve texto vazio para status desconhecido', () => {
    expect(rotuloStatus('INEXISTENTE')).toBe('');
    expect(rotuloStatus(undefined)).toBe('');
  });
});

describe('services/perfis — acesso à gestão de usuários', () => {
  it('somente a Gestão acessa a página de usuários (Seção 4)', () => {
    expect(PERFIS_GESTAO_USUARIOS).toEqual(['GESTAO']);
    expect(podeGerenciarUsuarios('GESTAO')).toBe(true);
    for (const perfil of ['PROFESSOR', 'TUTOR', 'PEDAGOGICO', 'TECNICO_ADMINISTRATIVO', undefined]) {
      expect(podeGerenciarUsuarios(perfil)).toBe(false);
    }
  });
});
