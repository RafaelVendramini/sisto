import { useRef, useState } from 'react';
import {
  PERGUNTA_ENCERRAMENTO,
  atualizacaoOcorrenciaPedeAtualizacao,
  mensagemErroEncerramento,
} from '../services/mensagensOcorrencias.js';
import { encerrarOcorrencia } from '../services/ocorrencias.js';
import Dialogo from './Dialogo.jsx';
import { exibirFalha, useCarregamento } from './useCarregamento.js';

const ID_DIALOGO = 'dialogo-encerramento';

/**
 * Confirmação antes de encerrar a ocorrência (UC04, RF10, RN04, RN22, RNF02).
 * Encerrar é irreversível (não há reabertura) e não pede justificativa. Só
 * chama o PATCH /ocorrencias/{id}/status depois da confirmação. O foco
 * começa em "Cancelar", para evitar encerrar sem querer.
 * - Sucesso: devolve ao detalhe a resposta 200 (detalhe completo, já encerrado).
 *
 * @param {object} props
 * @param {object} props.ocorrencia - detalhe atual (id)
 * @param {(detalhe: object | null) => void} props.aoConcluir
 * @param {() => void} props.aoCancelar
 * @param {() => void} props.aoAtualizarOcorrencia - recarregar o detalhe (após 404/409)
 * @param {() => void} [props.aoRestaurarFoco]
 */
export default function EncerrarOcorrencia({
  ocorrencia,
  aoConcluir,
  aoCancelar,
  aoAtualizarOcorrencia,
  aoRestaurarFoco,
}) {
  const [erro, setErro] = useState('');
  const [pedeAtualizacao, setPedeAtualizacao] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const enviandoRef = useRef(false);
  const { montado } = useCarregamento();
  const cancelarRef = useRef(null);

  function cancelar() {
    if (enviandoRef.current) return;
    aoCancelar();
  }

  function atualizarOcorrencia() {
    if (enviandoRef.current) return;
    aoAtualizarOcorrencia();
  }

  async function confirmar() {
    if (enviandoRef.current) return;
    enviandoRef.current = true;
    setErro('');
    setPedeAtualizacao(false);
    setEnviando(true);
    try {
      const detalhe = await encerrarOcorrencia(ocorrencia.id);
      if (montado.current) aoConcluir(detalhe ?? null);
    } catch (falha) {
      enviandoRef.current = false;
      if (!montado.current) return;
      setEnviando(false);
      if (!exibirFalha(falha)) return; // tratamento central: volta ao login com aviso
      setErro(mensagemErroEncerramento(falha));
      setPedeAtualizacao(atualizacaoOcorrenciaPedeAtualizacao(falha));
    }
  }

  return (
    <Dialogo
      id={ID_DIALOGO}
      papel="alertdialog"
      titulo="Encerrar ocorrência"
      descricaoId={`${ID_DIALOGO}-descricao`}
      aoFechar={cancelar}
      focoInicialRef={cancelarRef}
      aoRestaurarFoco={aoRestaurarFoco}
    >
      <div id={`${ID_DIALOGO}-descricao`}>
        <p className="dialogo__pergunta">{PERGUNTA_ENCERRAMENTO}</p>
        <p className="mensagem mensagem--aviso">
          Não é possível reabrir uma ocorrência encerrada.
        </p>
      </div>

      {erro && (
        <div className="mensagem mensagem--erro" role="alert">
          <p>{erro}</p>
          {pedeAtualizacao && (
            <button type="button" className="botao botao--secundario" onClick={atualizarOcorrencia}>
              Atualizar a ocorrência
            </button>
          )}
        </div>
      )}

      <div className="dialogo__acoes" aria-busy={enviando}>
        <button
          type="button"
          className="botao botao--perigo"
          onClick={confirmar}
          aria-disabled={enviando}
        >
          {enviando ? 'Encerrando...' : 'Encerrar ocorrência'}
        </button>
        <button
          ref={cancelarRef}
          type="button"
          className="botao botao--secundario"
          onClick={cancelar}
          aria-disabled={enviando}
        >
          Cancelar
        </button>
      </div>
    </Dialogo>
  );
}
