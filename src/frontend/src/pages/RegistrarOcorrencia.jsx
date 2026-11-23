import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import ListaDestinatarios, {
  CAMPOS_DESTINATARIO,
  idCampoDestinatario,
} from '../components/ListaDestinatarios.jsx';
import OpcaoTurmasAnteriores from '../components/OpcaoTurmasAnteriores.jsx';
import SelecaoEstudantes from '../components/SelecaoEstudantes.jsx';
import { useTituloPagina } from '../components/useTituloPagina.js';
import { listarCategorias } from '../services/categorias.js';
import { MENSAGEM_SEM_CONEXAO, MENSAGEM_SEM_PERMISSAO } from '../services/mensagens.js';
import { rotuloTurma } from '../services/mensagensEstudantes.js';
import {
  MAXIMO_DESTINATARIOS,
  MENSAGEM_REVISAR_CAMPOS,
  ORIENTACAO_REDACAO,
  TAMANHO_MAXIMO_LOCAL,
  TAMANHO_MAXIMO_TEXTO_LONGO,
  agoraNoFusoDaEscola,
  mensagemErroRegistro,
  mensagemOcorrenciaRegistrada,
  montarEnvio,
  separarUsuariosPorDestinatario,
  validarRegistro,
} from '../services/mensagensOcorrencias.js';
import { registrarOcorrencia } from '../services/ocorrencias.js';
import { listarTurmas } from '../services/turmas.js';
import { anoLetivoAtual, filtrarTurmasPorAnoLetivo } from '../services/turmasAnoLetivo.js';
import { listarUsuarios } from '../services/usuarios.js';

const MENSAGEM_GENERICA_OPCOES =
  'Não foi possível carregar as turmas, as categorias e os destinatários agora.';
const ID_SUCESSO = 'ocorrencia-sucesso';

// Ordem dos campos na tela (UC01), usada para focar o primeiro com erro.
// "estudantes" leva o foco ao filtro de turma da lista de estudantes.
const CAMPOS_FORMULARIO = Object.freeze([
  'turmaId',
  'estudantes',
  'categoriaId',
  'descricao',
  'dataHora',
  'local',
  'demaisEnvolvidos',
  'testemunhas',
  'providenciasImediatas',
  'observacoes',
]);

// Campos opcionais de texto longo (UC01 passo 6 e observações).
const CAMPOS_OPCIONAIS = Object.freeze([
  { campo: 'demaisEnvolvidos', rotulo: 'Demais envolvidos (opcional)', ajuda: 'Outras pessoas envolvidas no fato.' },
  { campo: 'testemunhas', rotulo: 'Testemunhas (opcional)', ajuda: 'Quem presenciou o fato.' },
  { campo: 'providenciasImediatas', rotulo: 'Providências imediatas (opcional)', ajuda: 'O que já foi feito no momento.' },
  { campo: 'observacoes', rotulo: 'Observações (opcional)', ajuda: '' },
]);

function mensagemErroCarga(falha) {
  if (falha?.status === 403) return MENSAGEM_SEM_PERMISSAO;
  if (falha?.status === 0) return MENSAGEM_SEM_CONEXAO;
  return MENSAGEM_GENERICA_OPCOES;
}

/** Formulário vazio; a data e a hora sugeridas são as de agora em São Paulo (RN17). */
function dadosVazios() {
  return {
    turmaId: '',
    categoriaId: '',
    descricao: '',
    dataHora: agoraNoFusoDaEscola(),
    local: '',
    demaisEnvolvidos: '',
    testemunhas: '',
    providenciasImediatas: '',
    observacoes: '',
  };
}

function destinatarioVazio(chave) {
  return { chave, destinatarioPerfil: '', destinatarioUsuarioId: '', observacao: '' };
}

function semErro(erros, campo) {
  if (!erros[campo]) return erros;
  const { [campo]: _removido, ...restantes } = erros;
  return restantes;
}

// Registrar ocorrência (UC01, RF05, RF06, RN02, RN03, RN06, RN14, RN17).
// Disponível aos 5 perfis. O profissional responsável é o usuário logado,
// definido pelo back-end (RN02). Após o registro, leva ao detalhe da
// ocorrência criada (#48), que mostra "Ocorrência nº X registrada com
// sucesso." no topo. Se a resposta vier sem id (não previsto no contrato),
// fica na tela: mostra a confirmação e limpa o formulário.
export default function RegistrarOcorrencia() {
  useTituloPagina('Registrar ocorrência');
  const navigate = useNavigate();
  const [turmas, setTurmas] = useState([]);
  const [categorias, setCategorias] = useState([]);
  const [usuariosPorDestinatario, setUsuariosPorDestinatario] = useState(() =>
    separarUsuariosPorDestinatario([]),
  );
  const [opcoesCarregando, setOpcoesCarregando] = useState(true);
  const [opcoesErro, setOpcoesErro] = useState('');

  const [dados, setDados] = useState(dadosVazios);
  const [filtroTurma, setFiltroTurma] = useState('');
  // Enquanto o usuário não troca o filtro, ele acompanha a turma da ocorrência.
  const [filtroManual, setFiltroManual] = useState(false);
  const [estudantes, setEstudantes] = useState([]);
  // Por padrão, só as turmas do ano letivo atual em diante (SSD 1.13, Issue #134).
  const [mostrarTurmasAnteriores, setMostrarTurmasAnteriores] = useState(false);
  const proximaChave = useRef(2);
  const [destinatarios, setDestinatarios] = useState(() => [destinatarioVazio(1)]);

  const [erros, setErros] = useState({});
  const [errosDestinatarios, setErrosDestinatarios] = useState({});
  const [erro, setErro] = useState('');
  const [sucesso, setSucesso] = useState('');
  const [enviando, setEnviando] = useState(false);
  // Trava síncrona contra duplo envio (o estado só muda no próximo render).
  const enviandoRef = useRef(false);

  const montado = useRef(true);
  const refFiltro = useRef(null);
  const refSucesso = useRef(null);

  useEffect(() => {
    montado.current = true;
    return () => {
      montado.current = false;
    };
  }, []);

  const carregarOpcoes = useCallback(async () => {
    setOpcoesCarregando(true);
    setOpcoesErro('');
    try {
      const [listaTurmas, listaCategorias, usuarios] = await Promise.all([
        listarTurmas(),
        listarCategorias(),
        listarUsuarios(),
      ]);
      if (!montado.current) return;
      setTurmas(listaTurmas);
      setCategorias(listaCategorias);
      setUsuariosPorDestinatario(separarUsuariosPorDestinatario(usuarios));
    } catch (falha) {
      // 401: o tratamento central já leva ao login com aviso.
      if (montado.current && falha?.status !== 401) setOpcoesErro(mensagemErroCarga(falha));
    } finally {
      if (montado.current) setOpcoesCarregando(false);
    }
  }, []);

  useEffect(() => {
    carregarOpcoes();
  }, [carregarOpcoes]);

  useEffect(() => {
    if (sucesso) refSucesso.current?.focus();
  }, [sucesso]);

  function limparMensagens() {
    setErro('');
    setSucesso('');
  }

  function alterar(campo) {
    return (evento) => {
      if (enviandoRef.current) return;
      const { value } = evento.target;
      limparMensagens();
      setDados((atual) => ({ ...atual, [campo]: value }));
      setErros((atual) => semErro(atual, campo));
      if (campo === 'turmaId' && !filtroManual) setFiltroTurma(value);
    };
  }

  function alterarFiltro(valor) {
    if (enviandoRef.current) return;
    setFiltroManual(true);
    setFiltroTurma(valor);
  }

  function alterarMostrarTurmasAnteriores(marcado) {
    if (enviandoRef.current) return;
    setMostrarTurmasAnteriores(marcado);
  }

  function alternarEstudante(estudante) {
    if (enviandoRef.current) return;
    limparMensagens();
    setErros((atual) => semErro(atual, 'estudantes'));
    setEstudantes((atual) =>
      atual.some((e) => e.id === estudante.id)
        ? atual.filter((e) => e.id !== estudante.id)
        : [...atual, estudante],
    );
  }

  function removerEstudante(id) {
    if (enviandoRef.current) return;
    limparMensagens();
    setEstudantes((atual) => atual.filter((e) => e.id !== id));
  }

  function alterarDestinatario(chave, campo, valor) {
    if (enviandoRef.current) return;
    limparMensagens();
    setDestinatarios((atual) =>
      atual.map((d) => {
        if (d.chave !== chave) return d;
        // Ao trocar o tipo, o usuário escolhido deixa de valer.
        if (campo === 'destinatarioPerfil') {
          return { ...d, destinatarioPerfil: valor, destinatarioUsuarioId: '' };
        }
        return { ...d, [campo]: valor };
      }),
    );
    // A repetição depende de todas as linhas: limpa os erros de usuário de todas.
    setErrosDestinatarios((atual) => {
      const novo = {};
      for (const [chaveLinha, errosLinha] of Object.entries(atual)) {
        let restantes = errosLinha;
        if (Number(chaveLinha) === chave) restantes = semErro(restantes, campo);
        if (campo !== 'observacao') restantes = semErro(restantes, 'destinatarioUsuarioId');
        if (Object.keys(restantes).length > 0) novo[chaveLinha] = restantes;
      }
      return novo;
    });
  }

  function adicionarDestinatario() {
    if (enviandoRef.current || destinatarios.length >= MAXIMO_DESTINATARIOS) return;
    limparMensagens();
    const chave = proximaChave.current++;
    setDestinatarios((atual) => [...atual, destinatarioVazio(chave)]);
    setErros((atual) => semErro(atual, 'destinatarios'));
  }

  function removerDestinatario(chave) {
    if (enviandoRef.current) return;
    limparMensagens();
    setDestinatarios((atual) => atual.filter((d) => d.chave !== chave));
    // A repetição e a numeração dependem de todas as linhas: além dos erros da
    // linha removida, limpa os erros de usuário das demais (como ao alterar).
    setErrosDestinatarios((atual) => {
      const novo = {};
      for (const [chaveLinha, errosLinha] of Object.entries(atual)) {
        if (Number(chaveLinha) === chave) continue;
        const restantes = semErro(errosLinha, 'destinatarioUsuarioId');
        if (Object.keys(restantes).length > 0) novo[chaveLinha] = restantes;
      }
      return novo;
    });
  }

  function focarPrimeiroInvalido(novosErros, novosErrosDestinatarios) {
    const campo = CAMPOS_FORMULARIO.find((nome) => novosErros[nome]);
    if (campo === 'estudantes') {
      refFiltro.current?.focus();
      return;
    }
    if (campo) {
      document.getElementById(`ocorrencia-${campo}`)?.focus();
      return;
    }
    for (const destinatario of destinatarios) {
      const errosLinha = novosErrosDestinatarios[destinatario.chave];
      const campoLinha = errosLinha && CAMPOS_DESTINATARIO.find((nome) => errosLinha[nome]);
      if (campoLinha) {
        document.getElementById(idCampoDestinatario(destinatario.chave, campoLinha))?.focus();
        return;
      }
    }
    if (novosErros.destinatarios) document.getElementById('destinatarios-adicionar')?.focus();
  }

  function limparFormulario() {
    setDados(dadosVazios());
    setFiltroTurma('');
    setFiltroManual(false);
    setEstudantes([]);
    const chave = proximaChave.current++;
    setDestinatarios([destinatarioVazio(chave)]);
    setErros({});
    setErrosDestinatarios({});
  }

  async function aoEnviar(evento) {
    evento.preventDefault();
    if (enviandoRef.current) return;

    limparMensagens();
    const validacao = validarRegistro(dados, estudantes, destinatarios);
    setErros(validacao.erros);
    setErrosDestinatarios(validacao.errosDestinatarios);
    if (
      Object.keys(validacao.erros).length > 0 ||
      Object.keys(validacao.errosDestinatarios).length > 0
    ) {
      setErro(MENSAGEM_REVISAR_CAMPOS);
      focarPrimeiroInvalido(validacao.erros, validacao.errosDestinatarios);
      return;
    }

    enviandoRef.current = true;
    setEnviando(true);
    try {
      const criada = await registrarOcorrencia(montarEnvio(dados, estudantes, destinatarios));
      if (!montado.current) return;
      if (criada?.id !== undefined && criada?.id !== null) {
        navigate(`/ocorrencias/${criada.id}`, { state: { ocorrenciaRegistrada: criada.id } });
        return;
      }
      limparFormulario();
      setSucesso(mensagemOcorrenciaRegistrada(criada?.id));
    } catch (falha) {
      if (falha?.status === 401) return; // tratamento central: volta ao login com aviso
      if (montado.current) setErro(mensagemErroRegistro(falha));
    } finally {
      enviandoRef.current = false;
      if (montado.current) setEnviando(false);
    }
  }

  function propsAcessibilidade(campo, { comAjuda = true } = {}) {
    const descricoes = [
      comAjuda ? `ocorrencia-${campo}-ajuda` : null,
      erros[campo] ? `ocorrencia-${campo}-erro` : null,
    ].filter(Boolean);
    return {
      id: `ocorrencia-${campo}`,
      name: campo,
      'aria-invalid': Boolean(erros[campo]),
      'aria-describedby': descricoes.length ? descricoes.join(' ') : undefined,
    };
  }

  function mensagemCampo(campo) {
    return (
      erros[campo] && (
        <span id={`ocorrencia-${campo}-erro`} className="campo__erro">
          {erros[campo]}
        </span>
      )
    );
  }

  function formulario() {
    const anoAtual = anoLetivoAtual();
    // A turma da ocorrência e a do filtro de estudantes, se já escolhidas,
    // continuam nas listas mesmo que sejam de um ano anterior.
    const turmasVisiveis = filtrarTurmasPorAnoLetivo(turmas, {
      mostrarAnteriores: mostrarTurmasAnteriores,
      idsMantidos: [dados.turmaId, filtroTurma],
      anoAtual,
    });
    return (
      <form
        className="formulario registro-ocorrencia"
        onSubmit={aoEnviar}
        noValidate
        aria-busy={enviando}
        aria-label="Registrar ocorrência"
      >
        <section className="registro-ocorrencia__secao" aria-labelledby="titulo-turma-estudantes">
          <h2 id="titulo-turma-estudantes">Turma e estudantes</h2>
          <OpcaoTurmasAnteriores
            id="ocorrencia-mostrarTurmasAnteriores"
            marcado={mostrarTurmasAnteriores}
            aoAlterar={alterarMostrarTurmasAnteriores}
            anoAtual={anoAtual}
            somenteLeitura={enviando}
          />
          <div className="campo">
            <label htmlFor="ocorrencia-turmaId">Turma da ocorrência</label>
            <select
              value={dados.turmaId}
              aria-disabled={enviando || undefined}
              onChange={alterar('turmaId')}
              {...propsAcessibilidade('turmaId')}
            >
              <option value="">Selecione a turma</option>
              {turmasVisiveis.map((turma) => (
                <option key={turma.id} value={String(turma.id)}>
                  {rotuloTurma(turma)}
                </option>
              ))}
            </select>
            <span id="ocorrencia-turmaId-ajuda" className="campo__ajuda">
              Obrigatório. É a turma de referência da ocorrência e fica registrada mesmo que um
              estudante mude de turma depois.
            </span>
            {mensagemCampo('turmaId')}
          </div>

          <SelecaoEstudantes
            turmas={turmasVisiveis}
            filtroTurma={filtroTurma}
            aoAlterarFiltro={alterarFiltro}
            turmaOcorrenciaId={dados.turmaId}
            selecionados={estudantes}
            aoAlternar={alternarEstudante}
            aoRemover={removerEstudante}
            erro={erros.estudantes}
            refFiltro={refFiltro}
            somenteLeitura={enviando}
          />
        </section>

        <section className="registro-ocorrencia__secao" aria-labelledby="titulo-fato">
          <h2 id="titulo-fato">O que aconteceu</h2>
          <div className="campo">
            <label htmlFor="ocorrencia-categoriaId">Categoria</label>
            <select
              value={dados.categoriaId}
              aria-disabled={enviando || undefined}
              onChange={alterar('categoriaId')}
              {...propsAcessibilidade('categoriaId')}
            >
              <option value="">Selecione a categoria</option>
              {categorias.map((categoria) => (
                <option key={categoria.id} value={String(categoria.id)}>
                  {categoria.nome}
                </option>
              ))}
            </select>
            <span id="ocorrencia-categoriaId-ajuda" className="campo__ajuda">
              {categorias.length === 0
                ? 'Nenhuma categoria cadastrada. Peça à Gestão ou à equipe pedagógica para cadastrar.'
                : 'Obrigatório.'}
            </span>
            {mensagemCampo('categoriaId')}
          </div>

          <div className="campo">
            <label htmlFor="ocorrencia-descricao">Descrição do fato</label>
            <p id="ocorrencia-descricao-orientacao" className="mensagem mensagem--aviso registro-ocorrencia__orientacao">
              {ORIENTACAO_REDACAO}
            </p>
            <textarea
              rows={6}
              maxLength={TAMANHO_MAXIMO_TEXTO_LONGO}
              value={dados.descricao}
              readOnly={enviando}
              onChange={alterar('descricao')}
              {...propsAcessibilidade('descricao')}
              aria-describedby={[
                'ocorrencia-descricao-orientacao',
                'ocorrencia-descricao-ajuda',
                erros.descricao ? 'ocorrencia-descricao-erro' : null,
              ]
                .filter(Boolean)
                .join(' ')}
            />
            <span id="ocorrencia-descricao-ajuda" className="campo__ajuda">
              Obrigatório. Até {TAMANHO_MAXIMO_TEXTO_LONGO} caracteres.
            </span>
            {mensagemCampo('descricao')}
          </div>

          <div className="registro-ocorrencia__linha">
            <div className="campo">
              <label htmlFor="ocorrencia-dataHora">Data e hora do fato</label>
              <input
                type="datetime-local"
                value={dados.dataHora}
                readOnly={enviando}
                onChange={alterar('dataHora')}
                {...propsAcessibilidade('dataHora')}
              />
              <span id="ocorrencia-dataHora-ajuda" className="campo__ajuda">
                Obrigatório. Horário de São Paulo. Já vem com a hora atual; ajuste se o fato
                aconteceu antes. Não pode ser no futuro.
              </span>
              {mensagemCampo('dataHora')}
            </div>

            <div className="campo">
              <label htmlFor="ocorrencia-local">Local</label>
              <input
                type="text"
                autoComplete="off"
                maxLength={TAMANHO_MAXIMO_LOCAL}
                value={dados.local}
                readOnly={enviando}
                onChange={alterar('local')}
                {...propsAcessibilidade('local')}
              />
              <span id="ocorrencia-local-ajuda" className="campo__ajuda">
                Obrigatório. Ex.: sala de aula, pátio, quadra. Até {TAMANHO_MAXIMO_LOCAL} caracteres.
              </span>
              {mensagemCampo('local')}
            </div>
          </div>
        </section>

        <section className="registro-ocorrencia__secao" aria-labelledby="titulo-complementos">
          <h2 id="titulo-complementos">Outras informações</h2>
          {CAMPOS_OPCIONAIS.map(({ campo, rotulo, ajuda }) => (
            <div key={campo} className="campo">
              <label htmlFor={`ocorrencia-${campo}`}>{rotulo}</label>
              <textarea
                rows={3}
                maxLength={TAMANHO_MAXIMO_TEXTO_LONGO}
                value={dados[campo]}
                readOnly={enviando}
                onChange={alterar(campo)}
                {...propsAcessibilidade(campo)}
              />
              <span id={`ocorrencia-${campo}-ajuda`} className="campo__ajuda">
                {ajuda ? `${ajuda} ` : ''}Até {TAMANHO_MAXIMO_TEXTO_LONGO} caracteres.
              </span>
              {mensagemCampo(campo)}
            </div>
          ))}
        </section>

        <section className="registro-ocorrencia__secao" aria-labelledby="titulo-destinatarios">
          <h2 id="titulo-destinatarios">Destinatários</h2>
          <p className="texto-secundario">
            Escolha ao menos um responsável interno para receber a ocorrência (tutor, equipe
            pedagógica ou gestão). O mesmo destinatário não pode ser repetido.
          </p>
          <ListaDestinatarios
            destinatarios={destinatarios}
            aoAlterar={alterarDestinatario}
            aoAdicionar={adicionarDestinatario}
            aoRemover={removerDestinatario}
            usuariosPorDestinatario={usuariosPorDestinatario}
            estudantesSelecionados={estudantes}
            erros={errosDestinatarios}
            erroGeral={erros.destinatarios}
            somenteLeitura={enviando}
          />
        </section>

        {erro && (
          <p className="mensagem mensagem--erro" role="alert">
            {erro}
          </p>
        )}

        <button
          type="submit"
          className="botao botao--primario registro-ocorrencia__enviar"
          disabled={enviando}
        >
          {enviando ? 'Registrando...' : 'Registrar ocorrência'}
        </button>
      </form>
    );
  }

  function conteudo() {
    if (opcoesCarregando) {
      return (
        <p className="texto-secundario" role="status">
          Carregando turmas, categorias e destinatários...
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
          Nenhuma turma cadastrada. Peça à Gestão para cadastrar as turmas antes de registrar
          ocorrências.
        </p>
      );
    }
    return formulario();
  }

  return (
    <div className="pagina-ocorrencia">
      <h1>Registrar ocorrência</h1>
      <p className="texto-secundario">
        Preencha os dados do fato. Os campos marcados como opcionais podem ficar em branco. Você
        fica registrado como o profissional responsável pelo registro.
      </p>

      <div role="status" aria-live="polite">
        {sucesso && (
          <p
            id={ID_SUCESSO}
            ref={refSucesso}
            tabIndex={-1}
            className="mensagem mensagem--sucesso"
          >
            {sucesso}
          </p>
        )}
      </div>

      <div className="cartao registro-ocorrencia__cartao">{conteudo()}</div>
    </div>
  );
}
