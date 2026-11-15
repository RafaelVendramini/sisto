import { descreverTurma } from '../services/mensagensTurmas.js';

/** id do botão "Editar" da linha (usado para devolver o foco após o diálogo). */
export function idBotaoEditarTurma(id) {
  return `editar-turma-${id}`;
}

/**
 * Lista de turmas (RF15): nome, etapa, ano letivo e ação "Editar".
 * No computador e no tablet aparece como tabela; no celular cada linha vira
 * um cartão empilhado (RNF01) — só CSS, a marcação continua sendo uma tabela.
 * Não há botão de exclusão: turmas não são excluídas (RN21).
 */
export default function ListaTurmas({ turmas, carregando, erro, aoTentarNovamente, aoEditar }) {
  if (carregando) {
    return (
      <p className="texto-secundario" role="status">
        Carregando turmas...
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

  if (turmas.length === 0) {
    return <p className="texto-secundario">Nenhuma turma cadastrada até o momento.</p>;
  }

  return (
    // Roles explícitos: no celular o CSS usa display:block, o que faz alguns
    // navegadores descartarem a semântica de tabela para leitores de tela.
    <table className="tabela-usuarios tabela-turmas" role="table">
      <caption className="visualmente-oculto">Turmas cadastradas no Sisto</caption>
      <thead role="rowgroup">
        <tr role="row">
          <th scope="col" role="columnheader">Nome</th>
          <th scope="col" role="columnheader">Etapa</th>
          <th scope="col" role="columnheader">Ano letivo</th>
          <th scope="col" role="columnheader">Ações</th>
        </tr>
      </thead>
      <tbody role="rowgroup">
        {turmas.map((item) => (
          <tr key={item.id} role="row">
            <td role="cell" data-rotulo="Nome" className="tabela-usuarios__nome">
              {item.nome}
            </td>
            <td role="cell" data-rotulo="Etapa">
              {item.etapa}
            </td>
            <td role="cell" data-rotulo="Ano letivo" className="tabela-turmas__ano">
              {item.anoLetivo}
            </td>
            <td role="cell" data-rotulo="Ações" className="tabela-usuarios__acoes">
              <div className="tabela-usuarios__botoes">
                <button
                  type="button"
                  id={idBotaoEditarTurma(item.id)}
                  className="botao botao--secundario botao--compacto"
                  aria-label={`Editar a turma ${descreverTurma(item)}`}
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
