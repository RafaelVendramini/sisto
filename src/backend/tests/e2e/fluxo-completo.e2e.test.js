// Fluxo completo de uma ocorrência, de ponta a ponta pela API (Issue #93,
// item 1): app real + banco de testes real, somente dados fictícios (RN05).
//
// Os passos rodam EM ORDEM e dependem uns dos outros (o estado da ocorrência
// passa de um para o outro), por isso ficam num único describe; o Vitest roda
// os testes de um arquivo em sequência, na ordem em que aparecem.
// Regras cobertas: RN02, RN03, RN04, RN08, RN14, RN15, RN16, RN17, RN19,
// RN22, RF05, RF06, RF08–RF13, UC01–UC05.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarApp } from '../../src/app.js';
import {
  DATA_HORA_FATO,
  DIA_FATO,
  corpoComunicacao,
  criarCategoria,
  criarEstudante,
  criarTurma,
  criarUsuario,
  desconectarPrisma,
  entrar,
  enviar,
  exigirStatus,
  limparBanco,
  prisma,
} from './apoio/dados.js';

const app = criarApp();

let gestao;
let tutor;
let turma;
let outraTurma;
let categoria;
let estudanteA;
let estudanteB;
let tokenGestao;
let tokenTutor;
let ocorrenciaId;

beforeAll(async () => {
  await limparBanco();
  // RN11: duas Gestões ativas (a segunda só existe para manter a regra).
  gestao = await criarUsuario({ perfil: 'GESTAO', nome: 'Gestão Fictícia Fluxo' });
  await criarUsuario({ perfil: 'GESTAO' });
  tutor = await criarUsuario({ perfil: 'TUTOR', nome: 'Tutor Fictício Fluxo' });
  turma = await criarTurma('7º A Fictício');
  outraTurma = await criarTurma('8º B Fictício');
  categoria = await criarCategoria('Categoria Fictícia do Fluxo');
  estudanteA = await criarEstudante({ turmaId: turma.id, tutorId: tutor.id });
  // RN14: estudante de outra turma também pode estar na ocorrência.
  estudanteB = await criarEstudante({ turmaId: outraTurma.id });
});

afterAll(async () => {
  await desconectarPrisma();
});

describe('Fluxo completo da ocorrência (Issue #93, item 1)', () => {
  it('1. login da Gestão (POST /auth/login → 200, com token)', async () => {
    const corpo = await entrar(app, gestao.email);
    expect(corpo.token).toEqual(expect.any(String));
    expect(corpo.usuario).toEqual({ id: gestao.id, nome: gestao.nome, perfil: 'GESTAO' });
    expect(corpo.trocaSenhaObrigatoria).toBe(false);
    tokenGestao = corpo.token;
  });

  it('2. registra ocorrência com 2 estudantes, nasce "aberto" (RN02, RN03, RF06)', async () => {
    const res = await enviar(app, 'POST', '/ocorrencias', {
      token: tokenGestao,
      corpo: {
        dataHora: DATA_HORA_FATO,
        local: 'Quadra (fictícia)',
        turmaId: turma.id,
        categoriaId: categoria.id,
        descricao: 'Desentendimento fictício entre dois estudantes durante o intervalo.',
        estudanteIds: [estudanteA.id, estudanteB.id],
        encaminhamentos: [{ destinatarioPerfil: 'GESTAO' }],
        // Campos fora do contrato são ignorados (RN02: responsável é o logado).
        status: 'ENCERRADO',
        profissionalResponsavelId: tutor.id,
      },
    });
    const corpo = exigirStatus(res, 201, 'registro');
    expect(corpo.status).toBe('ABERTO');
    expect(corpo.profissionalResponsavel).toEqual({ id: gestao.id, nome: gestao.nome });
    expect(corpo.responsavelAcompanhamento).toBeNull();
    expect(corpo.turma.id).toBe(turma.id);
    expect(corpo.estudantes.map((e) => e.id).sort()).toEqual([estudanteA.id, estudanteB.id].sort());
    expect(corpo.encaminhamentos).toHaveLength(1);
    expect(corpo.encaminhamentos[0].destinatarioPerfil).toBe('GESTAO');
    ocorrenciaId = corpo.id;

    // Conferência no banco: gravado de fato (tudo ou nada — RN03).
    const gravada = await prisma.ocorrencia.findUnique({
      where: { id: ocorrenciaId },
      select: { status: true, profissional_responsavel_id: true, _count: { select: { estudantes: true } } },
    });
    expect(gravada).toEqual({ status: 'ABERTO', profissional_responsavel_id: gestao.id, _count: { estudantes: 2 } });
  });

  it('3. encaminha para o Tutor, que vira o responsável; status "em acompanhamento" (RN15)', async () => {
    const res = await enviar(app, 'POST', `/ocorrencias/${ocorrenciaId}/encaminhamentos`, {
      token: tokenGestao,
      corpo: {
        destinatarioPerfil: 'TUTOR',
        destinatarioUsuarioId: tutor.id,
        observacao: 'Encaminhamento fictício ao tutor.',
        responsavelAcompanhamentoId: tutor.id,
      },
    });
    const corpo = exigirStatus(res, 201, 'encaminhamento');
    expect(corpo.status).toBe('EM_ACOMPANHAMENTO');
    expect(corpo.responsavelAcompanhamento).toEqual({ id: tutor.id, nome: tutor.nome });
    expect(corpo.encaminhamentos).toHaveLength(2);
  });

  it('4. registra comunicação; o status não muda (RN16, RN17)', async () => {
    const res = await enviar(app, 'POST', `/ocorrencias/${ocorrenciaId}/comunicacoes`, {
      token: tokenGestao,
      corpo: corpoComunicacao(),
    });
    const corpo = exigirStatus(res, 201, 'comunicação');
    expect(corpo.status).toBe('EM_ACOMPANHAMENTO');
    expect(corpo.comunicacoes).toHaveLength(1);
    expect(corpo.comunicacoes[0].registradoPor).toEqual({ id: gestao.id, nome: gestao.nome });
  });

  it('5. o Tutor responsável registra uma providência (RN04, RN22)', async () => {
    tokenTutor = (await entrar(app, tutor.email)).token;
    const res = await enviar(app, 'POST', `/ocorrencias/${ocorrenciaId}/providencias`, {
      token: tokenTutor,
      corpo: { descricao: 'Providência fictícia: conversa orientadora com os estudantes.' },
    });
    const corpo = exigirStatus(res, 201, 'providência');
    expect(corpo.status).toBe('EM_ACOMPANHAMENTO');
    expect(corpo.providencias).toHaveLength(1);
    expect(corpo.providencias[0].registradoPor).toEqual({ id: tutor.id, nome: tutor.nome });
  });

  it('6. o Tutor responsável encerra a ocorrência; data_encerramento preenchida (RN04, RN17, RN22)', async () => {
    const antes = Date.now();
    const res = await enviar(app, 'PATCH', `/ocorrencias/${ocorrenciaId}/status`, {
      token: tokenTutor,
      corpo: { status: 'ENCERRADO' },
    });
    const corpo = exigirStatus(res, 200, 'encerramento');
    expect(corpo.status).toBe('ENCERRADO');
    expect(corpo.dataEncerramento).toEqual(expect.any(String));
    // Momento do registro (tolerância de relógio entre a API e o PostgreSQL).
    expect(new Date(corpo.dataEncerramento).getTime()).toBeGreaterThan(antes - 60_000);
  });

  it('7. histórico completo, do mais antigo para o mais novo (RN08, RF12)', async () => {
    const res = await enviar(app, 'GET', `/ocorrencias/${ocorrenciaId}/historico`, { token: tokenGestao });
    const historico = exigirStatus(res, 200, 'histórico');

    expect(historico.map(({ acao, descricao, usuario }) => ({ acao, descricao: descricao ?? null, usuario: usuario.id }))).toEqual([
      { acao: 'ocorrência registrada', descricao: null, usuario: gestao.id },
      { acao: 'encaminhamento registrado', descricao: 'Destinatário: gestão', usuario: gestao.id },
      { acao: 'encaminhamento registrado', descricao: 'Destinatário: tutor', usuario: gestao.id },
      { acao: 'status alterado', descricao: 'De aberto para em acompanhamento', usuario: gestao.id },
      { acao: 'responsável pelo acompanhamento definido', descricao: null, usuario: gestao.id },
      { acao: 'comunicação registrada', descricao: null, usuario: gestao.id },
      { acao: 'providência registrada', descricao: null, usuario: tutor.id },
      { acao: 'status alterado', descricao: 'De em acompanhamento para encerrado', usuario: tutor.id },
    ]);

    // Ordem cronológica (data/hora não decrescente) e ids crescentes.
    const tempos = historico.map((h) => new Date(h.dataHora).getTime());
    expect([...tempos].sort((a, b) => a - b)).toEqual(tempos);
    // RN08: sem o conteúdo da comunicação nem da providência.
    const texto = JSON.stringify(historico);
    expect(texto).not.toContain('Telefone');
    expect(texto).not.toContain('Responsável legal');
    expect(texto).not.toContain('conversa orientadora');

    // O Tutor responsável também vê o histórico (RN19).
    const doTutor = await enviar(app, 'GET', `/ocorrencias/${ocorrenciaId}/historico`, { token: tokenTutor });
    expect(exigirStatus(doTutor, 200, 'histórico do tutor')).toHaveLength(8);
  });

  it('8. aparece na consulta com filtros status "encerrado", turma e período (RF11, RN14)', async () => {
    const consulta = `/ocorrencias?status=ENCERRADO&turmaId=${turma.id}&dataInicio=${DIA_FATO}&dataFim=${DIA_FATO}`;
    const corpo = exigirStatus(await enviar(app, 'GET', consulta, { token: tokenGestao }), 200, 'consulta');
    expect(corpo).toMatchObject({ total: 1, pagina: 1, tamanhoPagina: 20 });
    expect(corpo.itens).toHaveLength(1);
    expect(corpo.itens[0]).toMatchObject({ id: ocorrenciaId, status: 'ENCERRADO', turma: { id: turma.id } });
    expect(corpo.itens[0].estudantes).toHaveLength(2);

    // Contraprovas: outro status, a turma do estudante B (não é a da ocorrência — RN14) e outro dia.
    const vazias = [
      `/ocorrencias?status=ABERTO&turmaId=${turma.id}`,
      `/ocorrencias?turmaId=${outraTurma.id}`,
      '/ocorrencias?dataInicio=2026-03-11&dataFim=2026-03-11',
    ];
    for (const url of vazias) {
      const r = exigirStatus(await enviar(app, 'GET', url, { token: tokenGestao }), 200, url);
      expect(r.total, url).toBe(0);
    }
  });

  it('9. relatório por categoria conta 1, mesmo com 2 estudantes (RF13, UC05)', async () => {
    const url = `/relatorios?tipo=categoria&dataInicio=${DIA_FATO}&dataFim=${DIA_FATO}`;
    const corpo = exigirStatus(await enviar(app, 'GET', url, { token: tokenGestao }), 200, 'relatório');
    expect(corpo.total).toBe(1);
    expect(corpo.linhas).toEqual([{ id: categoria.id, rotulo: categoria.nome, quantidade: 1 }]);
  });

  it('10. encerrada não recebe novo encaminhamento, comunicação nem providência (409 — RN04, RN15, RN16)', async () => {
    const tentativas = [
      [
        'encaminhamento',
        enviar(app, 'POST', `/ocorrencias/${ocorrenciaId}/encaminhamentos`, {
          token: tokenGestao,
          corpo: { destinatarioPerfil: 'EQUIPE_PEDAGOGICA' },
        }),
      ],
      [
        'comunicação',
        enviar(app, 'POST', `/ocorrencias/${ocorrenciaId}/comunicacoes`, { token: tokenGestao, corpo: corpoComunicacao() }),
      ],
      [
        'providência',
        enviar(app, 'POST', `/ocorrencias/${ocorrenciaId}/providencias`, {
          token: tokenGestao,
          corpo: { descricao: 'Providência fictícia depois do encerramento.' },
        }),
      ],
    ];
    for (const [nome, promessa] of tentativas) {
      const res = await promessa;
      expect(res.status, nome).toBe(409);
      expect(res.body.erro, nome).toEqual(expect.any(String));
      // Código estável da ocorrência encerrada (Subtask #115 — D1 da #72).
      expect(res.body.codigo, nome).toBe('OCORRENCIA_ENCERRADA');
    }

    // Nada foi gravado pelas tentativas recusadas.
    const totais = await prisma.ocorrencia.findUnique({
      where: { id: ocorrenciaId },
      select: {
        status: true,
        _count: { select: { encaminhamentos: true, comunicacoes: true, providencias: true, historico: true } },
      },
    });
    expect(totais).toEqual({
      status: 'ENCERRADO',
      _count: { encaminhamentos: 2, comunicacoes: 1, providencias: 1, historico: 8 },
    });
  });
});
