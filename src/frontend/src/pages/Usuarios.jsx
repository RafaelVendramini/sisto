import { useCallback, useEffect, useState } from 'react';
import ConfirmarStatusUsuario, { ACOES_STATUS } from '../components/ConfirmarStatusUsuario.jsx';
import FormularioEdicaoUsuario from '../components/FormularioEdicaoUsuario.jsx';
import FormularioUsuario from '../components/FormularioUsuario.jsx';
import ListaUsuarios, { idBotaoEditar } from '../components/ListaUsuarios.jsx';
import RedefinirSenhaUsuario from '../components/RedefinirSenhaUsuario.jsx';
import { useSessao } from '../components/Sessao.jsx';
import { exibirFalha, useCarregamento } from '../components/useCarregamento.js';
import { useTituloPagina } from '../components/useTituloPagina.js';
import { mensagemErroCarga } from '../services/mensagens.js';
import { listarUsuarios } from '../services/usuarios.js';

const MENSAGEM_GENERICA = 'Não foi possível carregar a lista de usuários agora.';

function ordenarPorNome(lista) {
  return [...lista].sort((a, b) => String(a.nome ?? '').localeCompare(String(b.nome ?? ''), 'pt-BR'));
}

/** Guarda só os campos exibidos (nada além do contrato fica em memória). */
function camposExibidos({ id, nome, email, perfil, status }) {
  return { id, nome, email, perfil, status };
}

// Gestão de usuários (RF01, RF03, RF04, RN01, RN07, RN10, RN11): listagem,
// cadastro, edição, mudança de status e redefinição de senha. Só para a Gestão (a rota é filtrada em App.jsx;
// a proteção real é do back-end — 403). Não existe exclusão de usuário (RN07).
export default function Usuarios() {
  useTituloPagina('Usuários');
  const { usuario: usuarioLogado, atualizarNomeUsuario } = useSessao();
  const [usuarios, setUsuarios] = useState([]);
  // Diálogo aberto: { tipo: 'editar' | 'status' | 'senha', usuario, novoStatus? } ou null.
  const [dialogo, setDialogo] = useState(null);
  const [confirmacao, setConfirmacao] = useState('');
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const { montado } = useCarregamento();

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro('');
    try {
      const lista = await listarUsuarios();
      if (montado.current) setUsuarios(lista);
    } catch (falha) {
      // 401: o tratamento central já leva ao login com aviso.
      if (montado.current && exibirFalha(falha)) setErro(mensagemErroCarga(falha, MENSAGEM_GENERICA));
    } finally {
      if (montado.current) setCarregando(false);
    }
  }, [montado]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  // Recarrega a lista sem trocar a tabela por "Carregando..." (os botões
  // continuam na tela, inclusive o que abriu um diálogo). Usada quando a lista
  // pode estar desatualizada (404 ou alteração simultânea — 409). Se falhar,
  // a lista atual continua na tela; 401 cai no tratamento central.
  const recarregarEmSegundoPlano = useCallback(async () => {
    try {
      const lista = await listarUsuarios();
      if (montado.current) setUsuarios(lista);
    } catch {
      // mantém a lista atual
    }
  }, [montado]);

  // Insere o usuário devolvido pelo POST (status ATIVO) sem nova chamada à API,
  // mantendo a ordem por nome usada pelo back-end.
  const aoCadastrar = useCallback((novo) => {
    if (!novo || novo.id === undefined) {
      carregar();
      return;
    }
    const item = camposExibidos(novo);
    setUsuarios((atual) => ordenarPorNome([...atual.filter((u) => u.id !== item.id), item]));
  }, [carregar]);

  // Atualiza a linha com o retorno do PUT /usuarios/{id} (sem nova chamada à API).
  const substituirNaLista = useCallback((atualizado) => {
    const item = camposExibidos(atualizado);
    setUsuarios((atual) => ordenarPorNome(atual.map((u) => (u.id === item.id ? item : u))));
  }, []);

  function abrirEdicao(item) {
    setConfirmacao('');
    setDialogo({ tipo: 'editar', usuario: item });
  }

  function abrirMudancaStatus(item, novoStatus) {
    setConfirmacao('');
    setDialogo({ tipo: 'status', usuario: item, novoStatus });
  }

  function abrirRedefinicaoSenha(item) {
    setConfirmacao('');
    setDialogo({ tipo: 'senha', usuario: item });
  }

  function fecharDialogo() {
    setDialogo(null);
  }

  // Se o botão que abriu o diálogo sumiu (ex.: "Bloquear" após bloquear),
  // o foco vai para o botão "Editar" da mesma linha.
  const idDialogo = dialogo?.usuario?.id;
  const restaurarFoco = useCallback(() => {
    if (idDialogo !== undefined) document.getElementById(idBotaoEditar(idDialogo))?.focus();
  }, [idDialogo]);

  function aoSalvarEdicao(atualizado) {
    substituirNaLista(atualizado);
    // A Gestão editou o próprio nome: o cabeçalho reflete na hora.
    if (atualizado.id === usuarioLogado?.id && atualizado.nome !== usuarioLogado?.nome) {
      atualizarNomeUsuario(atualizado.nome);
    }
    setDialogo(null);
    setConfirmacao(`Dados de ${atualizado.nome} atualizados.`);
  }

  function aoConcluirStatus(atualizado) {
    const acao = ACOES_STATUS[dialogo?.novoStatus];
    substituirNaLista(atualizado);
    setDialogo(null);
    setConfirmacao(
      acao ? acao.sucesso(atualizado.nome) : `Dados de ${atualizado.nome} atualizados.`,
    );
  }

  // Confirma sem exibir a senha (ela nunca sai do campo do diálogo).
  function aoConcluirRedefinicao(item) {
    setDialogo(null);
    setConfirmacao(
      `Senha de ${item.nome} redefinida. Entregue a nova senha pessoalmente: no próximo acesso, será obrigatório trocá-la.`,
    );
  }

  return (
    <div className="pagina-usuarios">
      <h1>Usuários</h1>
      <p className="texto-secundario">
        Veja quem tem acesso ao Sisto, cadastre novos profissionais da escola e altere dados,
        acesso ou senha de quem já está cadastrado.
      </p>

      <div className="pagina-usuarios__grade">
        <section className="cartao" aria-labelledby="titulo-cadastrar-usuario">
          <h2 id="titulo-cadastrar-usuario">Cadastrar usuário</h2>
          <FormularioUsuario aoCadastrar={aoCadastrar} />
        </section>

        <section className="cartao" aria-labelledby="titulo-lista-usuarios">
          <h2 id="titulo-lista-usuarios">Usuários cadastrados</h2>
          <p className="texto-secundario">
            Usuários não são excluídos. Para retirar o acesso de alguém, use &quot;Bloquear&quot;
            ou &quot;Desativar&quot;: o histórico dos registros é mantido e o acesso pode ser
            reativado depois.
          </p>
          <div role="status" aria-live="polite">
            {confirmacao && <p className="mensagem mensagem--sucesso">{confirmacao}</p>}
          </div>
          <ListaUsuarios
            usuarios={usuarios}
            carregando={carregando}
            erro={erro}
            aoTentarNovamente={carregar}
            idUsuarioLogado={usuarioLogado?.id}
            aoEditar={abrirEdicao}
            aoAlterarStatus={abrirMudancaStatus}
            aoRedefinirSenha={abrirRedefinicaoSenha}
          />
        </section>
      </div>

      {dialogo?.tipo === 'editar' && (
        <FormularioEdicaoUsuario
          usuario={dialogo.usuario}
          ehProprioUsuario={dialogo.usuario.id === usuarioLogado?.id}
          aoSalvar={aoSalvarEdicao}
          aoCancelar={fecharDialogo}
          aoRestaurarFoco={restaurarFoco}
          aoListaDesatualizada={recarregarEmSegundoPlano}
        />
      )}

      {dialogo?.tipo === 'status' && (
        <ConfirmarStatusUsuario
          usuario={dialogo.usuario}
          novoStatus={dialogo.novoStatus}
          aoConcluir={aoConcluirStatus}
          aoCancelar={fecharDialogo}
          aoRestaurarFoco={restaurarFoco}
          aoListaDesatualizada={recarregarEmSegundoPlano}
        />
      )}

      {dialogo?.tipo === 'senha' && (
        <RedefinirSenhaUsuario
          usuario={dialogo.usuario}
          aoConcluir={aoConcluirRedefinicao}
          aoCancelar={fecharDialogo}
          aoRestaurarFoco={restaurarFoco}
          aoListaDesatualizada={recarregarEmSegundoPlano}
        />
      )}
    </div>
  );
}
