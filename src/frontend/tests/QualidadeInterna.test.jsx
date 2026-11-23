// Issue #129 — qualidade interna do front-end: código repetido reunido em
// hooks e funções únicas, mensagensOcorrencias.js dividido em arquivos menores
// (com as exportações antigas mantidas) e o fetch real bloqueado nos testes.
// Sem rede e sem depender da data real. Somente dados fictícios (RN05 / LGPD).
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, cleanup, render, renderHook, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useCamposFormulario } from '../src/components/useCamposFormulario.js';
import { exibirFalha, useCarregamento } from '../src/components/useCarregamento.js';
import * as dataHora from '../src/services/dataHora.js';
import {
  MENSAGEM_SEM_CONEXAO,
  MENSAGEM_SEM_PERMISSAO,
  mensagemErroCarga,
} from '../src/services/mensagens.js';
import * as mensagensOcorrencias from '../src/services/mensagensOcorrencias.js';
import * as rotulosOcorrencia from '../src/services/rotulosOcorrencia.js';
import * as validacoesOcorrencia from '../src/services/validacoesOcorrencia.js';

afterEach(() => {
  cleanup();
});

describe('fetch real bloqueado nos testes (tests/setup.js)', () => {
  it('sem simulação, chamar o fetch lança um erro claro', () => {
    expect(() => fetch('http://api.exemplo.test/qualquer')).toThrow(
      'fetch real bloqueado nos testes',
    );
    // A chamada foi anotada para o afterEach do setup falhar o teste; aqui ela
    // é intencional, então é descartada (e a anotação é conferida).
    expect(globalThis.descartarChamadasFetchBloqueadas()).toEqual(['http://api.exemplo.test/qualquer']);
  });
});

describe('mensagemErroCarga (services/mensagens.js)', () => {
  const GENERICA = 'Não foi possível carregar a lista fictícia agora.';

  it('403 -> sem permissão; status 0 -> sem conexão; demais -> texto da tela', () => {
    expect(mensagemErroCarga({ status: 403 }, GENERICA)).toBe(MENSAGEM_SEM_PERMISSAO);
    expect(mensagemErroCarga({ status: 0 }, GENERICA)).toBe(MENSAGEM_SEM_CONEXAO);
    expect(mensagemErroCarga({ status: 500 }, GENERICA)).toBe(GENERICA);
    expect(mensagemErroCarga(undefined, GENERICA)).toBe(GENERICA);
  });
});

describe('useCarregamento', () => {
  it('exibirFalha: o 401 fica com o tratamento central; as demais aparecem', () => {
    expect(exibirFalha({ status: 401 })).toBe(false);
    expect(exibirFalha({ status: 403 })).toBe(true);
    expect(exibirFalha({ status: 0 })).toBe(true);
    expect(exibirFalha(undefined)).toBe(true);
  });

  it('montado fica false ao desmontar; novaRequisicao só vale para a busca mais recente', () => {
    const { result, unmount } = renderHook(() => useCarregamento());
    expect(result.current.montado.current).toBe(true);

    const primeira = result.current.novaRequisicao();
    expect(primeira()).toBe(true);
    const segunda = result.current.novaRequisicao();
    expect(primeira()).toBe(false);
    expect(segunda()).toBe(true);

    unmount();
    expect(result.current.montado.current).toBe(false);
    expect(segunda()).toBe(false);
  });
});

describe('useCamposFormulario', () => {
  function Formulario({ aoAlterarCampo, erros = {} }) {
    const { dados, errosCampos, setErrosCampos, enviandoRef, refs, alterar, focarPrimeiroInvalido } =
      useCamposFormulario({ nome: '', etapa: '' }, ['nome', 'etapa'], { aoAlterarCampo });
    return (
      <form>
        <label htmlFor="teste-nome">Nome</label>
        <input id="teste-nome" ref={refs.nome} value={dados.nome} onChange={alterar('nome')} />
        <label htmlFor="teste-etapa">Etapa</label>
        <input id="teste-etapa" ref={refs.etapa} value={dados.etapa} onChange={alterar('etapa')} />
        <p data-testid="erros">{JSON.stringify(errosCampos)}</p>
        <button
          type="button"
          onClick={() => {
            setErrosCampos(erros);
            focarPrimeiroInvalido(erros);
          }}
        >
          Validar
        </button>
        <button type="button" onClick={() => (enviandoRef.current = true)}>
          Travar
        </button>
      </form>
    );
  }

  it('foca o primeiro campo inválido na ordem da tela', async () => {
    const usuario = userEvent.setup();
    render(<Formulario erros={{ etapa: 'Informe a etapa.', nome: 'Informe o nome.' }} />);
    await usuario.click(screen.getByRole('button', { name: 'Validar' }));
    expect(screen.getByLabelText('Nome')).toHaveFocus();
  });

  it('alterar atualiza o valor, apaga o erro só daquele campo e avisa aoAlterarCampo', async () => {
    const usuario = userEvent.setup();
    const aoAlterarCampo = vi.fn();
    render(
      <Formulario
        aoAlterarCampo={aoAlterarCampo}
        erros={{ nome: 'Informe o nome.', etapa: 'Informe a etapa.' }}
      />,
    );
    await usuario.click(screen.getByRole('button', { name: 'Validar' }));

    await usuario.type(screen.getByLabelText('Etapa'), 'X');
    expect(screen.getByLabelText('Etapa')).toHaveValue('X');
    expect(JSON.parse(screen.getByTestId('erros').textContent)).toEqual({ nome: 'Informe o nome.' });
    expect(aoAlterarCampo).toHaveBeenCalledWith('etapa');
  });

  it('durante o envio (enviandoRef), os campos não mudam', async () => {
    const usuario = userEvent.setup();
    const aoAlterarCampo = vi.fn();
    render(<Formulario aoAlterarCampo={aoAlterarCampo} />);
    await usuario.click(screen.getByRole('button', { name: 'Travar' }));
    await act(async () => {
      await usuario.type(screen.getByLabelText('Nome'), 'Y');
    });
    expect(screen.getByLabelText('Nome')).toHaveValue('');
    expect(aoAlterarCampo).not.toHaveBeenCalled();
  });
});

describe('mensagensOcorrencias.js dividido (dataHora, validações e rótulos)', () => {
  it('continua reexportando tudo dos novos arquivos, com as mesmas funções', () => {
    for (const modulo of [dataHora, rotulosOcorrencia, validacoesOcorrencia]) {
      for (const [nome, valor] of Object.entries(modulo)) {
        expect(mensagensOcorrencias[nome], nome).toBe(valor);
      }
    }
  });

  it('textoOuNaoInformado: vazio ou só espaços vira "Não informado"', () => {
    const { textoOuNaoInformado, TEXTO_NAO_INFORMADO } = rotulosOcorrencia;
    expect(textoOuNaoInformado('Pátio fictício')).toBe('Pátio fictício');
    expect(textoOuNaoInformado('   ')).toBe(TEXTO_NAO_INFORMADO);
    expect(textoOuNaoInformado(null)).toBe(TEXTO_NAO_INFORMADO);
    expect(textoOuNaoInformado(undefined)).toBe(TEXTO_NAO_INFORMADO);
  });
});
