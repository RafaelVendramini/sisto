import {
  ORIENTACAO_JUSTIFICATIVA_PSICOLOGO,
  TAMANHO_MAXIMO_TEXTO_LONGO,
  TEXTO_JUSTIFICATIVA_RESTRITA,
} from '../services/mensagensOcorrencias.js';

/**
 * Campo "Justificativa para o psicólogo escolar" (RN03, RN06, RN24 — SSD 1.18,
 * Issue #152), usado no registro da ocorrência e no diálogo "Encaminhar". É a
 * `observacao` do encaminhamento ao psicólogo: obrigatória, com a orientação
 * de redação objetiva (RN06) e o aviso de quem pode lê-la (RN24). A validação
 * fica com quem usa o campo; a definitiva é a do back-end (400).
 *
 * Os ids auxiliares derivam do id do campo: `<id>-orientacao`, `<id>-aviso`,
 * `<id>-ajuda` e `<id>-erro` (o mesmo padrão de erro dos formulários).
 *
 * @param {object} props
 * @param {string} props.prefixoId - id do <textarea>
 * @param {string} props.valor
 * @param {(valor: string) => void} props.aoAlterar
 * @param {string} [props.erro]
 * @param {boolean} [props.somenteLeitura] - durante o envio
 * @param {import('react').Ref<HTMLTextAreaElement>} [props.refCampo] - para levar o foco ao erro
 */
export default function CampoJustificativaPsicologo({
  prefixoId,
  valor,
  aoAlterar,
  erro,
  somenteLeitura = false,
  refCampo,
}) {
  const descricoes = [
    `${prefixoId}-orientacao`,
    `${prefixoId}-aviso`,
    `${prefixoId}-ajuda`,
    erro ? `${prefixoId}-erro` : null,
  ].filter(Boolean);

  return (
    <div className="campo justificativa-psicologo">
      <label htmlFor={prefixoId}>Justificativa para o psicólogo escolar</label>
      <p
        id={`${prefixoId}-orientacao`}
        className="mensagem mensagem--aviso justificativa-psicologo__orientacao"
      >
        {ORIENTACAO_JUSTIFICATIVA_PSICOLOGO}
      </p>
      <textarea
        id={prefixoId}
        name="observacao"
        ref={refCampo}
        rows={4}
        maxLength={TAMANHO_MAXIMO_TEXTO_LONGO}
        value={valor}
        readOnly={somenteLeitura}
        aria-required="true"
        aria-invalid={Boolean(erro)}
        aria-describedby={descricoes.join(' ')}
        onChange={(evento) => aoAlterar(evento.target.value)}
      />
      <span id={`${prefixoId}-aviso`} className="justificativa-psicologo__aviso">
        {TEXTO_JUSTIFICATIVA_RESTRITA}
      </span>
      <span id={`${prefixoId}-ajuda`} className="campo__ajuda">
        Obrigatório. Até {TAMANHO_MAXIMO_TEXTO_LONGO} caracteres.
      </span>
      {erro && (
        <span id={`${prefixoId}-erro`} className="campo__erro">
          {erro}
        </span>
      )}
    </div>
  );
}
