// Garante a ordem das camadas do sub-roteador `protegidas` (Issue #18, RN10):
// exigirAutenticacao -> /conta -> bloquearComTrocaDeSenhaPendente -> demais
// rotas. Uma rota montada antes do bloqueio ficaria acessível com a troca de
// senha pendente. Não depende do banco nem de dados.
import { describe, it, expect } from 'vitest';

const { protegidas } = await import('../src/routes/index.js');
const { default: rotasConta } = await import('../src/routes/conta.js');
const { exigirAutenticacao, bloquearComTrocaDeSenhaPendente } = await import(
  '../src/middlewares/autenticacao.js'
);

describe('Ordem das camadas em protegidas (RN10)', () => {
  const camadas = protegidas.stack.map((camada) => camada.handle);
  const posicaoBloqueio = camadas.indexOf(bloquearComTrocaDeSenhaPendente);

  it('o bloqueio de troca de senha pendente está montado (uma única vez)', () => {
    expect(posicaoBloqueio).toBeGreaterThan(-1);
    expect(camadas.filter((h) => h === bloquearComTrocaDeSenhaPendente)).toHaveLength(1);
  });

  it('antes do bloqueio só existem a autenticação e as rotas de /conta, nessa ordem', () => {
    expect(camadas.slice(0, posicaoBloqueio)).toEqual([exigirAutenticacao, rotasConta]);
  });

  it('/conta só tem PUT /senha (nenhuma outra rota escapa do bloqueio)', () => {
    const rotas = rotasConta.stack.map((camada) => ({
      caminho: camada.route?.path,
      metodos: Object.keys(camada.route?.methods ?? {}),
    }));
    expect(rotas).toEqual([{ caminho: '/senha', metodos: ['put'] }]);
  });

  it('as rotas de negócio ficam depois do bloqueio', () => {
    expect(camadas.length).toBeGreaterThan(posicaoBloqueio + 1);
  });
});
