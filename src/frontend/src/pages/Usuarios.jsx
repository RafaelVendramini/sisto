import { useCallback, useEffect, useRef, useState } from 'react';
import FormularioUsuario from '../components/FormularioUsuario.jsx';
import ListaUsuarios from '../components/ListaUsuarios.jsx';
import { listarUsuarios } from '../services/usuarios.js';

const MENSAGEM_SEM_PERMISSAO = 'Acesso não permitido para o seu perfil.';
const MENSAGEM_SEM_CONEXAO =
  'Não foi possível conectar ao servidor. Verifique sua internet e tente novamente.';
const MENSAGEM_GENERICA = 'Não foi possível carregar a lista de usuários agora.';

function mensagemErroLista(falha) {
  if (falha?.status === 403) return MENSAGEM_SEM_PERMISSAO;
  if (falha?.status === 0) return MENSAGEM_SEM_CONEXAO;
  return MENSAGEM_GENERICA;
}

function ordenarPorNome(lista) {
  return [...lista].sort((a, b) => String(a.nome ?? '').localeCompare(String(b.nome ?? ''), 'pt-BR'));
}

// Gestão de usuários (RF01, RN01, RN10): listagem e cadastro. Só para a Gestão
// (a rota é filtrada em App.jsx; a proteção real é do back-end — 403).
export default function Usuarios() {
  const [usuarios, setUsuarios] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const montado = useRef(true);

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro('');
    try {
      const lista = await listarUsuarios();
      if (montado.current) setUsuarios(lista);
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

  // Insere o usuário devolvido pelo POST (status ATIVO) sem nova chamada à API,
  // mantendo a ordem por nome usada pelo back-end.
  const aoCadastrar = useCallback((novo) => {
    if (!novo || novo.id === undefined) {
      carregar();
      return;
    }
    // Guarda só os campos exibidos (nada além do contrato fica em memória).
    const { id, nome, email, perfil, status } = novo;
    setUsuarios((atual) =>
      ordenarPorNome([...atual.filter((u) => u.id !== id), { id, nome, email, perfil, status }]),
    );
  }, [carregar]);

  return (
    <div className="pagina-usuarios">
      <h1>Usuários</h1>
      <p className="texto-secundario">
        Veja quem tem acesso ao Sisto e cadastre novos profissionais da escola.
      </p>

      <div className="pagina-usuarios__grade">
        <section className="cartao" aria-labelledby="titulo-cadastrar-usuario">
          <h2 id="titulo-cadastrar-usuario">Cadastrar usuário</h2>
          <FormularioUsuario aoCadastrar={aoCadastrar} />
        </section>

        <section className="cartao" aria-labelledby="titulo-lista-usuarios">
          <h2 id="titulo-lista-usuarios">Usuários cadastrados</h2>
          <ListaUsuarios
            usuarios={usuarios}
            carregando={carregando}
            erro={erro}
            aoTentarNovamente={carregar}
          />
        </section>
      </div>
    </div>
  );
}
