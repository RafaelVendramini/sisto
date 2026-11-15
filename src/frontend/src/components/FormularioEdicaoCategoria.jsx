import { useRef, useState } from 'react';
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
  const [dados, setDados] = useState({
    nome: categoria.nome ?? '',
    descricao: categoria.descricao ?? '',
  });
  const [errosCampos, setErrosCampos] = useState({});
  const [erro, setErro] = useState('');
  const [enviando, setEnviando] = useState(false);
  const enviandoRef = useRef(false);

  const refs = { nome: useRef(null), descricao: useRef(null) };

  function alterar(campo) {
    return (evento) => {
      if (enviandoRef.current) return; // campos travados durante o envio
      const { value } = evento.target;
      setDados((atual) => ({ ...atual, [campo]: value }));
      // Ao corrigir o campo, a mensagem de erro dele (e o aria-invalid) some.
      setErrosCampos((atual) => {
        if (!atual[campo]) return atual;
        const { [campo]: _removido, ...restantes } = atual;
        return restantes;
      });
    };
  }

  function focarPrimeiroInvalido(erros) {
    const campo = ORDEM_CAMPOS.find((nome) => erros[nome]);
    if (campo) refs[campo].current?.focus();
  }

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
