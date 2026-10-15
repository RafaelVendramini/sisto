import { rotuloPerfil, rotuloStatus } from '../services/perfis.js';

/**
 * Mudanças de status oferecidas para cada status atual (RF04, RN07).
 * Não existe ação de excluir: usuários nunca são excluídos.
 */
export const ACOES_POR_STATUS = Object.freeze({
  ATIVO: [
    { status: 'BLOQUEADO', rotulo: 'Bloquear' },
    { status: 'DESATIVADO', rotulo: 'Desativar' },
  ],
  BLOQUEADO: [
    { status: 'ATIVO', rotulo: 'Reativar' },
    { status: 'DESATIVADO', rotulo: 'Desativar' },
  ],
  DESATIVADO: [
    { status: 'ATIVO', rotulo: 'Reativar' },
    { status: 'BLOQUEADO', rotulo: 'Bloquear' },
  ],
});

/** id do botão "Editar" da linha (usado para devolver o foco após um diálogo). */
export function idBotaoEditar(id) {
  return `editar-usuario-${id}`;
}

/**
 * Lista de usuários cadastrados (RF01, RF04): nome, e-mail, perfil, status e ações.
 * No computador e no tablet aparece como tabela; no celular cada linha vira
 * um cartão empilhado (RNF01) — só CSS, a marcação continua sendo uma tabela.
 * RN11: no próprio usuário logado não há bloquear/desativar (só editar).
 * RF03: "Redefinir senha" aparece só para os outros usuários; a própria senha
 * é trocada em "Alterar minha senha".
 */
export default function ListaUsuarios({
  usuarios,
  carregando,
  erro,
  aoTentarNovamente,
  idUsuarioLogado,
  aoEditar,
  aoAlterarStatus,
  aoRedefinirSenha,
}) {
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
          <th scope="col" role="columnheader">Ações</th>
        </tr>
      </thead>
      <tbody role="rowgroup">
        {usuarios.map((item) => {
          const ehVoce = idUsuarioLogado !== undefined && item.id === idUsuarioLogado;
          const acoesStatus = ehVoce ? [] : (ACOES_POR_STATUS[item.status] ?? []);
          return (
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
              <td role="cell" data-rotulo="Ações" className="tabela-usuarios__acoes">
                <div className="tabela-usuarios__botoes">
                  <button
                    type="button"
                    id={idBotaoEditar(item.id)}
                    className="botao botao--secundario botao--compacto"
                    aria-label={`Editar ${item.nome}`}
                    onClick={(evento) => aoEditar?.(item, evento)}
                  >
                    Editar
                  </button>
                  {acoesStatus.map((acao) => (
                    <button
                      key={acao.status}
                      type="button"
                      className={`botao botao--compacto ${
                        acao.status === 'ATIVO' ? 'botao--secundario' : 'botao--alerta'
                      }`}
                      aria-label={`${acao.rotulo} ${item.nome}`}
                      onClick={(evento) => aoAlterarStatus?.(item, acao.status, evento)}
                    >
                      {acao.rotulo}
                    </button>
                  ))}
                  {!ehVoce && aoRedefinirSenha && (
                    <button
                      type="button"
                      className="botao botao--secundario botao--compacto"
                      aria-label={`Redefinir senha de ${item.nome}`}
                      onClick={(evento) => aoRedefinirSenha(item, evento)}
                    >
                      Redefinir senha
                    </button>
                  )}
                </div>
                {ehVoce && (
                  <p className="tabela-usuarios__voce">
                    Este é você. Não é possível bloquear, desativar nem alterar o perfil do seu
                    próprio usuário. Para trocar a sua senha, use &quot;Alterar minha senha&quot;
                    no topo da página.
                  </p>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
