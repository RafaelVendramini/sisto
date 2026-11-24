import { useEffect, useRef } from 'react';

/**
 * Confirmação antes de trocar o tipo de destinatário quando a troca apaga a
 * justificativa ou a observação já digitada (RN24 — Issue #154): ao sair do
 * Psicólogo escolar ou ao entrar nele. Usada no registro da ocorrência e no
 * diálogo "Encaminhar", logo abaixo do seletor "Encaminhar para".
 *
 * Segue o padrão da confirmação de descarte dos diálogos (#128): pergunta num
 * `group` rotulado, foco inicial na opção que não apaga nada e Esc também
 * cancela (sem fechar o diálogo em volta).
 *
 * @param {object} props
 * @param {string} props.id - prefixo dos ids internos
 * @param {string} props.pergunta - ex.: 'A justificativa digitada será apagada. Deseja continuar?'
 * @param {() => void} props.aoConfirmar - troca o tipo e apaga o texto
 * @param {() => void} props.aoCancelar - mantém o tipo e o texto como estavam
 */
export default function ConfirmarTrocaDestinatario({ id, pergunta, aoConfirmar, aoCancelar }) {
  const refCancelar = useRef(null);
  const idPergunta = `${id}-pergunta`;

  useEffect(() => {
    refCancelar.current?.focus();
  }, []);

  function aoTeclar(evento) {
    if (evento.key !== 'Escape') return;
    evento.preventDefault();
    evento.stopPropagation();
    aoCancelar();
  }

  return (
    <div
      className="mensagem mensagem--aviso confirmar-troca-destinatario"
      role="group"
      aria-labelledby={idPergunta}
      onKeyDown={aoTeclar}
    >
      <p id={idPergunta} className="confirmar-troca-destinatario__pergunta">
        {pergunta}
      </p>
      <div className="confirmar-troca-destinatario__acoes">
        <button ref={refCancelar} type="button" className="botao botao--secundario" onClick={aoCancelar}>
          Não, manter como está
        </button>
        <button type="button" className="botao botao--alerta" onClick={aoConfirmar}>
          Sim, apagar e trocar
        </button>
      </div>
    </div>
  );
}
