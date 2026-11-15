/** id do botão "Editar" da linha (usado para devolver o foco após o diálogo). */
export function idBotaoEditarCategoria(id) {
  return `editar-categoria-${id}`;
}

/**
 * Lista de categorias de ocorrência (RF07): nome, descrição e ação "Editar".
 * No computador e no tablet aparece como tabela; no celular cada linha vira
 * um cartão empilhado (RNF01) — só CSS, a marcação continua sendo uma tabela.
 * Não há botão de exclusão: categorias não são excluídas (RN21).
 */
export default function ListaCategorias({ categorias, carregando, erro, aoTentarNovamente, aoEditar }) {
  if (carregando) {
    return (
      <p className="texto-secundario" role="status">
        Carregando categorias...
      </p>
    );
  }

  if (erro) {
    return (
      <div className="mensagem mensagem--erro" role="alert">
        <p>{erro}</p>
        <button type="button" className="botao botao--secundario" onClick={aoTentarNovamente}>
          Tentar novamente
        </button>
      </div>
    );
  }

  if (categorias.length === 0) {
    return <p className="texto-secundario">Nenhuma categoria cadastrada até o momento.</p>;
  }

  return (
    // Roles explícitos: no celular o CSS usa display:block, o que faz alguns
    // navegadores descartarem a semântica de tabela para leitores de tela.
    <table className="tabela-usuarios tabela-categorias" role="table">
      <caption className="visualmente-oculto">Categorias de ocorrência cadastradas no Sisto</caption>
      <thead role="rowgroup">
        <tr role="row">
          <th scope="col" role="columnheader">Nome</th>
          <th scope="col" role="columnheader">Descrição</th>
          <th scope="col" role="columnheader">Ações</th>
        </tr>
      </thead>
      <tbody role="rowgroup">
        {categorias.map((item) => (
          <tr key={item.id} role="row">
            <td role="cell" data-rotulo="Nome" className="tabela-usuarios__nome">
              {item.nome}
            </td>
            <td role="cell" data-rotulo="Descrição" className="tabela-categorias__descricao">
              {item.descricao || <span className="texto-secundario">Sem descrição</span>}
            </td>
            <td role="cell" data-rotulo="Ações" className="tabela-usuarios__acoes">
              <div className="tabela-usuarios__botoes">
                <button
                  type="button"
                  id={idBotaoEditarCategoria(item.id)}
                  className="botao botao--secundario botao--compacto"
                  aria-label={`Editar a categoria ${item.nome}`}
                  onClick={() => aoEditar?.(item)}
                >
                  Editar
                </button>
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
