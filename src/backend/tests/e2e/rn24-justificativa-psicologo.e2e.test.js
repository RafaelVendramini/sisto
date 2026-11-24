// RN24 de ponta a ponta pela API (Issue #154, front-end da Story #152; SSD
// 1.18, RN03, RN08, RN15, RN19, RN23, RN24 e Seção 12): a justificativa do
// encaminhamento ao psicólogo escolar só vem preenchida para a Gestão, para o
// psicólogo destinatário e para quem registrou AQUELE encaminhamento; os demais
// que veem a ocorrência (inclusive a Equipe Pedagógica e outro psicólogo)
// recebem `observacao: null`. A justificativa nunca entra no histórico, na
// auditoria nem nos relatórios, e a visibilidade segue o usuário mesmo depois
// de uma mudança de perfil.
// App real + banco de testes real, somente dados fictícios (RN05).
//
// Os passos rodam EM ORDEM e dependem uns dos outros (mesmo padrão do
// fluxo-completo.e2e.test.js).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarApp } from '../../src/app.js';
import {
  DIA_FATO,
  corpoComunicacao,
  criarCategoria,
  criarEstudante,
  criarTurma,
  criarUsuario,
  criarUsuarioLogado,
  desconectarPrisma,
  encaminhar,
  entrar,
  enviar,
  exigirStatus,
  limparBanco,
  prisma,
  registrarOcorrencia,
} from './apoio/dados.js';

const app = criarApp();

const JUSTIFICATIVA_1 = 'Justificativa fictícia 1: estudante chorou durante a aula e pediu ajuda.';
const JUSTIFICATIVA_2 = 'Justificativa fictícia 2: estudante relatou dificuldade de dormir.';

/** Usuários logados, preenchidos no beforeAll. */
const u = {};
let turma;
let categoria;
let estudante;
let ocorrenciaId;
let encaminhamento1Id;
let encaminhamento2Id;

/** GET /ocorrencias/{id} como `quem`; devolve { status, corpo }. */
async function detalheComo(quem) {
  const res = await enviar(app, 'GET', `/ocorrencias/${ocorrenciaId}`, { token: u[quem].token });
  return { status: res.status, corpo: res.body };
}

/** Observação de cada encaminhamento ao psicólogo do detalhe, por id. */
function observacoes(corpo) {
  return Object.fromEntries(
    corpo.encaminhamentos
      .filter((e) => e.destinatarioPerfil === 'PSICOLOGO')
      .map((e) => [e.id, e.observacao]),
  );
}

beforeAll(async () => {
  await limparBanco();
  // RN11: duas Gestões ativas.
  u.gestao = await criarUsuarioLogado(app, 'GESTAO');
  await criarUsuario({ perfil: 'GESTAO' });
  u.professor = await criarUsuarioLogado(app, 'PROFESSOR');
  u.tutor = await criarUsuarioLogado(app, 'TUTOR');
  u.pedagogicoA = await criarUsuarioLogado(app, 'PEDAGOGICO');
  u.pedagogicoB = await criarUsuarioLogado(app, 'PEDAGOGICO');
  u.psicologoA = await criarUsuarioLogado(app, 'PSICOLOGO', { nome: 'Psicóloga Fictícia A' });
  u.psicologoB = await criarUsuarioLogado(app, 'PSICOLOGO', { nome: 'Psicólogo Fictício B' });
  u.psicologoInativo = await criarUsuario({ perfil: 'PSICOLOGO', status: 'DESATIVADO' });
  u.tecnico = await criarUsuarioLogado(app, 'TECNICO_ADMINISTRATIVO');

  turma = await criarTurma('8º D Fictício RN24');
  categoria = await criarCategoria('Categoria Fictícia RN24');
  // O Tutor vê a ocorrência por ser tutor do estudante (RN19).
  estudante = await criarEstudante({ turmaId: turma.id, tutorId: u.tutor.id });
});

afterAll(async () => {
  await desconectarPrisma();
});

describe('RN24: justificativa do encaminhamento ao psicólogo escolar (Issue #154)', () => {
  it('1. registro recusado sem justificativa, com justificativa só de espaços ou sem psicólogo ativo → 400, nada gravado', async () => {
    const antes = await prisma.ocorrencia.count();
    const casos = [
      { destinatarioPerfil: 'PSICOLOGO', destinatarioUsuarioId: u.psicologoA.id },
      { destinatarioPerfil: 'PSICOLOGO', destinatarioUsuarioId: u.psicologoA.id, observacao: '   ' },
      { destinatarioPerfil: 'PSICOLOGO', observacao: JUSTIFICATIVA_1 },
      { destinatarioPerfil: 'PSICOLOGO', destinatarioUsuarioId: u.psicologoInativo.id, observacao: JUSTIFICATIVA_1 },
      { destinatarioPerfil: 'PSICOLOGO', destinatarioUsuarioId: u.tutor.id, observacao: JUSTIFICATIVA_1 },
    ];
    for (const encaminhamento of casos) {
      const res = await enviar(app, 'POST', '/ocorrencias', {
        token: u.professor.token,
        corpo: {
          dataHora: `${DIA_FATO}T10:00:00-03:00`,
          local: 'Pátio (fictício)',
          turmaId: turma.id,
          categoriaId: categoria.id,
          descricao: 'Descrição objetiva e fictícia do fato (RN05, RN06).',
          estudanteIds: [estudante.id],
          encaminhamentos: [encaminhamento],
        },
      });
      expect(res.status, JSON.stringify(encaminhamento)).toBe(400);
      expect(res.body.erro).toEqual(expect.any(String));
    }
    expect(await prisma.ocorrencia.count()).toBe(antes);
  });

  it('2. o Professor registra com encaminhamento ao psicólogo A e lê a própria justificativa (201)', async () => {
    const criada = await registrarOcorrencia(app, u.professor.token, {
      turmaId: turma.id,
      categoriaId: categoria.id,
      estudanteIds: [estudante.id],
      encaminhamentos: [
        { destinatarioPerfil: 'PSICOLOGO', destinatarioUsuarioId: u.psicologoA.id, observacao: `  ${JUSTIFICATIVA_1}  ` },
      ],
    });
    ocorrenciaId = criada.id;
    expect(criada.status).toBe('ABERTO');
    expect(criada.encaminhamentos).toHaveLength(1);
    encaminhamento1Id = criada.encaminhamentos[0].id;
    expect(criada.encaminhamentos[0]).toMatchObject({
      destinatarioPerfil: 'PSICOLOGO',
      destinatarioUsuario: { id: u.psicologoA.id },
      observacao: JUSTIFICATIVA_1,
    });

    // A justificativa é gravada (sem espaços nas pontas); só a resposta é filtrada.
    const noBanco = await prisma.encaminhamento.findUnique({ where: { id: encaminhamento1Id } });
    expect(noBanco.observacao).toBe(JUSTIFICATIVA_1);
  });

  it('3. GET do detalhe: Gestão, psicólogo A e Professor leem; Tutor e Pedagógico recebem null; psicólogo B não vê (404)', async () => {
    for (const quem of ['gestao', 'psicologoA', 'professor']) {
      const { status, corpo } = await detalheComo(quem);
      expect(status, quem).toBe(200);
      expect(observacoes(corpo), quem).toEqual({ [encaminhamento1Id]: JUSTIFICATIVA_1 });
    }
    for (const quem of ['tutor', 'pedagogicoA', 'pedagogicoB']) {
      const { status, corpo } = await detalheComo(quem);
      expect(status, quem).toBe(200);
      // O encaminhamento continua visível (destinatário, data, quem registrou); só o texto vem null.
      expect(corpo.encaminhamentos[0]).toMatchObject({
        destinatarioPerfil: 'PSICOLOGO',
        destinatarioUsuario: { id: u.psicologoA.id },
        registradoPor: { id: u.professor.id },
        observacao: null,
      });
    }
    // RN19: o psicólogo B e o Técnico-administrativo não veem a ocorrência.
    expect((await detalheComo('psicologoB')).status).toBe(404);
    expect((await detalheComo('tecnico')).status).toBe(404);
  });

  it('4. o psicólogo não pode ser responsável pelo acompanhamento (400) e não encaminha (403)', async () => {
    const comoResponsavel = await enviar(app, 'POST', `/ocorrencias/${ocorrenciaId}/encaminhamentos`, {
      token: u.pedagogicoA.token,
      corpo: { destinatarioPerfil: 'EQUIPE_PEDAGOGICA', responsavelAcompanhamentoId: u.psicologoA.id },
    });
    expect(comoResponsavel.status).toBe(400);

    const peloPsicologo = await enviar(app, 'POST', `/ocorrencias/${ocorrenciaId}/encaminhamentos`, {
      token: u.psicologoA.token,
      corpo: { destinatarioPerfil: 'GESTAO', responsavelAcompanhamentoId: u.pedagogicoA.id },
    });
    expect(peloPsicologo.status).toBe(403);

    const semJustificativa = await enviar(app, 'POST', `/ocorrencias/${ocorrenciaId}/encaminhamentos`, {
      token: u.pedagogicoA.token,
      corpo: {
        destinatarioPerfil: 'PSICOLOGO',
        destinatarioUsuarioId: u.psicologoB.id,
        responsavelAcompanhamentoId: u.pedagogicoA.id,
      },
    });
    expect(semJustificativa.status).toBe(400);
    expect((await detalheComo('gestao')).corpo.status).toBe('ABERTO');
  });

  it('5. o Pedagógico A encaminha ao psicólogo B e lê só a justificativa que ele mesmo escreveu (201)', async () => {
    const corpo = await encaminhar(app, u.pedagogicoA.token, ocorrenciaId, {
      destinatarioPerfil: 'PSICOLOGO',
      destinatarioUsuarioId: u.psicologoB.id,
      responsavelAcompanhamentoId: u.pedagogicoA.id,
      observacao: JUSTIFICATIVA_2,
    });
    expect(corpo.status).toBe('EM_ACOMPANHAMENTO');
    encaminhamento2Id = corpo.encaminhamentos.find(
      (e) => e.destinatarioPerfil === 'PSICOLOGO' && e.destinatarioUsuario?.id === u.psicologoB.id,
    ).id;
    expect(observacoes(corpo)).toEqual({ [encaminhamento1Id]: null, [encaminhamento2Id]: JUSTIFICATIVA_2 });
  });

  it('6. cada um lê só as justificativas permitidas, nos dois encaminhamentos', async () => {
    const esperado = {
      gestao: { [encaminhamento1Id]: JUSTIFICATIVA_1, [encaminhamento2Id]: JUSTIFICATIVA_2 },
      psicologoA: { [encaminhamento1Id]: JUSTIFICATIVA_1, [encaminhamento2Id]: null },
      psicologoB: { [encaminhamento1Id]: null, [encaminhamento2Id]: JUSTIFICATIVA_2 },
      // Quem registrou a ocorrência não lê a justificativa escrita por outra pessoa.
      professor: { [encaminhamento1Id]: JUSTIFICATIVA_1, [encaminhamento2Id]: null },
      pedagogicoA: { [encaminhamento1Id]: null, [encaminhamento2Id]: JUSTIFICATIVA_2 },
      pedagogicoB: { [encaminhamento1Id]: null, [encaminhamento2Id]: null },
      tutor: { [encaminhamento1Id]: null, [encaminhamento2Id]: null },
    };
    for (const [quem, obs] of Object.entries(esperado)) {
      const { status, corpo } = await detalheComo(quem);
      expect(status, quem).toBe(200);
      expect(observacoes(corpo), quem).toEqual(obs);
    }
  });

  it('7. o psicólogo B registra comunicação (201) e a resposta segue a RN24; providência e encerramento → 403', async () => {
    const res = await enviar(app, 'POST', `/ocorrencias/${ocorrenciaId}/comunicacoes`, {
      token: u.psicologoB.token,
      corpo: corpoComunicacao(),
    });
    const corpo = exigirStatus(res, 201, 'POST comunicacoes (psicólogo B)');
    expect(corpo.comunicacoes).toHaveLength(1);
    expect(observacoes(corpo)).toEqual({ [encaminhamento1Id]: null, [encaminhamento2Id]: JUSTIFICATIVA_2 });

    const providencia = await enviar(app, 'POST', `/ocorrencias/${ocorrenciaId}/providencias`, {
      token: u.psicologoB.token,
      corpo: { descricao: 'Providência fictícia.' },
    });
    expect(providencia.status).toBe(403);
    const encerrar = await enviar(app, 'PATCH', `/ocorrencias/${ocorrenciaId}/status`, {
      token: u.psicologoB.token,
      corpo: { status: 'ENCERRADO' },
    });
    expect(encerrar.status).toBe(403);
  });

  it('8. a resposta da providência registrada pelo Pedagógico B também vem com null (RN24 em todas as respostas)', async () => {
    const res = await enviar(app, 'POST', `/ocorrencias/${ocorrenciaId}/providencias`, {
      token: u.pedagogicoB.token,
      corpo: { descricao: 'Providência fictícia do Pedagógico B.' },
    });
    const corpo = exigirStatus(res, 201, 'POST providencias (Pedagógico B)');
    expect(observacoes(corpo)).toEqual({ [encaminhamento1Id]: null, [encaminhamento2Id]: null });
  });

  it('9. histórico, auditoria e relatório não contêm a justificativa (RN08, RNF04, UC05)', async () => {
    const historico = exigirStatus(
      await enviar(app, 'GET', `/ocorrencias/${ocorrenciaId}/historico`, { token: u.gestao.token }),
      200,
      'GET historico',
    );
    const textoHistorico = JSON.stringify(historico);
    expect(textoHistorico).toContain('Destinatário: psicólogo escolar');
    expect(textoHistorico).not.toContain(JUSTIFICATIVA_1);
    expect(textoHistorico).not.toContain(JUSTIFICATIVA_2);

    const noBanco = JSON.stringify([
      await prisma.historicoOcorrencia.findMany({ where: { ocorrencia_id: ocorrenciaId } }),
      await prisma.logAuditoria.findMany(),
    ]);
    expect(noBanco).not.toContain('Justificativa fictícia');

    const relatorio = exigirStatus(
      await enviar(app, 'GET', `/relatorios?tipo=categoria&dataInicio=${DIA_FATO}&dataFim=${DIA_FATO}`, {
        token: u.gestao.token,
      }),
      200,
      'GET relatorios',
    );
    expect(JSON.stringify(relatorio)).not.toContain('Justificativa fictícia');
  });

  it('10. a visibilidade segue o usuário: o psicólogo A vira Professor (200) e continua lendo a sua justificativa', async () => {
    const res = await enviar(app, 'PUT', `/usuarios/${u.psicologoA.id}`, {
      token: u.gestao.token,
      corpo: { perfil: 'PROFESSOR' },
    });
    expect(exigirStatus(res, 200, 'PSICOLOGO → PROFESSOR').perfil).toBe('PROFESSOR');

    // Novo login (o perfil mudou); a regra é a mesma com o token antigo ou o novo.
    u.psicologoA = { ...u.psicologoA, token: (await entrar(app, u.psicologoA.email)).token };
    const { status, corpo } = await detalheComo('psicologoA');
    expect(status).toBe(200);
    expect(observacoes(corpo)).toEqual({ [encaminhamento1Id]: JUSTIFICATIVA_1, [encaminhamento2Id]: null });
  });
});
