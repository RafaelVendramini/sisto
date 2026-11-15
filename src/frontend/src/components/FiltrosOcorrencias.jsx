import { useEffect, useId, useRef, useState } from 'react';
import { listarEstudantes } from '../services/estudantes.js';
import {
  FILTROS_VAZIOS,
  contarFiltrosAtivos,
  periodoInvalido,
} from '../services/filtrosOcorrencias.js';
import { rotuloTurma } from '../services/mensagensEstudantes.js';
import { MENSAGEM_PERIODO_INVALIDO, STATUS_OCORRENCIA } from '../services/mensagensOcorrencias.js';
import { rotuloPerfil } from '../services/perfis.js';

// Telas a partir de 600px (mesmo ponto de quebra do CSS) abrem com os filtros
// à mostra; no celular eles começam recolhidos (RNF01).
const CONSULTA_TELA_LARGA = '(min-width: 600px)';

function telaLarga() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia(CONSULTA_TELA_LARGA).matches;
}

function ordenarPorNome(estudantes) {
  return [...estudantes].sort((a, b) =>
    String(a.nomeCompleto ?? '').localeCompare(String(b.nomeCompleto ?? ''), 'pt-BR'),
  );
}

/**
 * Opção para um valor escolhido que não está na lista (lista que não carregou
 * ou id que veio da URL): o select mostra que há um filtro, em vez de fingir
 * "Todos".
 */
function OpcaoAusente({ valor, lista, texto }) {
  if (!valor || lista.some((item) => String(item.id) === valor)) return null;
  return <option value={valor}>{texto}</option>;
}

/**
 * Formulário de filtros da lista de ocorrências (RF11, UC03 — Issue #87).
 * Os campos editados só valem ao tocar em "Filtrar"; "Limpar filtros" volta
 * à lista sem filtros. O estudante é escolhido por turma e depois por nome:
 * a "Turma do estudante" é um seletor auxiliar, independente do filtro
 * "Turma da ocorrência" (turma de referência — RN14). Para quem não é Gestão,
 * a lista de estudantes vem com dados reduzidos (RN20); aqui só o nome é usado.
 * O filtro de profissional só aparece quando `profissionais` é uma lista
 * (Gestão); esconder é só usabilidade, a proteção real é do back-end (RN19).
 * Uma lista de apoio que não carregou não remove os demais filtros.
 */
export default function FiltrosOcorrencias({
  filtrosAplicados,
  turmas,
  categorias,
  profissionais,
  falhas,
  aoFiltrar,
  aoLimpar,
}) {
  const id = useId();
  const idPainel = `${id}-painel`;
  const campoId = (nome) => `${id}-${nome}`;

  const [aberto, setAberto] = useState(telaLarga);
  const [dados, setDados] = useState(filtrosAplicados);
  const [erroPeriodo, setErroPeriodo] = useState('');

  const [estudantes, setEstudantes] = useState([]);
  const [estudantesCarregando, setEstudantesCarregando] = useState(false);
  const [estudantesFalhou, setEstudantesFalhou] = useState(false);

  const refDataInicio = useRef(null);

  // A URL manda: ao mudar (Filtrar, Limpar, página, voltar do detalhe), o
  // formulário mostra os filtros aplicados.
  useEffect(() => {
    setDados(filtrosAplicados);
    setErroPeriodo('');
  }, [filtrosAplicados]);

  // Estudantes da turma auxiliar, em ordem de nome.
  const turmaEstudante = dados.turmaEstudanteId;
  useEffect(() => {
    if (!turmaEstudante) {
      setEstudantes([]);
      setEstudantesFalhou(false);
      setEstudantesCarregando(false);
      return undefined;
    }
    let ativo = true;
    setEstudantesCarregando(true);
    setEstudantesFalhou(false);
    listarEstudantes({ turmaId: turmaEstudante })
      .then((lista) => {
        if (ativo) setEstudantes(ordenarPorNome(lista));
      })
      .catch(() => {
        if (ativo) {
          setEstudantes([]);
          setEstudantesFalhou(true);
        }
      })
      .finally(() => {
        if (ativo) setEstudantesCarregando(false);
      });
    return () => {
      ativo = false;
    };
  }, [turmaEstudante]);

  function alterar(campo) {
    return (evento) => {
      const valor = evento.target.value;
      setDados((atuais) => {
        const novos = { ...atuais, [campo]: valor };
        // Trocar a turma do estudante desfaz a escolha do estudante.
        if (campo === 'turmaEstudanteId') novos.estudanteId = '';
        return novos;
      });
      if (campo === 'dataInicio' || campo === 'dataFim') setErroPeriodo('');
    };
  }

  function aoEnviar(evento) {
    evento.preventDefault();
    if (periodoInvalido(dados)) {
      setErroPeriodo(MENSAGEM_PERIODO_INVALIDO);
      refDataInicio.current?.focus();
      return;
    }
    setErroPeriodo('');
    aoFiltrar(dados);
  }

  function limpar() {
    setDados(FILTROS_VAZIOS);
    setErroPeriodo('');
    aoLimpar();
  }

  const ativos = contarFiltrosAtivos(filtrosAplicados);
  const textoAtivos =
    ativos === 0 ? '' : ativos === 1 ? ' (1 aplicado)' : ` (${ativos} aplicados)`;

  const idErroPeriodo = campoId('periodo-erro');
  const propsData = {
    'aria-invalid': erroPeriodo ? true : undefined,
    'aria-describedby': erroPeriodo ? idErroPeriodo : undefined,
  };

  function ajudaFalha(nome, texto) {
    if (!falhas?.[nome]) return null;
    return (
      <span id={campoId(`${nome}-falha`)} className="campo__erro">
        {texto}
      </span>
    );
  }

  const descricaoFalha = (nome) => (falhas?.[nome] ? campoId(`${nome}-falha`) : undefined);

  let ajudaEstudante = 'Escolha primeiro a turma do estudante.';
  if (turmaEstudante) {
    if (estudantesCarregando) ajudaEstudante = 'Carregando estudantes...';
    else if (estudantesFalhou) ajudaEstudante = '';
    else if (estudantes.length === 0) ajudaEstudante = 'Nenhum estudante nesta turma.';
    else ajudaEstudante = '';
  }
  const idAjudaEstudante = campoId('estudanteId-ajuda');
  const idFalhaEstudantes = campoId('estudantes-falha');

  return (
    <section className="filtros-ocorrencias" aria-label="Filtros">
      <button
        type="button"
        className="botao botao--secundario filtros-ocorrencias__alternar"
        aria-expanded={aberto}
        aria-controls={aberto ? idPainel : undefined}
        onClick={() => setAberto((valor) => !valor)}
      >
        {aberto ? 'Ocultar filtros' : 'Mostrar filtros'}
        {textoAtivos}
      </button>

      {aberto && (
        <form
          id={idPainel}
          className="filtros-ocorrencias__painel"
          onSubmit={aoEnviar}
          noValidate
          aria-label="Filtrar ocorrências"
        >
          <div className="filtros-ocorrencias__campos">
            <div className="campo">
              <label htmlFor={campoId('turmaId')}>Turma da ocorrência</label>
              <select
                id={campoId('turmaId')}
                value={dados.turmaId}
                onChange={alterar('turmaId')}
                aria-describedby={descricaoFalha('turmas')}
              >
                <option value="">Todas as turmas</option>
                {turmas.map((turma) => (
                  <option key={turma.id} value={String(turma.id)}>
                    {rotuloTurma(turma)}
                  </option>
                ))}
                <OpcaoAusente valor={dados.turmaId} lista={turmas} texto="Turma escolhida" />
              </select>
              {ajudaFalha('turmas', 'Não foi possível carregar as turmas. Os outros filtros continuam disponíveis.')}
            </div>

            <div className="campo">
              <label htmlFor={campoId('categoriaId')}>Categoria</label>
              <select
                id={campoId('categoriaId')}
                value={dados.categoriaId}
                onChange={alterar('categoriaId')}
                aria-describedby={descricaoFalha('categorias')}
              >
                <option value="">Todas as categorias</option>
                {categorias.map((categoria) => (
                  <option key={categoria.id} value={String(categoria.id)}>
                    {categoria.nome}
                  </option>
                ))}
                <OpcaoAusente
                  valor={dados.categoriaId}
                  lista={categorias}
                  texto="Categoria escolhida"
                />
              </select>
              {ajudaFalha(
                'categorias',
                'Não foi possível carregar as categorias. Os outros filtros continuam disponíveis.',
              )}
            </div>

            <div className="campo">
              <label htmlFor={campoId('status')}>Status</label>
              <select id={campoId('status')} value={dados.status} onChange={alterar('status')}>
                <option value="">Todos os status</option>
                {STATUS_OCORRENCIA.map((status) => (
                  <option key={status.valor} value={status.valor}>
                    {status.rotulo}
                  </option>
                ))}
              </select>
            </div>

            <fieldset className="filtros-ocorrencias__grupo">
              <legend>Estudante</legend>
              <div className="campo">
                <label htmlFor={campoId('turmaEstudanteId')}>Turma do estudante</label>
                <select
                  id={campoId('turmaEstudanteId')}
                  value={dados.turmaEstudanteId}
                  onChange={alterar('turmaEstudanteId')}
                  aria-describedby={[campoId('turmaEstudanteId-ajuda'), descricaoFalha('turmas')]
                    .filter(Boolean)
                    .join(' ')}
                >
                  <option value="">Selecione a turma</option>
                  {turmas.map((turma) => (
                    <option key={turma.id} value={String(turma.id)}>
                      {rotuloTurma(turma)}
                    </option>
                  ))}
                  <OpcaoAusente
                    valor={dados.turmaEstudanteId}
                    lista={turmas}
                    texto="Turma escolhida"
                  />
                </select>
                <span id={campoId('turmaEstudanteId-ajuda')} className="campo__ajuda">
                  Serve só para encontrar o estudante; não filtra a lista.
                </span>
              </div>

              <div className="campo">
                <label htmlFor={campoId('estudanteId')}>Nome do estudante</label>
                <select
                  id={campoId('estudanteId')}
                  value={dados.estudanteId}
                  onChange={alterar('estudanteId')}
                  disabled={!turmaEstudante && !dados.estudanteId}
                  aria-describedby={
                    [ajudaEstudante ? idAjudaEstudante : '', estudantesFalhou ? idFalhaEstudantes : '']
                      .filter(Boolean)
                      .join(' ') || undefined
                  }
                >
                  <option value="">Todos os estudantes</option>
                  {estudantes.map((estudante) => (
                    <option key={estudante.id} value={String(estudante.id)}>
                      {estudante.nomeCompleto}
                    </option>
                  ))}
                  {!estudantesCarregando && (
                    <OpcaoAusente
                      valor={dados.estudanteId}
                      lista={estudantes}
                      texto="Estudante escolhido"
                    />
                  )}
                </select>
                {ajudaEstudante && (
                  <span id={idAjudaEstudante} className="campo__ajuda">
                    {ajudaEstudante}
                  </span>
                )}
                {estudantesFalhou && (
                  <span id={idFalhaEstudantes} className="campo__erro">
                    Não foi possível carregar os estudantes desta turma. Os outros filtros
                    continuam disponíveis.
                  </span>
                )}
              </div>
            </fieldset>

            <fieldset className="filtros-ocorrencias__grupo">
              <legend>Período do fato</legend>
              <div className="filtros-ocorrencias__periodo">
                <div className="campo">
                  <label htmlFor={campoId('dataInicio')}>De</label>
                  <input
                    ref={refDataInicio}
                    id={campoId('dataInicio')}
                    type="date"
                    value={dados.dataInicio}
                    onChange={alterar('dataInicio')}
                    {...propsData}
                  />
                </div>
                <div className="campo">
                  <label htmlFor={campoId('dataFim')}>Até</label>
                  <input
                    id={campoId('dataFim')}
                    type="date"
                    value={dados.dataFim}
                    onChange={alterar('dataFim')}
                    {...propsData}
                  />
                </div>
              </div>
              {erroPeriodo && (
                <span id={idErroPeriodo} className="campo__erro" role="alert">
                  {erroPeriodo}
                </span>
              )}
            </fieldset>

            {profissionais && (
              <div className="campo">
                <label htmlFor={campoId('profissionalResponsavelId')}>
                  Profissional responsável (quem registrou)
                </label>
                <select
                  id={campoId('profissionalResponsavelId')}
                  value={dados.profissionalResponsavelId}
                  onChange={alterar('profissionalResponsavelId')}
                  aria-describedby={descricaoFalha('profissionais')}
                >
                  <option value="">Todos os profissionais</option>
                  {profissionais.map((usuario) => (
                    <option key={usuario.id} value={String(usuario.id)}>
                      {rotuloPerfil(usuario.perfil)
                        ? `${usuario.nome} (${rotuloPerfil(usuario.perfil)})`
                        : usuario.nome}
                    </option>
                  ))}
                  <OpcaoAusente
                    valor={dados.profissionalResponsavelId}
                    lista={profissionais}
                    texto="Profissional escolhido"
                  />
                </select>
                {ajudaFalha(
                  'profissionais',
                  'Não foi possível carregar os profissionais. Os outros filtros continuam disponíveis.',
                )}
              </div>
            )}
          </div>

          <div className="filtros-ocorrencias__acoes">
            <button type="submit" className="botao botao--primario">
              Filtrar
            </button>
            <button type="button" className="botao botao--secundario" onClick={limpar}>
              Limpar filtros
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
