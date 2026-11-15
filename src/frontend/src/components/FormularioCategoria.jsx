import { useRef, useState } from 'react';
import { criarCategoria } from '../services/categorias.js';
import {
  ehConflitoDeNome,
  limparTexto,
  mensagemErroCategoria,
  mensagemNomeDuplicado,
  validarCategoria,
} from '../services/mensagensCategorias.js';
import CamposCategoria from './CamposCategoria.jsx';

const VAZIO = { nome: '', descricao: '' };
const ORDEM_CAMPOS = ['nome', 'descricao'];

/**
 * Formulário "Cadastrar categoria" (RF07, RN18). Envia POST /categorias e
 * avisa a página pelo `aoCadastrar` com a categoria criada; a confirmação
 * aparece na página, junto da lista.
 */
export default function FormularioCategoria({ aoCadastrar }) {
  const [dados, setDados] = useState(VAZIO);
  const [errosCampos, setErrosCampos] = useState({});
  const [erro, setErro] = useState('');
  const [enviando, setEnviando] = useState(false);
  // Trava síncrona contra duplo envio (o estado só muda no próximo render).
  const enviandoRef = useRef(false);

  const refs = { nome: useRef(null), descricao: useRef(null) };

  function alterar(campo) {
    return (evento) => {
      if (enviandoRef.current) return;
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

    enviandoRef.current = true;
    setEnviando(true);
    try {
      const criada = await criarCategoria({ nome, descricao: descricao || undefined });
      setDados(VAZIO);
      aoCadastrar?.(criada ?? { nome, descricao: descricao || null });
      refs.nome.current?.focus();
    } catch (falha) {
      if (falha?.status === 401) return; // tratamento central: volta ao login com aviso
      if (ehConflitoDeNome(falha)) {
        const errosApi = { nome: mensagemNomeDuplicado(falha) };
        setErrosCampos(errosApi);
        focarPrimeiroInvalido(errosApi);
      } else {
        setErro(mensagemErroCategoria(falha, 'criar'));
      }
    } finally {
      enviandoRef.current = false;
      setEnviando(false);
    }
  }

  return (
    <>
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
        aria-labelledby="titulo-cadastrar-categoria"
      >
        <CamposCategoria
          prefixo="categoria"
          dados={dados}
          erros={errosCampos}
          aoAlterar={alterar}
          refs={refs}
          somenteLeitura={enviando}
        />

        <button type="submit" className="botao botao--primario" aria-disabled={enviando}>
          {enviando ? 'Cadastrando...' : 'Cadastrar categoria'}
        </button>
      </form>
    </>
  );
}
