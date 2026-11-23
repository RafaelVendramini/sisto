import { useMemo, useState } from 'react';
import { atualizarEstudante } from '../services/estudantes.js';
import {
  codigoParaEnvio,
  ehCodigoDuplicado,
  idParaEnvio,
  limparTexto,
  listaPodeEstarDesatualizada,
  mensagemCodigoDuplicado,
  mensagemErroEstudante,
  validarEstudante,
} from '../services/mensagensEstudantes.js';
import CamposEstudante, { CAMPOS_ESTUDANTE } from './CamposEstudante.jsx';
import Dialogo from './Dialogo.jsx';
import { useCamposFormulario } from './useCamposFormulario.js';

const ID_CONFLITO = 'edicao-estudante-conflito';
const MENSAGEM_SEM_ALTERACAO =
  'Nenhum dado foi alterado. Altere algum campo ou clique em "Cancelar".';

/**
 * Diálogo "Editar estudante" (RF15, RF16, RN13, RN14, RN18): nome completo,
 * código escolar, turma e tutor, pré-preenchidos.
 *
 * O PUT /estudantes/{id} MANTÉM o código escolar e o tutor quando eles são
 * omitidos; por isso o diálogo envia sempre os quatro campos, com
 * `codigoEscolar: null` para limpar o código e `tutorId: null` para "Sem tutor".
 *
 * RN13: se o tutor atual estiver bloqueado ou desativado, ele não está entre
 * os tutores ativos, mas continua como opção selecionada e sinalizada (ex.:
 * "Nome (bloqueado)"). Assim, salvar outros campos não desvincula o tutor sem
 * querer (a API aceita reenviar o mesmo tutor). Trocar só é possível para
 * tutores ativos.
 *
 * @param {object} props
 * @param {object} props.estudante - item da lista (formato do GET /estudantes da Gestão)
 * @param {Array<object>} props.turmas - de GET /turmas
 * @param {Array<object>} props.tutores - só tutores ativos
 * @param {(atualizado: object) => void} props.aoSalvar
 * @param {() => void} props.aoCancelar
 * @param {() => void} [props.aoRestaurarFoco]
 * @param {() => void} [props.aoListaDesatualizada] - chamado após 404 ou 409 de alteração simultânea
 */
export default function FormularioEdicaoEstudante({
  estudante,
  turmas,
  tutores,
  aoSalvar,
  aoCancelar,
  aoRestaurarFoco,
  aoListaDesatualizada,
}) {
  const original = useMemo(
    () => ({
      nomeCompleto: estudante.nomeCompleto ?? '',
      codigoEscolar: estudante.codigoEscolar ?? null,
      turmaId: estudante.turma?.id ?? null,
      tutorId: estudante.tutor?.id ?? null,
    }),
    [estudante],
  );

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
      nomeCompleto: original.nomeCompleto,
      codigoEscolar: original.codigoEscolar ?? '',
      turmaId: original.turmaId == null ? '' : String(original.turmaId),
      tutorId: original.tutorId == null ? '' : String(original.tutorId),
    },
    CAMPOS_ESTUDANTE,
    {
      aoAlterarCampo: (campo) => {
        if (campo === 'codigoEscolar') setConflito('');
      },
    },
  );

  // Turma atual sempre presente entre as opções (mesmo se a lista de turmas
  // estiver desatualizada). Se for de um ano anterior, continua na lista com o
  // filtro padrão por ano letivo (decisão do Rafael, 23/11/2026 — Issue #134).
  const opcoesTurma = useMemo(() => {
    const atual = estudante.turma;
    if (!atual || turmas.some((t) => t.id === atual.id)) return turmas;
    return [atual, ...turmas];
  }, [estudante.turma, turmas]);

  // Tutores ativos + o tutor atual, quando ele não está entre os ativos
  // (bloqueado/desativado — RN13), para continuar selecionado e sinalizado.
  const opcoesTutor = useMemo(() => {
    const atual = estudante.tutor;
    if (!atual || tutores.some((t) => t.id === atual.id)) return tutores;
    return [atual, ...tutores];
  }, [estudante.tutor, tutores]);

  function cancelar() {
    if (enviandoRef.current) return;
    aoCancelar();
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
    if (
      envio.nomeCompleto === original.nomeCompleto &&
      envio.codigoEscolar === original.codigoEscolar &&
      envio.turmaId === original.turmaId &&
      envio.tutorId === original.tutorId
    ) {
      setErro(MENSAGEM_SEM_ALTERACAO);
      return;
    }

    enviandoRef.current = true;
    setEnviando(true);
    try {
      const atualizado = await atualizarEstudante(estudante.id, envio);
      aoSalvar(atualizado ?? null);
    } catch (falha) {
      enviandoRef.current = false;
      setEnviando(false);
      if (falha?.status === 401) return; // tratamento central: volta ao login com aviso
      if (listaPodeEstarDesatualizada(falha)) aoListaDesatualizada?.();
      if (ehCodigoDuplicado(falha)) {
        setConflito(mensagemCodigoDuplicado(falha));
        refs.codigoEscolar.current?.focus();
      } else {
        setErro(mensagemErroEstudante(falha, 'editar'));
      }
    }
  }

  return (
    <Dialogo
      id="dialogo-editar-estudante"
      titulo="Editar estudante"
      descricaoId="dialogo-editar-estudante-descricao"
      aoFechar={cancelar}
      focoInicialRef={refs.nomeCompleto}
      aoRestaurarFoco={aoRestaurarFoco}
    >
      <p id="dialogo-editar-estudante-descricao" className="texto-secundario">
        Altere os dados de {estudante.nomeCompleto} e clique em &quot;Salvar alterações&quot;.
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
        aria-labelledby="dialogo-editar-estudante-titulo"
      >
        <CamposEstudante
          prefixo="edicao-estudante"
          dados={dados}
          erros={errosCampos}
          aoAlterar={alterar}
          refs={refs}
          turmas={opcoesTurma}
          idsTurmasMantidas={original.turmaId == null ? [] : [original.turmaId]}
          tutores={opcoesTutor}
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
