/**
 * Um par rótulo/valor de uma lista de dados (<dl>) do detalhe da ocorrência.
 * `longo` preserva as quebras de linha do texto.
 */
export default function Dado({ rotulo, children, longo = false }) {
  return (
    <div className={longo ? 'dados-ocorrencia__longo' : undefined}>
      <dt>{rotulo}</dt>
      <dd className={longo ? 'texto-longo' : undefined}>{children}</dd>
    </div>
  );
}
