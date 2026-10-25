import { useCallback, useEffect, useRef, useState } from 'react';
import FormularioCategoria from '../components/FormularioCategoria.jsx';
import FormularioEdicaoCategoria from '../components/FormularioEdicaoCategoria.jsx';
import ListaCategorias, { idBotaoEditarCategoria } from '../components/ListaCategorias.jsx';
import { listarCategorias } from '../services/categorias.js';
import { MENSAGEM_SEM_CONEXAO, MENSAGEM_SEM_PERMISSAO } from '../services/mensagens.js';

const MENSAGEM_GENERICA = 'Não foi possível carregar a lista de categorias agora.';

function mensagemErroLista(falha) {
  if (falha?.status === 403) return MENSAGEM_SEM_PERMISSAO;
  if (falha?.status === 0) return MENSAGEM_SEM_CONEXAO;
  return MENSAGEM_GENERICA;
}

function ordenarPorNome(lista) {
  return [...lista].sort((a, b) => String(a.nome ?? '').localeCompare(String(b.nome ?? ''), 'pt-BR'));
}

/** Guarda só os campos do contrato (Seção 11). */
function camposExibidos({ id, nome, descricao }) {
  return { id, nome, descricao: descricao ?? null };
}

// Categorias de ocorrência (RF07, RN18, RN21): listagem, cadastro e edição.
// Só para Gestão e Pedagógico (a rota é filtrada em App.jsx; a proteção real
// é do back-end — 403). Não existe exclusão de categoria (RN21).
export default function Categorias() {
  const [categorias, setCategorias] = useState([]);
  const [emEdicao, setEmEdicao] = useState(null);
  const [confirmacao, setConfirmacao] = useState('');
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const montado = useRef(true);

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro('');
    try {
      const lista = await listarCategorias();
      if (montado.current) setCategorias(lista.map(camposExibidos));
    } catch (falha) {
      // 401: o tratamento central já leva ao login com aviso.
      if (montado.current && falha?.status !== 401) setErro(mensagemErroLista(falha));
    } finally {
      if (montado.current) setCarregando(false);
    }
  }, []);

  useEffect(() => {
    montado.current = true;
    carregar();
    return () => {
      montado.current = false;
    };
  }, [carregar]);

  // Recarrega sem trocar a tabela por "Carregando..." (404 ou alteração
  // simultânea — 409). Se falhar, a lista atual continua na tela.
  const recarregarEmSegundoPlano = useCallback(async () => {
    try {
      const lista = await listarCategorias();
      if (montado.current) setCategorias(lista.map(camposExibidos));
    } catch {
      // mantém a lista atual
    }
  }, []);

  // Insere a categoria devolvida pelo POST sem nova chamada à API.
  const aoCadastrar = useCallback(
    (nova) => {
      if (!nova || nova.id === undefined) {
        carregar();
      } else {
        const item = camposExibidos(nova);
        setCategorias((atual) => ordenarPorNome([...atual.filter((c) => c.id !== item.id), item]));
      }
      setConfirmacao(`Categoria ${nova?.nome ?? ''} cadastrada com sucesso.`);
    },
    [carregar],
  );

  function abrirEdicao(item) {
    setConfirmacao('');
    setEmEdicao(item);
  }

  function fecharEdicao() {
    setEmEdicao(null);
  }

  const idEmEdicao = emEdicao?.id;
  const restaurarFoco = useCallback(() => {
    if (idEmEdicao !== undefined) document.getElementById(idBotaoEditarCategoria(idEmEdicao))?.focus();
  }, [idEmEdicao]);

  // Atualiza a linha com o retorno do PUT /categorias/{id} (sem nova chamada à API).
  function aoSalvarEdicao(atualizada) {
    const item = camposExibidos(atualizada);
    setCategorias((atual) => ordenarPorNome(atual.map((c) => (c.id === item.id ? item : c))));
    setEmEdicao(null);
    setConfirmacao(`Categoria ${item.nome} atualizada com sucesso.`);
  }

  return (
    <div className="pagina-usuarios pagina-categorias">
      <h1>Categorias de ocorrência</h1>
      <p className="texto-secundario">
        Cadastre e edite as categorias usadas para classificar as ocorrências.
      </p>

      <div className="pagina-usuarios__grade">
        <section className="cartao" aria-labelledby="titulo-cadastrar-categoria">
          <h2 id="titulo-cadastrar-categoria">Cadastrar categoria</h2>
          <FormularioCategoria aoCadastrar={aoCadastrar} />
        </section>

        <section className="cartao" aria-labelledby="titulo-lista-categorias">
          <h2 id="titulo-lista-categorias">Categorias cadastradas</h2>
          <p className="texto-secundario">
            Categorias não são excluídas: se o nome ou a descrição precisar mudar, use
            &quot;Editar&quot;.
          </p>
          <div role="status" aria-live="polite">
            {confirmacao && <p className="mensagem mensagem--sucesso">{confirmacao}</p>}
          </div>
          <ListaCategorias
            categorias={categorias}
            carregando={carregando}
            erro={erro}
            aoTentarNovamente={carregar}
            aoEditar={abrirEdicao}
          />
        </section>
      </div>

      {emEdicao && (
        <FormularioEdicaoCategoria
          categoria={emEdicao}
          aoSalvar={aoSalvarEdicao}
          aoCancelar={fecharEdicao}
          aoRestaurarFoco={restaurarFoco}
          aoListaDesatualizada={recarregarEmSegundoPlano}
        />
      )}
    </div>
  );
}
