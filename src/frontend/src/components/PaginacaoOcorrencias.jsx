/**
 * Paginação da lista de ocorrências (RF11 — Issue #87): "Anterior"/"Próxima"
 * e a indicação "Página X de Y". A página é a da URL; o total vem da API.
 * Na primeira página "Anterior" fica desativado; na última, "Próxima".
 */
export default function PaginacaoOcorrencias({ pagina, totalPaginas, aoIrParaPagina }) {
  const temAnterior = pagina > 1;
  const temProxima = pagina < totalPaginas;
  return (
    <nav className="paginacao-ocorrencias" aria-label="Páginas da lista de ocorrências">
      <button
        type="button"
        className="botao botao--secundario"
        disabled={!temAnterior}
        // Página além da última (URL editada): "Anterior" leva à última.
        onClick={() => aoIrParaPagina(Math.min(pagina - 1, totalPaginas))}
      >
        Anterior
      </button>
      <span className="paginacao-ocorrencias__posicao">
        Página {pagina} de {totalPaginas}
      </span>
      <button
        type="button"
        className="botao botao--secundario"
        disabled={!temProxima}
        onClick={() => aoIrParaPagina(pagina + 1)}
      >
        Próxima
      </button>
    </nav>
  );
}
