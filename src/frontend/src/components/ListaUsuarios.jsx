import { rotuloPerfil, rotuloStatus } from '../services/perfis.js';

/**
 * Lista de usuários cadastrados (RF01): nome, e-mail, perfil e status.
 * No computador e no tablet aparece como tabela; no celular cada linha vira
 * um cartão empilhado (RNF01) — só CSS, a marcação continua sendo uma tabela.
 */
export default function ListaUsuarios({ usuarios, carregando, erro, aoTentarNovamente }) {
  if (carregando) {
    return (
      <p className="texto-secundario" role="status">
        Carregando usuários...
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

  if (usuarios.length === 0) {
    return <p className="texto-secundario">Nenhum usuário cadastrado até o momento.</p>;
  }

  return (
    // Roles explícitos: no celular o CSS usa display:block, o que faz alguns
    // navegadores descartarem a semântica de tabela para leitores de tela.
    <table className="tabela-usuarios" role="table">
      <caption className="visualmente-oculto">Usuários cadastrados no Sisto</caption>
      <thead role="rowgroup">
        <tr role="row">
          <th scope="col" role="columnheader">Nome</th>
          <th scope="col" role="columnheader">E-mail</th>
          <th scope="col" role="columnheader">Perfil</th>
          <th scope="col" role="columnheader">Status</th>
        </tr>
      </thead>
      <tbody role="rowgroup">
        {usuarios.map((item) => (
          <tr key={item.id} role="row">
            <td role="cell" data-rotulo="Nome" className="tabela-usuarios__nome">
              {item.nome}
            </td>
            <td role="cell" data-rotulo="E-mail" className="tabela-usuarios__email">
              {item.email}
            </td>
            <td role="cell" data-rotulo="Perfil">
              {rotuloPerfil(item.perfil) || '—'}
            </td>
            <td role="cell" data-rotulo="Status">
              <span className={`selo selo--${String(item.status).toLowerCase()}`}>
                {rotuloStatus(item.status) || '—'}
              </span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
