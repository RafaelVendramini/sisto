// Utilitários da tela de registro de ocorrência (Issue #46): data e hora no
// horário de São Paulo (RN17) e agrupamento de tutores sugeridos (RN03).
// Somente dados fictícios (RN05 / LGPD).
import { describe, it, expect } from 'vitest';
import {
  agoraNoFusoDaEscola,
  agruparTutores,
  dataHoraParaEnvio,
  usuariosAtivosDoPerfil,
} from '../src/services/mensagensOcorrencias.js';
import { PERFIS_REGISTRO_OCORRENCIA, podeRegistrarOcorrencia } from '../src/services/perfis.js';

describe('dataHoraParaEnvio (RN17)', () => {
  it('converte o horário de São Paulo em ISO 8601 com o deslocamento atual (-03:00)', () => {
    const resultado = dataHoraParaEnvio('2026-10-30T08:00');
    expect(resultado.iso).toBe('2026-10-30T08:00:00-03:00');
    expect(resultado.instanteMs).toBe(Date.parse('2026-10-30T11:00:00Z'));
  });

  it('calcula o deslocamento pelo Intl, sem valor fixo (horário de verão de 2018: -02:00)', () => {
    const resultado = dataHoraParaEnvio('2018-12-01T10:15');
    expect(resultado.iso).toBe('2018-12-01T10:15:00-02:00');
    expect(resultado.instanteMs).toBe(Date.parse('2018-12-01T12:15:00Z'));
  });

  it('devolve null para valor vazio ou inválido', () => {
    expect(dataHoraParaEnvio('')).toBeNull();
    expect(dataHoraParaEnvio(undefined)).toBeNull();
    expect(dataHoraParaEnvio('30/10/2026 08:00')).toBeNull();
  });

  it('sugere agora no formato do campo, no horário de São Paulo', () => {
    expect(agoraNoFusoDaEscola(Date.parse('2026-10-30T02:30:00Z'))).toBe('2026-10-29T23:30');
  });
});

describe('destinatários (RN03, RN20)', () => {
  const tutores = [
    { id: 10, nome: 'Tutor Fictício A' },
    { id: 11, nome: 'Tutora Fictícia B' },
    { id: 13, nome: 'Tutora Fictícia C' },
  ];

  it('separa os tutores dos estudantes selecionados (sem repetir e só ativos) dos demais', () => {
    const estudantes = [
      { id: 1, tutor: { id: 13, nome: 'Tutora Fictícia C' } },
      { id: 2, tutor: { id: 12, nome: 'Tutor Fictício Bloqueado' } },
      { id: 3, tutor: null },
      { id: 4, tutor: { id: 13, nome: 'Tutora Fictícia C' } },
    ];
    expect(agruparTutores(tutores, estudantes)).toEqual({
      sugeridos: [{ id: 13, nome: 'Tutora Fictícia C' }],
      outros: [
        { id: 10, nome: 'Tutor Fictício A' },
        { id: 11, nome: 'Tutora Fictícia B' },
      ],
    });
  });

  it('filtra por perfil e status ATIVO (lista completa) e aceita a lista reduzida sem status', () => {
    const completa = [
      { id: 1, nome: 'Pessoa Fictícia 1', perfil: 'PEDAGOGICO', status: 'ATIVO', email: 'a@exemplo.test' },
      { id: 2, nome: 'Pessoa Fictícia 2', perfil: 'PEDAGOGICO', status: 'BLOQUEADO', email: 'b@exemplo.test' },
      { id: 3, nome: 'Pessoa Fictícia 3', perfil: 'GESTAO', status: 'ATIVO', email: 'c@exemplo.test' },
    ];
    expect(usuariosAtivosDoPerfil(completa, 'PEDAGOGICO')).toEqual([{ id: 1, nome: 'Pessoa Fictícia 1' }]);
    expect(
      usuariosAtivosDoPerfil([{ id: 4, nome: 'Pessoa Fictícia 4', perfil: 'TUTOR' }], 'TUTOR'),
    ).toEqual([{ id: 4, nome: 'Pessoa Fictícia 4' }]);
  });
});

describe('perfis que registram ocorrência (UC01)', () => {
  it('são os 5 perfis', () => {
    expect(PERFIS_REGISTRO_OCORRENCIA).toHaveLength(5);
    for (const perfil of ['PROFESSOR', 'TUTOR', 'GESTAO', 'PEDAGOGICO', 'TECNICO_ADMINISTRATIVO']) {
      expect(podeRegistrarOcorrencia(perfil)).toBe(true);
    }
    expect(podeRegistrarOcorrencia(undefined)).toBe(false);
  });
});
