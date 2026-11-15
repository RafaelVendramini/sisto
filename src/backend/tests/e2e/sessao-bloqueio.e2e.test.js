// Bloqueio e sessão de ponta a ponta pela API (Issue #93, item 3 — RN07,
// RN09, RN10, RN12). App real + banco de testes real, somente dados
// fictícios (RN05).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { criarApp } from '../../src/app.js';
import { MENSAGEM_TROCA_SENHA_OBRIGATORIA } from '../../src/middlewares/autenticacao.js';
import { MENSAGEM_CREDENCIAIS_INVALIDAS } from '../../src/services/auth.js';
import { MENSAGEM_NAO_AUTENTICADO } from '../../src/services/sessao.js';
import {
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

let gestao;
let turma;
let categoria;
let estudante;

beforeAll(async () => {
  await limparBanco();
  gestao = await criarUsuarioLogado(app, 'GESTAO');
  await criarUsuario({ perfil: 'GESTAO' }); // RN11: segunda Gestão ativa
  turma = await criarTurma();
  categoria = await criarCategoria();
  estudante = await criarEstudante({ turmaId: turma.id });
});

afterAll(async () => {
  await desconectarPrisma();
});

function loginBruto(email, senha) {
  return request(app).post('/auth/login').send({ email, senha });
}

describe('RN09: usuário bloqueado/desativado no meio do fluxo perde o acesso na requisição seguinte', () => {
  it.each(['BLOQUEADO', 'DESATIVADO'])('Professor %s: token aberto deixa de valer; reativado, volta a entrar (RN07)', async (status) => {
    const professor = await criarUsuarioLogado(app, 'PROFESSOR');

    // Meio do fluxo: registra e consulta a própria ocorrência.
    const ocorrencia = await registrarOcorrencia(app, professor.token, {
      turmaId: turma.id,
      categoriaId: categoria.id,
      estudanteIds: [estudante.id],
    });
    exigirStatus(await enviar(app, 'GET', `/ocorrencias/${ocorrencia.id}`, { token: professor.token }), 200, 'antes');

    // A Gestão bloqueia/desativa.
    const edicao = await enviar(app, 'PUT', `/usuarios/${professor.id}`, { token: gestao.token, corpo: { status } });
    expect(exigirStatus(edicao, 200, 'edição').status).toBe(status);

    // Requisição seguinte, com o MESMO token (ainda não expirado): 401.
    for (const [metodo, url, corpo] of [
      ['GET', `/ocorrencias/${ocorrencia.id}`],
      ['GET', '/ocorrencias'],
      ['POST', '/ocorrencias', {}],
      ['PUT', '/conta/senha', { senhaAtual: professor.senha, novaSenha: 'OutraSenhaFicticia#1' }],
    ]) {
      const res = await enviar(app, metodo, url, { token: professor.token, corpo });
      expect(res.status, `${metodo} ${url}`).toBe(401);
      expect(res.body).toEqual({ erro: MENSAGEM_NAO_AUTENTICADO });
    }

    // Novo login também é recusado, com a mensagem genérica (RNF06).
    const login = await loginBruto(professor.email, professor.senha);
    expect(login.status).toBe(401);
    expect(login.body).toEqual({ erro: MENSAGEM_CREDENCIAIS_INVALIDAS });

    // RN07: o histórico do que registrou é mantido.
    const detalhe = await enviar(app, 'GET', `/ocorrencias/${ocorrencia.id}`, { token: gestao.token });
    expect(exigirStatus(detalhe, 200, 'detalhe pela Gestão').profissionalResponsavel.id).toBe(professor.id);

    // Reativação pela Gestão: volta a entrar, com token novo.
    exigirStatus(await enviar(app, 'PUT', `/usuarios/${professor.id}`, { token: gestao.token, corpo: { status: 'ATIVO' } }), 200, 'reativação');
    const { token } = await entrar(app, professor.email, professor.senha);
    exigirStatus(await enviar(app, 'GET', `/ocorrencias/${ocorrencia.id}`, { token }), 200, 'depois de reativar');
  });

  it('Tutor responsável bloqueado no meio do acompanhamento não registra a providência (401)', async () => {
    const tutor = await criarUsuarioLogado(app, 'TUTOR');
    const ocorrencia = await registrarOcorrencia(app, gestao.token, {
      turmaId: turma.id,
      categoriaId: categoria.id,
      estudanteIds: [estudante.id],
    });
    await encaminhar(app, gestao.token, ocorrencia.id, {
      destinatarioPerfil: 'TUTOR',
      destinatarioUsuarioId: tutor.id,
      responsavelAcompanhamentoId: tutor.id,
    });
    exigirStatus(await enviar(app, 'GET', `/ocorrencias/${ocorrencia.id}`, { token: tutor.token }), 200, 'tutor vê');

    exigirStatus(await enviar(app, 'PUT', `/usuarios/${tutor.id}`, { token: gestao.token, corpo: { status: 'BLOQUEADO' } }), 200, 'bloqueio');

    const res = await enviar(app, 'POST', `/ocorrencias/${ocorrencia.id}/providencias`, {
      token: tutor.token,
      corpo: { descricao: 'Providência fictícia que não deve ser gravada.' },
    });
    expect(res.status).toBe(401);
    expect(await prisma.providencia.count({ where: { ocorrencia_id: ocorrencia.id } })).toBe(0);
  });
});

describe('RN12: troca de senha derruba o token antigo', () => {
  it('troca da própria senha: o token usado na troca e outras sessões abertas deixam de valer', async () => {
    const usuario = await criarUsuario({ perfil: 'PEDAGOGICO' });
    const sessao1 = (await entrar(app, usuario.email, usuario.senha)).token;
    const sessao2 = (await entrar(app, usuario.email, usuario.senha)).token;
    exigirStatus(await enviar(app, 'GET', '/turmas', { token: sessao1 }), 200, 'antes');

    const novaSenha = 'NovaSenhaFicticia#2026';
    const troca = await enviar(app, 'PUT', '/conta/senha', {
      token: sessao1,
      corpo: { senhaAtual: usuario.senha, novaSenha },
    });
    expect(troca.status).toBe(204);
    expect(troca.text).toBe(''); // sem token novo (Seção 12)

    for (const token of [sessao1, sessao2]) {
      const res = await enviar(app, 'GET', '/turmas', { token });
      expect(res.status).toBe(401);
      expect(res.body).toEqual({ erro: MENSAGEM_NAO_AUTENTICADO });
    }

    // A senha antiga não entra mais; a nova entra e o token novo vale.
    expect((await loginBruto(usuario.email, usuario.senha)).status).toBe(401);
    const novo = await entrar(app, usuario.email, novaSenha);
    expect(novo.trocaSenhaObrigatoria).toBe(false);
    exigirStatus(await enviar(app, 'GET', '/turmas', { token: novo.token }), 200, 'depois');

    // Auditoria da troca (RNF04), sem a senha.
    const logs = await prisma.logAuditoria.findMany({ where: { usuario_id: usuario.id } });
    expect(logs.length).toBeGreaterThan(0);
    expect(JSON.stringify(logs)).not.toContain(novaSenha);
  });

  it('redefinição pela Gestão: token antigo cai, a nova senha é temporária (RN10) até a troca', async () => {
    const usuario = await criarUsuario({ perfil: 'TECNICO_ADMINISTRATIVO' });
    const antigo = (await entrar(app, usuario.email, usuario.senha)).token;

    const temporaria = 'TemporariaFicticia#2026';
    const redefinicao = await enviar(app, 'PUT', `/usuarios/${usuario.id}/senha`, {
      token: gestao.token,
      corpo: { novaSenha: temporaria },
    });
    expect(redefinicao.status).toBe(204);

    expect((await enviar(app, 'GET', '/turmas', { token: antigo })).status).toBe(401);

    const comTemporaria = await entrar(app, usuario.email, temporaria);
    expect(comTemporaria.trocaSenhaObrigatoria).toBe(true);
    const bloqueado = await enviar(app, 'GET', '/turmas', { token: comTemporaria.token });
    expect(bloqueado.status).toBe(403);
    expect(bloqueado.body.erro).toBe(MENSAGEM_TROCA_SENHA_OBRIGATORIA);

    const definitiva = 'DefinitivaFicticia#2026';
    expect(
      (await enviar(app, 'PUT', '/conta/senha', {
        token: comTemporaria.token,
        corpo: { senhaAtual: temporaria, novaSenha: definitiva },
      })).status,
    ).toBe(204);
    // O token da senha temporária também cai (RN12).
    expect((await enviar(app, 'PUT', '/conta/senha', {
      token: comTemporaria.token,
      corpo: { senhaAtual: definitiva, novaSenha: 'MaisUmaFicticia#2026' },
    })).status).toBe(401);

    const final = await entrar(app, usuario.email, definitiva);
    expect(final.trocaSenhaObrigatoria).toBe(false);
    exigirStatus(await enviar(app, 'GET', '/turmas', { token: final.token }), 200, 'acesso liberado');
  });
});
