import { useState } from 'react';
import { atualizarTurma } from '../services/turmas.js';
import {
  converterAnoLetivo,
  descreverTurma,
  ehTurmaDuplicada,
  limparTexto,
  listaPodeEstarDesatualizada,
  mensagemErroTurma,
  mensagemTurmaDuplicada,
  validarTurma,
} from '../services/mensagensTurmas.js';
import CamposTurma, { CAMPOS_TURMA } from './CamposTurma.jsx';
import Dialogo from './Dialogo.jsx';
import { useCamposFormulario } from './useCamposFormulario.js';

const ID_CONFLITO = 'edicao-turma-conflito';
const MENSAGEM_SEM_ALTERACAO =
  'Nenhum dado foi alterado. Altere algum campo ou clique em "Cancelar".';

/**
 * Diálogo "Editar turma" (RF15, RN18): nome, etapa e ano letivo,
 * pré-preenchidos. Envia ao PUT /turmas/{id} os três campos (obrigatórios no
 * contrato), com o ano letivo como número. Não há exclusão de turma (RN21).
 *
 * @param {object} props
 * @param {{ id: number, nome: string, etapa: string, anoLetivo: number }} props.turma
 * @param {(atualizada: object) => void} props.aoSalvar
 * @param {() => void} props.aoCancelar
 * @param {() => void} [props.aoRestaurarFoco]
 * @param {() => void} [props.aoListaDesatualizada] - chamado após 404 ou 409 de alteração simultânea
 */
export default function FormularioEdicaoTurma({
  turma,
  aoSalvar,
  aoCancelar,
  aoRestaurarFoco,
  aoListaDesatualizada,
}) {
  const [erro, setErro] = useState('');
  const [conflito, setConflito] = useState('');
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
      nome: turma.nome ?? '',
      etapa: turma.etapa ?? '',
      anoLetivo: turma.anoLetivo == null ? '' : String(turma.anoLetivo),
    },
    CAMPOS_TURMA,
    {
      aoAlterarCampo: () => {
        // Turma repetida envolve os três campos: alterar qualquer um limpa o aviso.
        setConflito('');
      },
    },
  );

  function cancelar() {
    if (enviandoRef.current) return;
    aoCancelar();
  }

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
    if (nome === turma.nome && etapa === turma.etapa && anoLetivo === turma.anoLetivo) {
      setErro(MENSAGEM_SEM_ALTERACAO);
      return;
    }

    enviandoRef.current = true;
    setEnviando(true);
    try {
      const atualizada = await atualizarTurma(turma.id, { nome, etapa, anoLetivo });
      aoSalvar(atualizada ?? { ...turma, nome, etapa, anoLetivo });
    } catch (falha) {
      enviandoRef.current = false;
      setEnviando(false);
      if (falha?.status === 401) return; // tratamento central: volta ao login com aviso
      if (listaPodeEstarDesatualizada(falha)) aoListaDesatualizada?.();
      if (ehTurmaDuplicada(falha)) {
        setConflito(mensagemTurmaDuplicada(falha));
        refs.nome.current?.focus();
      } else {
        setErro(mensagemErroTurma(falha, 'editar'));
      }
    }
  }

  return (
    <Dialogo
      id="dialogo-editar-turma"
      titulo="Editar turma"
      descricaoId="dialogo-editar-turma-descricao"
      aoFechar={cancelar}
      focoInicialRef={refs.nome}
      aoRestaurarFoco={aoRestaurarFoco}
    >
      <p id="dialogo-editar-turma-descricao" className="texto-secundario">
        Altere os dados da turma {descreverTurma(turma)} e clique em &quot;Salvar alterações&quot;.
      </p>

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
        aria-labelledby="dialogo-editar-turma-titulo"
      >
        <CamposTurma
          prefixo="edicao-turma"
          dados={dados}
          erros={errosCampos}
          aoAlterar={alterar}
          refs={refs}
          idConflito={conflito ? ID_CONFLITO : undefined}
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
