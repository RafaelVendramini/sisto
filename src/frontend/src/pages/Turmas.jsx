import { useCallback, useEffect, useState } from 'react';
import FormularioEdicaoTurma from '../components/FormularioEdicaoTurma.jsx';
import FormularioTurma from '../components/FormularioTurma.jsx';
import ListaTurmas, { idBotaoEditarTurma } from '../components/ListaTurmas.jsx';
import { exibirFalha, useCarregamento } from '../components/useCarregamento.js';
import { useTituloPagina } from '../components/useTituloPagina.js';
import { mensagemErroCarga } from '../services/mensagens.js';
import { descreverTurma } from '../services/mensagensTurmas.js';
import { listarTurmas } from '../services/turmas.js';

const MENSAGEM_GENERICA = 'Não foi possível carregar a lista de turmas agora.';

function compararTexto(a, b) {
  return String(a ?? '').localeCompare(String(b ?? ''), 'pt-BR');
}

/** Mesma ordem do GET /turmas: ano letivo mais recente primeiro, depois etapa e nome. */
function ordenar(lista) {
  return [...lista].sort(
    (a, b) =>
      (b.anoLetivo ?? 0) - (a.anoLetivo ?? 0) ||
      compararTexto(a.etapa, b.etapa) ||
      compararTexto(a.nome, b.nome) ||
      (a.id ?? 0) - (b.id ?? 0),
  );
}

/** Guarda só os campos do contrato (Seção 12). */
function camposExibidos({ id, nome, etapa, anoLetivo }) {
  return { id, nome, etapa, anoLetivo };
}

// Turmas (RF15, RN18, RN21): listagem, cadastro e edição.
// Só para a Gestão (a rota é filtrada em App.jsx; a proteção real é do
// back-end — 403). Não existe exclusão de turma (RN21).
export default function Turmas() {
  useTituloPagina('Turmas');
  const [turmas, setTurmas] = useState([]);
  const [emEdicao, setEmEdicao] = useState(null);
  const [confirmacao, setConfirmacao] = useState('');
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const { montado } = useCarregamento();

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro('');
    try {
      const lista = await listarTurmas();
      if (montado.current) setTurmas(lista.map(camposExibidos));
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

  // Recarrega sem trocar a tabela por "Carregando..." (404 ou alteração
  // simultânea — 409). Se falhar, a lista atual continua na tela.
  const recarregarEmSegundoPlano = useCallback(async () => {
    try {
      const lista = await listarTurmas();
      if (montado.current) setTurmas(lista.map(camposExibidos));
    } catch {
      // mantém a lista atual
    }
  }, [montado]);

  // Insere a turma devolvida pelo POST sem nova chamada à API.
  const aoCadastrar = useCallback(
    (nova) => {
      if (!nova || nova.id === undefined) {
        carregar();
      } else {
        const item = camposExibidos(nova);
        setTurmas((atual) => ordenar([...atual.filter((t) => t.id !== item.id), item]));
      }
      setConfirmacao(`Turma ${descreverTurma(nova ?? {})} cadastrada com sucesso.`);
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
    if (idEmEdicao !== undefined) document.getElementById(idBotaoEditarTurma(idEmEdicao))?.focus();
  }, [idEmEdicao]);

  // Atualiza a linha com o retorno do PUT /turmas/{id} (sem nova chamada à API).
  function aoSalvarEdicao(atualizada) {
    const item = camposExibidos(atualizada);
    setTurmas((atual) => ordenar(atual.map((t) => (t.id === item.id ? item : t))));
    setEmEdicao(null);
    setConfirmacao(`Turma ${descreverTurma(item)} atualizada com sucesso.`);
  }

  return (
    <div className="pagina-usuarios pagina-turmas">
      <h1>Turmas</h1>
      <p className="texto-secundario">Cadastre e edite as turmas da escola em cada ano letivo.</p>

      <div className="pagina-usuarios__grade">
        <section className="cartao" aria-labelledby="titulo-cadastrar-turma">
          <h2 id="titulo-cadastrar-turma">Cadastrar turma</h2>
          <FormularioTurma aoCadastrar={aoCadastrar} />
        </section>

        <section className="cartao" aria-labelledby="titulo-lista-turmas">
          <h2 id="titulo-lista-turmas">Turmas cadastradas</h2>
          <p className="texto-secundario">
            Turmas não são excluídas: se o nome, a etapa ou o ano letivo precisar mudar, use
            &quot;Editar&quot;.
          </p>
          <div role="status" aria-live="polite">
            {confirmacao && <p className="mensagem mensagem--sucesso">{confirmacao}</p>}
          </div>
          <ListaTurmas
            turmas={turmas}
            carregando={carregando}
            erro={erro}
            aoTentarNovamente={carregar}
            aoEditar={abrirEdicao}
          />
        </section>
      </div>

      {emEdicao && (
        <FormularioEdicaoTurma
          turma={emEdicao}
          aoSalvar={aoSalvarEdicao}
          aoCancelar={fecharEdicao}
          aoRestaurarFoco={restaurarFoco}
          aoListaDesatualizada={recarregarEmSegundoPlano}
        />
      )}
    </div>
  );
}
