// RN23 de ponta a ponta pela API (Issue #134; SSD 1.13, Seção 6, RF04 e
// Seção 12): a Gestão não muda para Professor, Técnico-administrativo nem
// Psicólogo escolar (SSD 1.18, Issue #154) o perfil do responsável pelo
// acompanhamento de uma ocorrência não encerrada
// (409 RESPONSAVEL_COM_OCORRENCIAS) até trocar o responsável por um novo
// encaminhamento (RN15); depois disso, a mudança é aceita (200).
// App real + banco de testes real, somente dados fictícios (RN05).
//
// Os passos rodam EM ORDEM e dependem uns dos outros (mesmo padrão do
// fluxo-completo.e2e.test.js).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarApp } from '../../src/app.js';
import { CODIGOS_ERRO } from '../../src/lib/erros.js';
import { MENSAGEM_RESPONSAVEL_COM_OCORRENCIAS } from '../../src/services/usuarios.js';
import {
  criarCategoria,
  criarEstudante,
  criarTurma,
  criarUsuario,
  desconectarPrisma,
  encaminhar,
  enviar,
  entrar,
  exigirStatus,
  limparBanco,
  prisma,
  registrarOcorrencia,
} from './apoio/dados.js';

const app = criarApp();

let tokenGestao;
let tutor;
let pedagogico;
let ocorrenciaId;

beforeAll(async () => {
  await limparBanco();
  // RN11: duas Gestões ativas (a segunda só existe para manter a regra).
  const gestao = await criarUsuario({ perfil: 'GESTAO', nome: 'Gestão Fictícia RN23' });
  await criarUsuario({ perfil: 'GESTAO' });
  // Tutor SEM estudantes vinculados: a RN13 não se aplica, só a RN23.
  tutor = await criarUsuario({ perfil: 'TUTOR', nome: 'Tutor Fictício RN23' });
  pedagogico = await criarUsuario({ perfil: 'PEDAGOGICO', nome: 'Pedagógica Fictícia RN23' });
  const turma = await criarTurma('9º C Fictício RN23');
  const categoria = await criarCategoria('Categoria Fictícia RN23');
  const estudante = await criarEstudante({ turmaId: turma.id });
  tokenGestao = (await entrar(app, gestao.email)).token;

  // Ocorrência em acompanhamento com o Tutor como responsável (RN15).
  const registrada = await registrarOcorrencia(app, tokenGestao, {
    turmaId: turma.id,
    categoriaId: categoria.id,
    estudanteIds: [estudante.id],
  });
  ocorrenciaId = registrada.id;
  const encaminhada = await encaminhar(app, tokenGestao, ocorrenciaId, {
    destinatarioPerfil: 'TUTOR',
    destinatarioUsuarioId: tutor.id,
    responsavelAcompanhamentoId: tutor.id,
  });
  expect(encaminhada.status).toBe('EM_ACOMPANHAMENTO');
  expect(encaminhada.responsavelAcompanhamento).toEqual({ id: tutor.id, nome: tutor.nome });
});

afterAll(async () => {
  await desconectarPrisma();
});

describe('RN23: perfil do responsável pelo acompanhamento (Issue #134)', () => {
  it('1. a Gestão tenta mudar o Tutor responsável para Professor, Técnico-administrativo ou Psicólogo escolar → 409', async () => {
    for (const perfil of ['PROFESSOR', 'TECNICO_ADMINISTRATIVO', 'PSICOLOGO']) {
      const res = await enviar(app, 'PUT', `/usuarios/${tutor.id}`, {
        token: tokenGestao,
        corpo: { perfil },
      });
      expect(res.status, perfil).toBe(409);
      expect(res.body).toEqual({
        erro: MENSAGEM_RESPONSAVEL_COM_OCORRENCIAS,
        codigo: CODIGOS_ERRO.RESPONSAVEL_COM_OCORRENCIAS,
      });
    }

    // Nada foi gravado: perfil mantido e nenhum "usuário editado" na auditoria.
    const noBanco = await prisma.usuario.findUnique({ where: { id: tutor.id }, select: { perfil: true } });
    expect(noBanco.perfil).toBe('TUTOR');
    const logs = await prisma.logAuditoria.count({ where: { recurso: `usuarios/${tutor.id}` } });
    expect(logs).toBe(0);
  });

  it('2. a mudança entre Tutor, Pedagógico e Gestão não é recusada pela RN23 (ida e volta)', async () => {
    const paraPedagogico = await enviar(app, 'PUT', `/usuarios/${tutor.id}`, {
      token: tokenGestao,
      corpo: { perfil: 'PEDAGOGICO' },
    });
    expect(exigirStatus(paraPedagogico, 200, 'TUTOR → PEDAGOGICO').perfil).toBe('PEDAGOGICO');

    const deVolta = await enviar(app, 'PUT', `/usuarios/${tutor.id}`, {
      token: tokenGestao,
      corpo: { perfil: 'TUTOR' },
    });
    expect(exigirStatus(deVolta, 200, 'PEDAGOGICO → TUTOR').perfil).toBe('TUTOR');
  });

  it('3. a Gestão encaminha a ocorrência definindo outro responsável (RN15)', async () => {
    const corpo = await encaminhar(app, tokenGestao, ocorrenciaId, {
      destinatarioPerfil: 'EQUIPE_PEDAGOGICA',
      responsavelAcompanhamentoId: pedagogico.id,
    });
    expect(corpo.status).toBe('EM_ACOMPANHAMENTO');
    expect(corpo.responsavelAcompanhamento).toEqual({ id: pedagogico.id, nome: pedagogico.nome });
  });

  it('4. a mudança de perfil do antigo responsável passa a ser aceita (200)', async () => {
    const res = await enviar(app, 'PUT', `/usuarios/${tutor.id}`, {
      token: tokenGestao,
      corpo: { perfil: 'PROFESSOR' },
    });
    const corpo = exigirStatus(res, 200, 'TUTOR → PROFESSOR');
    expect(corpo).toMatchObject({ id: tutor.id, perfil: 'PROFESSOR' });

    const noBanco = await prisma.usuario.findUnique({ where: { id: tutor.id }, select: { perfil: true } });
    expect(noBanco.perfil).toBe('PROFESSOR');
  });

  it('5. agora o novo responsável (Pedagógico) é quem não pode virar Professor nem Psicólogo escolar → 409', async () => {
    for (const perfil of ['PROFESSOR', 'PSICOLOGO']) {
      const res = await enviar(app, 'PUT', `/usuarios/${pedagogico.id}`, {
        token: tokenGestao,
        corpo: { perfil },
      });
      expect(res.status, perfil).toBe(409);
      expect(res.body.codigo).toBe(CODIGOS_ERRO.RESPONSAVEL_COM_OCORRENCIAS);
    }
  });

  it('6. o antigo responsável, já liberado, também pode virar Psicólogo escolar (200)', async () => {
    const res = await enviar(app, 'PUT', `/usuarios/${tutor.id}`, {
      token: tokenGestao,
      corpo: { perfil: 'PSICOLOGO' },
    });
    expect(exigirStatus(res, 200, 'PROFESSOR → PSICOLOGO')).toMatchObject({ id: tutor.id, perfil: 'PSICOLOGO' });
  });
});
