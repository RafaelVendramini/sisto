import { useState } from 'react';
import { criarTurma } from '../services/turmas.js';
import {
  anoAtual,
  converterAnoLetivo,
  ehTurmaDuplicada,
  limparTexto,
  mensagemErroTurma,
  mensagemTurmaDuplicada,
  validarTurma,
} from '../services/mensagensTurmas.js';
import CamposTurma, { CAMPOS_TURMA } from './CamposTurma.jsx';
import { useCamposFormulario } from './useCamposFormulario.js';

const ID_CONFLITO = 'turma-conflito';

function vazio() {
  return { nome: '', etapa: '', anoLetivo: String(anoAtual()) };
}

/**
 * Formulário "Cadastrar turma" (RF15, RN18). O ano letivo vem sugerido com o
 * ano atual. Envia POST /turmas (anoLetivo como número) e avisa a página pelo
 * `aoCadastrar` com a turma criada; a confirmação aparece junto da lista.
 */
export default function FormularioTurma({ aoCadastrar }) {
  const [erro, setErro] = useState('');
  const [conflito, setConflito] = useState('');
  const [enviando, setEnviando] = useState(false);

  const {
    dados,
    setDados,
    errosCampos,
    setErrosCampos,
    enviandoRef,
    refs,
    alterar,
    focarPrimeiroInvalido,
  } = useCamposFormulario(
    vazio,
    CAMPOS_TURMA,
    {
      aoAlterarCampo: () => {
        // Turma repetida envolve os três campos: alterar qualquer um limpa o aviso.
        setConflito('');
      },
    },
  );

  async function aoEnviar(evento) {
    evento.preventDefault();
    if (enviandoRef.current) return;

    setErro('');
    setConflito('');
    const novosErros = validarTurma(dados);
    setErrosCampos(novosErros);
    if (Object.keys(novosErros).length > 0) {
      focarPrimeiroInvalido(novosErros);
      return;
    }

    const nome = limparTexto(dados.nome);
    const etapa = limparTexto(dados.etapa);
    const anoLetivo = converterAnoLetivo(dados.anoLetivo);

    enviandoRef.current = true;
    setEnviando(true);
    try {
      const criada = await criarTurma({ nome, etapa, anoLetivo });
      setDados(vazio());
      aoCadastrar?.(criada ?? { nome, etapa, anoLetivo });
      refs.nome.current?.focus();
    } catch (falha) {
      if (falha?.status === 401) return; // tratamento central: volta ao login com aviso
      if (ehTurmaDuplicada(falha)) {
        setConflito(mensagemTurmaDuplicada(falha));
        refs.nome.current?.focus();
      } else {
        setErro(mensagemErroTurma(falha, 'criar'));
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
      {conflito && (
        <p id={ID_CONFLITO} className="mensagem mensagem--erro" role="alert">
          {conflito}
        </p>
      )}

      <form
        className="formulario"
        onSubmit={aoEnviar}
        noValidate
        aria-busy={enviando}
        aria-labelledby="titulo-cadastrar-turma"
      >
        <CamposTurma
          prefixo="turma"
          dados={dados}
          erros={errosCampos}
          aoAlterar={alterar}
          refs={refs}
          idConflito={conflito ? ID_CONFLITO : undefined}
          somenteLeitura={enviando}
        />

        <button type="submit" className="botao botao--primario" aria-disabled={enviando}>
          {enviando ? 'Cadastrando...' : 'Cadastrar turma'}
        </button>
      </form>
    </>
  );
}
