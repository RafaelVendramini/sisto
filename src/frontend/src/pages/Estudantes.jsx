import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import FormularioEdicaoEstudante from '../components/FormularioEdicaoEstudante.jsx';
import FormularioEstudante from '../components/FormularioEstudante.jsx';
import OpcaoTurmasAnteriores from '../components/OpcaoTurmasAnteriores.jsx';
import ListaEstudantes, { idBotaoEditarEstudante } from '../components/ListaEstudantes.jsx';
import { exibirFalha, useCarregamento } from '../components/useCarregamento.js';
import { useTituloPagina } from '../components/useTituloPagina.js';
import { listarEstudantes } from '../services/estudantes.js';
import { mensagemErroCarga } from '../services/mensagens.js';
import { rotuloTurma } from '../services/mensagensEstudantes.js';
import { listarTurmas } from '../services/turmas.js';
import {
  anoLetivoAtual,
  filtrarTurmasPorAnoLetivo,
  temTurmasAnteriores,
} from '../services/turmasAnoLetivo.js';
import { listarUsuarios } from '../services/usuarios.js';

const MENSAGEM_GENERICA_LISTA = 'Não foi possível carregar a lista de estudantes agora.';
const MENSAGEM_GENERICA_OPCOES = 'Não foi possível carregar as turmas e os tutores agora.';
// Só a lista de usuários falhou (#128): o cadastro continua, sem a lista de tutores.
export const AVISO_TUTORES_INDISPONIVEIS =
  'Não foi possível carregar a lista de tutores. Você pode cadastrar o estudante "Sem tutor" ' +
  'e vincular o tutor depois, em "Editar".';
const ID_FILTRO = 'filtro-turma';
const ID_TITULO_LISTA = 'titulo-lista-estudantes';

/** Mesma ordem do GET /estudantes: nome completo, depois id. */
function ordenar(lista) {
  return [...lista].sort(
    (a, b) =>
      String(a.nomeCompleto ?? '').localeCompare(String(b.nomeCompleto ?? ''), 'pt-BR') ||
      (a.id ?? 0) - (b.id ?? 0),
  );
}

/** Guarda só os campos do contrato (Seção 12). */
function camposExibidos({ id, nomeCompleto, codigoEscolar, turma, tutor }) {
  return {
    id,
    nomeCompleto,
    codigoEscolar: codigoEscolar ?? null,
    turma: turma ? { id: turma.id, nome: turma.nome, etapa: turma.etapa, anoLetivo: turma.anoLetivo } : null,
    // O e-mail do tutor não é exibido nesta tela; não é guardado (minimização, LGPD).
    tutor: tutor ? { id: tutor.id, nome: tutor.nome, status: tutor.status } : null,
  };
}

/** Tutores que podem ser vinculados (RN13): perfil Tutor e status ativo. */
function tutoresAtivos(usuarios) {
  return usuarios
    .filter((u) => u.perfil === 'TUTOR' && u.status === 'ATIVO')
    .map(({ id, nome, status }) => ({ id, nome, status }));
}

// Estudantes (RF15, RF16, RN13, RN18, RN21): listagem com filtro por turma,
// cadastro, edição e vínculo com o professor tutor.
// Só para a Gestão (a rota é filtrada em App.jsx; a proteção real é do
// back-end — 403). Não existe exclusão de estudante (RN21).
export default function Estudantes() {
  useTituloPagina('Estudantes');
  const [estudantes, setEstudantes] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [filtro, setFiltro] = useState('');
  // Filtro da lista: por padrão, só as turmas do ano letivo atual em diante
  // (SSD 1.13, Issue #134). A turma já escolhida no filtro continua na lista.
  const [mostrarTurmasAnteriores, setMostrarTurmasAnteriores] = useState(false);

  const [turmas, setTurmas] = useState([]);
  const [tutores, setTutores] = useState([]);
  const [opcoesCarregando, setOpcoesCarregando] = useState(true);
  const [opcoesErro, setOpcoesErro] = useState('');
  const [tutoresIndisponiveis, setTutoresIndisponiveis] = useState(false);
  const [tutoresCarregando, setTutoresCarregando] = useState(false);

  const [emEdicao, setEmEdicao] = useState(null);
  const [confirmacao, setConfirmacao] = useState('');

  // Só a resposta da consulta mais recente atualiza a lista (troca rápida de filtro).
  const { montado, novaRequisicao } = useCarregamento();
  const filtroRef = useRef('');

  // As turmas são indispensáveis; a lista de tutores, não: com
  // Promise.allSettled, a falha só do GET /usuarios não trava o cadastro (#128).
  const carregarOpcoes = useCallback(async () => {
    setOpcoesCarregando(true);
    setOpcoesErro('');
    setTutoresIndisponiveis(false);
    const [listaTurmas, usuarios] = await Promise.allSettled([listarTurmas(), listarUsuarios()]);
    if (!montado.current) return;
    if (listaTurmas.status === 'rejected') {
      // 401: o tratamento central já leva ao login com aviso.
      if (exibirFalha(listaTurmas.reason)) {
        setOpcoesErro(mensagemErroCarga(listaTurmas.reason, MENSAGEM_GENERICA_OPCOES));
      }
    } else {
      setTurmas(listaTurmas.value);
    }
    if (usuarios.status === 'fulfilled') {
      setTutores(tutoresAtivos(usuarios.value));
    } else {
      setTutores([]);
      if (exibirFalha(usuarios.reason)) setTutoresIndisponiveis(true);
    }
    setOpcoesCarregando(false);
  }, [montado]);

  // Nova tentativa só da lista de tutores, sem esconder o formulário de cadastro
  // (o que já foi digitado continua na tela).
  async function recarregarTutores() {
    if (tutoresCarregando) return;
    setTutoresCarregando(true);
    try {
      const usuarios = await listarUsuarios();
      if (!montado.current) return;
      setTutores(tutoresAtivos(usuarios));
      setTutoresIndisponiveis(false);
    } catch {
      // Continua o aviso; 401 vai para o tratamento central.
    } finally {
      if (montado.current) setTutoresCarregando(false);
    }
  }

  const buscar = useCallback(async ({ emSegundoPlano = false } = {}) => {
    const vigente = novaRequisicao();
    if (!emSegundoPlano) {
      setCarregando(true);
      setErro('');
    }
    try {
      const lista = await listarEstudantes({ turmaId: filtroRef.current || undefined });
      if (vigente()) {
        setEstudantes(ordenar(lista.map(camposExibidos)));
        if (emSegundoPlano) setErro('');
      }
    } catch (falha) {
      // Em segundo plano (404 ou 409 concorrente), a lista atual continua na tela.
      if (emSegundoPlano) return;
      if (vigente() && exibirFalha(falha)) {
        setErro(mensagemErroCarga(falha, MENSAGEM_GENERICA_LISTA));
      }
    } finally {
      if (!emSegundoPlano && vigente()) {
        setCarregando(false);
      }
    }
  }, [novaRequisicao]);

  const carregar = useCallback(() => buscar(), [buscar]);
  const recarregarEmSegundoPlano = useCallback(() => buscar({ emSegundoPlano: true }), [buscar]);

  useEffect(() => {
    carregarOpcoes();
  }, [carregarOpcoes]);

  useEffect(() => {
    filtroRef.current = filtro;
    carregar();
  }, [filtro, carregar]);

  function aoFiltrar(evento) {
    setConfirmacao('');
    setFiltro(evento.target.value);
  }

  /** Indica se o estudante fica fora da lista por causa do filtro de turma ativo. */
  function foraDoFiltro(estudante) {
    return Boolean(filtroRef.current) && String(estudante.turma?.id) !== filtroRef.current;
  }

  function avisoFiltro(estudante) {
    return ` Ele está na turma ${rotuloTurma(estudante.turma)} e não aparece com o filtro atual.`;
  }

  // Insere o estudante devolvido pelo POST sem nova chamada à API,
  // respeitando o filtro de turma e a ordem por nome.
  const aoCadastrar = (novo, enviado) => {
    if (!novo || novo.id === undefined) {
      carregar();
      setConfirmacao(`Estudante ${enviado?.nomeCompleto ?? ''} cadastrado com sucesso.`);
      return;
    }
    const item = camposExibidos(novo);
    let mensagem = `Estudante ${item.nomeCompleto} cadastrado com sucesso.`;
    if (foraDoFiltro(item)) {
      mensagem += avisoFiltro(item);
    } else {
      setEstudantes((atual) => ordenar([...atual.filter((e) => e.id !== item.id), item]));
    }
    setConfirmacao(mensagem);
  };

  function abrirEdicao(item) {
    setConfirmacao('');
    setEmEdicao(item);
  }

  function fecharEdicao() {
    setEmEdicao(null);
  }

  const idEmEdicao = emEdicao?.id;
  // Se o botão "Editar" não existe mais (o estudante saiu da lista filtrada),
  // o foco vai para o título da lista.
  const restaurarFoco = useCallback(() => {
    const botao =
      idEmEdicao !== undefined ? document.getElementById(idBotaoEditarEstudante(idEmEdicao)) : null;
    (botao ?? document.getElementById(ID_TITULO_LISTA))?.focus();
  }, [idEmEdicao]);

  // Atualiza a linha com o retorno do PUT (sem nova chamada à API). Se o
  // estudante foi para outra turma e há filtro, ele sai da lista.
  function aoSalvarEdicao(atualizado) {
    if (!atualizado || atualizado.id === undefined) {
      setEmEdicao(null);
      recarregarEmSegundoPlano();
      setConfirmacao('Estudante atualizado com sucesso.');
      return;
    }
    const item = camposExibidos(atualizado);
    let mensagem = `Estudante ${item.nomeCompleto} atualizado com sucesso.`;
    if (foraDoFiltro(item)) {
      setEstudantes((atual) => atual.filter((e) => e.id !== item.id));
      mensagem += avisoFiltro(item);
    } else {
      setEstudantes((atual) => ordenar(atual.map((e) => (e.id === item.id ? item : e))));
    }
    setEmEdicao(null);
    setConfirmacao(mensagem);
  }

  function conteudoCadastro() {
    if (opcoesCarregando) {
      return (
        <p className="texto-secundario" role="status">
          Carregando turmas e tutores...
        </p>
      );
    }
    if (opcoesErro) {
      return (
        <div className="mensagem mensagem--erro" role="alert">
          <p>{opcoesErro}</p>
          <button type="button" className="botao botao--secundario" onClick={carregarOpcoes}>
            Tentar novamente
          </button>
        </div>
      );
    }
    if (turmas.length === 0) {
      return (
        <p className="texto-secundario">
          Nenhuma turma cadastrada. Cadastre uma turma em <Link to="/turmas">Turmas</Link> antes de
          cadastrar estudantes.
        </p>
      );
    }
    return (
      <>
        {tutoresIndisponiveis && (
          <div className="mensagem mensagem--aviso" role="status">
            <p>{AVISO_TUTORES_INDISPONIVEIS}</p>
            <button
              type="button"
              className="botao botao--secundario"
              onClick={recarregarTutores}
              aria-disabled={tutoresCarregando || undefined}
            >
              {tutoresCarregando ? 'Carregando...' : 'Carregar a lista de tutores'}
            </button>
          </div>
        )}
        <FormularioEstudante turmas={turmas} tutores={tutores} aoCadastrar={aoCadastrar} />
      </>
    );
  }

  const anoAtual = anoLetivoAtual();
  const turmasDoFiltro = filtrarTurmasPorAnoLetivo(turmas, {
    mostrarAnteriores: mostrarTurmasAnteriores,
    idsMantidos: [filtro],
    anoAtual,
  });

  return (
    <div className="pagina-usuarios pagina-estudantes">
      <h1>Estudantes</h1>
      <p className="texto-secundario">
        Cadastre e edite os estudantes, a turma de cada um e o professor tutor.
      </p>

      <div className="pagina-usuarios__grade">
        <section className="cartao" aria-labelledby="titulo-cadastrar-estudante">
          <h2 id="titulo-cadastrar-estudante">Cadastrar estudante</h2>
          {conteudoCadastro()}
        </section>

        <section className="cartao" aria-labelledby={ID_TITULO_LISTA}>
          <h2 id={ID_TITULO_LISTA} tabIndex={-1}>
            Estudantes cadastrados
          </h2>
          <p className="texto-secundario">
            Estudantes não são excluídos: para mudar nome, código, turma ou tutor, use
            &quot;Editar&quot;. Quando o tutor aparece como bloqueado ou desativado, use
            &quot;Editar&quot; para escolher outro tutor ou &quot;Sem tutor&quot;.
          </p>

          {turmas.length > 0 && (
            <div className="campo filtro-estudantes">
              <label htmlFor={ID_FILTRO}>Filtrar por turma</label>
              <select id={ID_FILTRO} name="filtroTurma" value={filtro} onChange={aoFiltrar}>
                <option value="">Todas as turmas</option>
                {turmasDoFiltro.map((turma) => (
                  <option key={turma.id} value={String(turma.id)}>
                    {rotuloTurma(turma)}
                  </option>
                ))}
              </select>
              {/* Sem turma de ano anterior, a caixa não teria efeito: não aparece. */}
              {temTurmasAnteriores(turmas, anoAtual) && (
                <OpcaoTurmasAnteriores
                  id="filtro-mostrarTurmasAnteriores"
                  marcado={mostrarTurmasAnteriores}
                  aoAlterar={setMostrarTurmasAnteriores}
                  anoAtual={anoAtual}
                />
              )}
            </div>
          )}

          <div role="status" aria-live="polite">
            {confirmacao && <p className="mensagem mensagem--sucesso">{confirmacao}</p>}
          </div>
          <ListaEstudantes
            estudantes={estudantes}
            carregando={carregando}
            erro={erro}
            filtrada={Boolean(filtro)}
            aoTentarNovamente={carregar}
            aoEditar={abrirEdicao}
          />
        </section>
      </div>

      {emEdicao && (
        <FormularioEdicaoEstudante
          estudante={emEdicao}
          turmas={turmas}
          tutores={tutores}
          aoSalvar={aoSalvarEdicao}
          aoCancelar={fecharEdicao}
          aoRestaurarFoco={restaurarFoco}
          aoListaDesatualizada={recarregarEmSegundoPlano}
        />
      )}
    </div>
  );
}
