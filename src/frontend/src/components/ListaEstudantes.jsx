import { rotuloTurma, sinalizacaoTutor } from '../services/mensagensEstudantes.js';

/** id do botão "Editar" da linha (usado para devolver o foco após o diálogo). */
export function idBotaoEditarEstudante(id) {
  return `editar-estudante-${id}`;
}

function CelulaTutor({ tutor }) {
  if (!tutor) return <span className="texto-secundario">Sem tutor</span>;
  const sinal = sinalizacaoTutor(tutor);
  return (
    <>
      {tutor.nome}
      {sinal && (
        <>
          {' '}
          <span className={`selo selo--${sinal}`}>Tutor {sinal}</span>
        </>
      )}
    </>
  );
}

/**
 * Lista de estudantes (RF15, RF16): nome completo, código escolar, turma,
 * tutor e ação "Editar". Tutor bloqueado ou desativado aparece sinalizado
 * para a Gestão trocar ou desvincular (RN13).
 * No computador e no tablet aparece como tabela; no celular cada linha vira
 * um cartão empilhado (RNF01) — só CSS, a marcação continua sendo uma tabela.
 * Não há botão de exclusão: estudantes não são excluídos (RN21).
 */
export default function ListaEstudantes({
  estudantes,
  carregando,
  erro,
  filtrada,
  aoTentarNovamente,
  aoEditar,
}) {
  if (carregando) {
    return (
      <p className="texto-secundario" role="status">
        Carregando estudantes...
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

  if (estudantes.length === 0) {
    return (
      <p className="texto-secundario">
        {filtrada
          ? 'Nenhum estudante cadastrado nesta turma.'
          : 'Nenhum estudante cadastrado até o momento.'}
      </p>
    );
  }

  return (
    // Roles explícitos: no celular o CSS usa display:block, o que faz alguns
    // navegadores descartarem a semântica de tabela para leitores de tela.
    <table className="tabela-usuarios tabela-estudantes" role="table">
      <caption className="visualmente-oculto">Estudantes cadastrados no Sisto</caption>
      <thead role="rowgroup">
        <tr role="row">
          <th scope="col" role="columnheader">Nome completo</th>
          <th scope="col" role="columnheader">Código escolar</th>
          <th scope="col" role="columnheader">Turma</th>
          <th scope="col" role="columnheader">Tutor</th>
          <th scope="col" role="columnheader">Ações</th>
        </tr>
      </thead>
      <tbody role="rowgroup">
        {estudantes.map((item) => (
          <tr key={item.id} role="row">
            <td role="cell" data-rotulo="Nome completo" className="tabela-usuarios__nome">
              {item.nomeCompleto}
            </td>
            <td role="cell" data-rotulo="Código escolar" className="tabela-estudantes__codigo">
              {item.codigoEscolar ? (
                item.codigoEscolar
              ) : (
                <span className="texto-secundario">Não informado</span>
              )}
            </td>
            <td role="cell" data-rotulo="Turma">
              {rotuloTurma(item.turma)}
            </td>
            <td role="cell" data-rotulo="Tutor">
              <CelulaTutor tutor={item.tutor} />
            </td>
            <td role="cell" data-rotulo="Ações" className="tabela-usuarios__acoes">
              <div className="tabela-usuarios__botoes">
                <button
                  type="button"
                  id={idBotaoEditarEstudante(item.id)}
                  className="botao botao--secundario botao--compacto"
                  aria-label={`Editar ${item.nomeCompleto}`}
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
