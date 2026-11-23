import { useState } from 'react';
import { atualizarCategoria } from '../services/categorias.js';
import {
  ehConflitoDeNome,
  limparTexto,
  listaPodeEstarDesatualizada,
  mensagemErroCategoria,
  mensagemNomeDuplicado,
  validarCategoria,
} from '../services/mensagensCategorias.js';
import CamposCategoria from './CamposCategoria.jsx';
import Dialogo from './Dialogo.jsx';
import { useCamposFormulario } from './useCamposFormulario.js';

const ORDEM_CAMPOS = ['nome', 'descricao'];
const MENSAGEM_SEM_ALTERACAO =
  'Nenhum dado foi alterado. Altere algum campo ou clique em "Cancelar".';

/**
 * Diálogo "Editar categoria" (RF07, RN18): nome e descrição, pré-preenchidos.
 * Envia ao PUT /categorias/{id} o nome e a descrição; descrição apagada
 * remove a descrição da categoria. Não há exclusão de categoria (RN21).
 *
 * @param {object} props
 * @param {{ id: number, nome: string, descricao: string | null }} props.categoria
 * @param {(atualizada: object) => void} props.aoSalvar
 * @param {() => void} props.aoCancelar
 * @param {() => void} [props.aoRestaurarFoco]
 * @param {() => void} [props.aoListaDesatualizada] - chamado após 404 ou 409 de alteração simultânea
 */
export default function FormularioEdicaoCategoria({
  categoria,
  aoSalvar,
  aoCancelar,
  aoRestaurarFoco,
  aoListaDesatualizada,
}) {
  const [erro, setErro] = useState('');
  const [enviando, setEnviando] = useState(false);

  const {
    dados,
    errosCampos,
    setErrosCampos,
    enviandoRef,
    refs,
    alterar,
    focarPrimeiroInvalido,
  } = useCamposFormulario(
    {
      nome: categoria.nome ?? '',
      descricao: categoria.descricao ?? '',
    },
    ORDEM_CAMPOS,
  );

  function cancelar() {
    if (enviandoRef.current) return;
    aoCancelar();
  }

  async function aoEnviar(evento) {
    evento.preventDefault();
    if (enviandoRef.current) return;

    setErro('');
    const novosErros = validarCategoria(dados);
    setErrosCampos(novosErros);
    if (Object.keys(novosErros).length > 0) {
      focarPrimeiroInvalido(novosErros);
      return;
    }

    const nome = limparTexto(dados.nome);
    const descricao = limparTexto(dados.descricao);
    if (nome === categoria.nome && descricao === (categoria.descricao ?? '')) {
      setErro(MENSAGEM_SEM_ALTERACAO);
      return;
    }

    enviandoRef.current = true;
    setEnviando(true);
    try {
      const atualizada = await atualizarCategoria(categoria.id, { nome, descricao });
      aoSalvar(atualizada ?? { ...categoria, nome, descricao: descricao || null });
    } catch (falha) {
      enviandoRef.current = false;
      setEnviando(false);
      if (falha?.status === 401) return; // tratamento central: volta ao login com aviso
      if (listaPodeEstarDesatualizada(falha)) aoListaDesatualizada?.();
      if (ehConflitoDeNome(falha)) {
        const errosApi = { nome: mensagemNomeDuplicado(falha) };
        setErrosCampos(errosApi);
        focarPrimeiroInvalido(errosApi);
      } else {
        setErro(mensagemErroCategoria(falha, 'editar'));
      }
    }
  }

  return (
    <Dialogo
      id="dialogo-editar-categoria"
      titulo="Editar categoria"
      descricaoId="dialogo-editar-categoria-descricao"
      aoFechar={cancelar}
      focoInicialRef={refs.nome}
      aoRestaurarFoco={aoRestaurarFoco}
    >
      <p id="dialogo-editar-categoria-descricao" className="texto-secundario">
        Altere os dados da categoria {categoria.nome} e clique em &quot;Salvar alterações&quot;.
      </p>

      {erro && (
        <p className="mensagem mensagem--erro" role="alert">
          {erro}
        </p>
      )}

      <form
        className="formulario"
        onSubmit={aoEnviar}
        noValidate
        aria-busy={enviando}
        aria-labelledby="dialogo-editar-categoria-titulo"
      >
        <CamposCategoria
          prefixo="edicao-categoria"
          dados={dados}
          erros={errosCampos}
          aoAlterar={alterar}
          refs={refs}
          somenteLeitura={enviando}
        />

        <div className="dialogo__acoes">
          <button type="submit" className="botao botao--primario" aria-disabled={enviando}>
            {enviando ? 'Salvando...' : 'Salvar alterações'}
          </button>
          <button
            type="button"
            className="botao botao--secundario"
            onClick={cancelar}
            aria-disabled={enviando}
          >
            Cancelar
          </button>
        </div>
      </form>
    </Dialogo>
  );
}
