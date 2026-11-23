/**
 * Caixa "Mostrar turmas de anos anteriores" (SSD 1.13, Seção 10 — Front-end;
 * Issue #134). Desmarcada, as listas de turmas mostram só as do ano letivo
 * atual (horário de São Paulo — RN17) em diante; marcada, mostram todas.
 *
 * @param {object} props
 * @param {string} props.id - id da caixa (único na página)
 * @param {boolean} props.marcado
 * @param {(marcado: boolean) => void} props.aoAlterar
 * @param {number} props.anoAtual - ano letivo atual, citado na ajuda
 * @param {boolean} [props.somenteLeitura] - durante o envio
 */
export default function OpcaoTurmasAnteriores({ id, marcado, aoAlterar, anoAtual, somenteLeitura }) {
  const idAjuda = `${id}-ajuda`;
  return (
    <div className="opcao-turmas-anteriores">
      <label className="opcao-turmas-anteriores__rotulo" htmlFor={id}>
        <input
          id={id}
          type="checkbox"
          checked={marcado}
          aria-describedby={idAjuda}
          aria-disabled={somenteLeitura || undefined}
          onChange={(evento) => {
            if (somenteLeitura) return;
            aoAlterar(evento.target.checked);
          }}
        />
        <span>Mostrar turmas de anos anteriores</span>
      </label>
      <span id={idAjuda} className="campo__ajuda">
        {marcado
          ? 'Mostrando as turmas de todos os anos letivos.'
          : `Mostrando só as turmas de ${anoAtual} em diante.`}
      </span>
    </div>
  );
}
