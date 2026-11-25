// RN11 sob concorrência real (Issue #129): com 3 Gestões ativas, duas
// desativações SIMULTÂNEAS de Gestões diferentes não podem passar ambas —
// isoladas, cada uma deixaria 2 ativas; juntas, deixariam só 1.
//
// Como o resultado é garantido: PUT /usuarios/{id} lê as Gestões ativas,
// confere a RN11 e grava numa transação SERIALIZABLE (services/usuarios.js).
// Se as duas transações se sobrepõem, o PostgreSQL aborta uma delas (P2034);
// ela é repetida (lib/transacao.js), passa a ver a desativação já gravada e
// esbarra na RN11 (409 GESTAO_ATIVA_MINIMA). Se não se sobrepõem (uma termina
// antes de a outra começar), a segunda já lê o estado novo e recebe o mesmo
// 409. Nos dois casos: exatamente um 200 e um 409, e 2 Gestões ativas no fim.
// Por isso o teste não oscila com a ordem de chegada das requisições; ele
// repete o cenário algumas vezes para aumentar a chance de sobreposição real.
//
// App real + banco de testes real, somente dados fictícios (RN05).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarApp } from '../../src/app.js';
import { CODIGOS_ERRO } from '../../src/lib/erros.js';
import { MENSAGEM_MINIMO_GESTOES_ATIVAS } from '../../src/services/usuarios.js';
import { criarUsuario, desconectarPrisma, enviar, entrar, limparBanco, prisma } from './apoio/dados.js';

const app = criarApp();
const RODADAS = 60; // DIAGNÓSTICO TEMPORÁRIO da Issue #12

beforeAll(async () => {
  await limparBanco();
});

afterAll(async () => {
  await desconectarPrisma();
});

/** Desativa todas as Gestões ainda ativas, para a próxima rodada partir de 3 novas. */
async function aposentarGestoes() {
  await prisma.usuario.updateMany({
    where: { perfil: 'GESTAO', status: 'ATIVO' },
    data: { status: 'DESATIVADO' },
  });
}

const contarGestoesAtivas = () => prisma.usuario.count({ where: { perfil: 'GESTAO', status: 'ATIVO' } });

describe('RN11 — duas desativações simultâneas de Gestões (Issue #129)', () => {
  it(`com 3 Gestões ativas, exatamente um 200 e um 409 GESTAO_ATIVA_MINIMA (${RODADAS} rodadas)`, async () => {
    for (let rodada = 1; rodada <= RODADAS; rodada += 1) {
      await aposentarGestoes();
      const solicitante = await criarUsuario({ perfil: 'GESTAO' });
      const alvoA = await criarUsuario({ perfil: 'GESTAO' });
      const alvoB = await criarUsuario({ perfil: 'GESTAO' });
      expect(await contarGestoesAtivas()).toBe(3);
      const { token } = await entrar(app, solicitante.email);

      const respostas = await Promise.all(
        [alvoA, alvoB].map((alvo) =>
          enviar(app, 'PUT', `/usuarios/${alvo.id}`, { token, corpo: { status: 'DESATIVADO' } }),
        ),
      );

      const contexto = `rodada ${rodada}: ${JSON.stringify(respostas.map((r) => [r.status, r.body]))}`;
      expect(respostas.map((r) => r.status).sort(), contexto).toEqual([200, 409]);
      const recusada = respostas.find((r) => r.status === 409);
      expect(recusada.body, contexto).toEqual({
        erro: MENSAGEM_MINIMO_GESTOES_ATIVAS,
        codigo: CODIGOS_ERRO.GESTAO_ATIVA_MINIMA,
      });
      const aceita = respostas.find((r) => r.status === 200);
      expect(aceita.body.status, contexto).toBe('DESATIVADO');
      expect(await contarGestoesAtivas(), contexto).toBe(2);
    }
  });
});
