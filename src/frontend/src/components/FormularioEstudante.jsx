import { useRef, useState } from 'react';
import { criarEstudante } from '../services/estudantes.js';
import {
  codigoParaEnvio,
  ehCodigoDuplicado,
  idParaEnvio,
  limparTexto,
  mensagemCodigoDuplicado,
  mensagemErroEstudante,
  validarEstudante,
} from '../services/mensagensEstudantes.js';
import CamposEstudante, { CAMPOS_ESTUDANTE } from './CamposEstudante.jsx';

const ID_CONFLITO = 'estudante-conflito';

function vazio() {
  return { nomeCompleto: '', codigoEscolar: '', turmaId: '', tutorId: '' };
}

/**
 * Formulário "Cadastrar estudante" (RF15, RF16, RN13, RN18). Envia
 * POST /estudantes com turmaId e tutorId como número (ou tutorId null para
 * "Sem tutor") e codigoEscolar null quando vazio. Avisa a página pelo
 * `aoCadastrar` com o estudante criado; a confirmação aparece junto da lista.
 *
 * @param {object} props
 * @param {Array<object>} props.turmas - de GET /turmas
 * @param {Array<object>} props.tutores - só tutores ativos (RN13)
 * @param {(criado: object | null) => void} props.aoCadastrar
 */
export default function FormularioEstudante({ turmas, tutores, aoCadastrar }) {
  const [dados, setDados] = useState(vazio);
  const [errosCampos, setErrosCampos] = useState({});
  const [erro, setErro] = useState('');
  const [conflito, setConflito] = useState('');
  const [enviando, setEnviando] = useState(false);
  // Trava síncrona contra duplo envio (o estado só muda no próximo render).
  const enviandoRef = useRef(false);

  const refs = {
    nomeCompleto: useRef(null),
    codigoEscolar: useRef(null),
    turmaId: useRef(null),
    tutorId: useRef(null),
  };

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
      // O código repetido (409) só depende do código escolar.
      if (campo === 'codigoEscolar') setConflito('');
    };
  }

  function focarPrimeiroInvalido(erros) {
    const campo = CAMPOS_ESTUDANTE.find((nome) => erros[nome]);
    if (campo) refs[campo].current?.focus();
  }

  async function aoEnviar(evento) {
    evento.preventDefault();
    if (enviandoRef.current) return;

    setErro('');
    setConflito('');
    const novosErros = validarEstudante(dados);
    setErrosCampos(novosErros);
    if (Object.keys(novosErros).length > 0) {
      focarPrimeiroInvalido(novosErros);
      return;
    }

    const envio = {
      nomeCompleto: limparTexto(dados.nomeCompleto),
      codigoEscolar: codigoParaEnvio(dados.codigoEscolar),
      turmaId: idParaEnvio(dados.turmaId),
      tutorId: idParaEnvio(dados.tutorId),
    };

    enviandoRef.current = true;
    setEnviando(true);
    try {
      const criado = await criarEstudante(envio);
      setDados(vazio());
      aoCadastrar?.(criado ?? null, envio);
      refs.nomeCompleto.current?.focus();
    } catch (falha) {
      if (falha?.status === 401) return; // tratamento central: volta ao login com aviso
      if (ehCodigoDuplicado(falha)) {
        setConflito(mensagemCodigoDuplicado(falha));
        refs.codigoEscolar.current?.focus();
      } else {
        setErro(mensagemErroEstudante(falha, 'criar'));
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
        aria-labelledby="titulo-cadastrar-estudante"
      >
        <CamposEstudante
          prefixo="estudante"
          dados={dados}
          erros={errosCampos}
          aoAlterar={alterar}
          refs={refs}
          turmas={turmas}
          tutores={tutores}
          idConflito={conflito ? ID_CONFLITO : undefined}
          somenteLeitura={enviando}
        />

        <button type="submit" className="botao botao--primario" aria-disabled={enviando}>
          {enviando ? 'Cadastrando...' : 'Cadastrar estudante'}
        </button>
      </form>
    </>
  );
}
