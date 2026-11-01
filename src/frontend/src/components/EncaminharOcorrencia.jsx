import { useCallback, useEffect, useRef, useState } from 'react';
import { listarEstudantes } from '../services/estudantes.js';
import { MENSAGEM_SEM_CONEXAO, MENSAGEM_SEM_PERMISSAO } from '../services/mensagens.js';
import {
  DESTINATARIOS,
  TAMANHO_MAXIMO_TEXTO_LONGO,
  agruparResponsaveis,
  agruparTutores,
  encaminhamentoPedeAtualizacao,
  mensagemErroEncaminhamento,
  montarEnvioEncaminhamento,
  separarUsuariosPorDestinatario,
  validarEncaminhamento,
} from '../services/mensagensOcorrencias.js';
import { encaminharOcorrencia } from '../services/ocorrencias.js';
import { listarUsuarios } from '../services/usuarios.js';
import Dialogo from './Dialogo.jsx';
import { OpcoesDeUsuarios, OpcoesEquipe, OpcoesTutores } from './OpcoesUsuarios.jsx';

const PREFIXO = 'encaminhamento';
const ID_DIALOGO = 'dialogo-encaminhar';

// Ordem dos campos na tela, usada para focar o primeiro com erro.
const ORDEM_CAMPOS = Object.freeze([
  'destinatarioPerfil',
  'destinatarioUsuarioId',
  'responsavelAcompanhamentoId',
  'observacao',
]);

const ROTULO_TUTORES_DA_OCORRENCIA = 'Tutores dos estudantes desta ocorrência';
const MENSAGEM_GENERICA_CARGA = 'Não foi possível carregar a lista de pessoas agora.';

function mensagemErroCarga(falha) {
  if (falha?.status === 403) return MENSAGEM_SEM_PERMISSAO;
  if (falha?.status === 0) return MENSAGEM_SEM_CONEXAO;
  return MENSAGEM_GENERICA_CARGA;
}

function idCampo(campo) {
  return `${PREFIXO}-${campo}`;
}

/**
 * Estudantes da ocorrência com o tutor ATUAL de cada um, para sugerir os
 * tutores (RN03). O detalhe da ocorrência não traz o tutor; ele vem do
 * GET /estudantes?turmaId= (permitido aos 5 perfis, com tutor { id, nome } —
 * RN20), uma chamada por turma dos estudantes. É só uma sugestão: se a
 * consulta falhar, os tutores aparecem num único grupo.
 */
async function estudantesComTutor(estudantes) {
  const turmas = [
    ...new Set((estudantes ?? []).map((e) => e?.turma?.id).filter((id) => id != null)),
  ];
  if (turmas.length === 0) return [];
  try {
    const listas = await Promise.all(turmas.map((turmaId) => listarEstudantes({ turmaId })));
    const tutorPorEstudante = new Map(listas.flat().map((e) => [e.id, e.tutor ?? null]));
    return estudantes.map((e) => ({ ...e, tutor: tutorPorEstudante.get(e.id) ?? null }));
  } catch {
    return [];
  }
}

function dadosVazios() {
  return {
    destinatarioPerfil: '',
    destinatarioUsuarioId: '',
    responsavelAcompanhamentoId: '',
    observacao: '',
  };
}

/**
 * Diálogo "Encaminhar ocorrência" (UC02, RF08, RN03, RN15). Só é aberto para
 * Gestão e Pedagógico em ocorrências não encerradas; a proteção real é do
 * back-end (403/409).
 * - Destinatário: Tutor exige escolher o tutor (os dos estudantes da
 *   ocorrência primeiro, sem pré-seleção); Equipe pedagógica e Gestão têm
 *   "Toda a equipe" como padrão.
 * - Responsável pelo acompanhamento (Tutor, Pedagógico ou Gestão ativos):
 *   obrigatório com a ocorrência "Aberto"; em "Em acompanhamento", a primeira
 *   opção mantém o atual (decisão do Rafael na #50) e o campo não vai no corpo.
 * - Sucesso: devolve ao detalhe a resposta 201 (detalhe completo).
 *
 * @param {object} props
 * @param {object} props.ocorrencia - detalhe atual (id, status, responsável, estudantes)
 * @param {(detalhe: object | null) => void} props.aoConcluir
 * @param {() => void} props.aoCancelar
 * @param {() => void} props.aoAtualizarOcorrencia - recarregar o detalhe (após 404/409)
 * @param {() => void} [props.aoRestaurarFoco]
 */
export default function EncaminharOcorrencia({
  ocorrencia,
  aoConcluir,
  aoCancelar,
  aoAtualizarOcorrencia,
  aoRestaurarFoco,
}) {
  const aberta = ocorrencia.status === 'ABERTO';

  const [carregando, setCarregando] = useState(true);
  const [erroCarga, setErroCarga] = useState('');
  const [usuariosPorDestinatario, setUsuariosPorDestinatario] = useState(() =>
    separarUsuariosPorDestinatario([]),
  );
  const [responsaveis, setResponsaveis] = useState(() => agruparResponsaveis([], []));
  const [tutoresDestinatario, setTutoresDestinatario] = useState({ sugeridos: [], outros: [] });

  const [dados, setDados] = useState(dadosVazios);
  const [erros, setErros] = useState({});
  const [erro, setErro] = useState('');
  const [pedeAtualizacao, setPedeAtualizacao] = useState(false);
  const [enviando, setEnviando] = useState(false);
  // Trava síncrona contra duplo envio (o estado só muda no próximo render).
  const enviandoRef = useRef(false);

  const montado = useRef(true);
  const refs = {
    destinatarioPerfil: useRef(null),
    destinatarioUsuarioId: useRef(null),
    responsavelAcompanhamentoId: useRef(null),
    observacao: useRef(null),
  };
  const refTentarNovamente = useRef(null);

  useEffect(() => {
    montado.current = true;
    return () => {
      montado.current = false;
    };
  }, []);

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErroCarga('');
    try {
      const [usuarios, estudantes] = await Promise.all([
        listarUsuarios(),
        estudantesComTutor(ocorrencia.estudantes),
      ]);
      if (!montado.current) return;
      const porTipo = separarUsuariosPorDestinatario(usuarios);
      setUsuariosPorDestinatario(porTipo);
      setTutoresDestinatario(agruparTutores(porTipo.TUTOR, estudantes));
      setResponsaveis(agruparResponsaveis(usuarios, estudantes));
    } catch (falha) {
      // 401: o tratamento central já leva ao login com aviso.
      if (montado.current && falha?.status !== 401) setErroCarga(mensagemErroCarga(falha));
    } finally {
      if (montado.current) setCarregando(false);
    }
  }, [ocorrencia.estudantes]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  // Ao terminar a carga: foco no primeiro campo (ou em "Tentar novamente").
  useEffect(() => {
    if (carregando) return;
    if (erroCarga) refTentarNovamente.current?.focus();
    else refs.destinatarioPerfil.current?.focus();
    // As refs são estáveis: o efeito reage só ao fim da carga.
  }, [carregando, erroCarga]);

  function alterar(campo) {
    return (evento) => {
      if (enviandoRef.current) return; // campos travados durante o envio
      const { value } = evento.target;
      setErro('');
      setPedeAtualizacao(false);
      setDados((atual) =>
        // Ao trocar o tipo, o usuário escolhido deixa de valer.
        campo === 'destinatarioPerfil'
          ? { ...atual, destinatarioPerfil: value, destinatarioUsuarioId: '' }
          : { ...atual, [campo]: value },
      );
      setErros((atual) => {
        const removidos =
          campo === 'destinatarioPerfil' ? [campo, 'destinatarioUsuarioId'] : [campo];
        if (!removidos.some((nome) => atual[nome])) return atual;
        const restantes = { ...atual };
        removidos.forEach((nome) => delete restantes[nome]);
        return restantes;
      });
    };
  }

  function focarPrimeiroInvalido(novosErros) {
    const campo = ORDEM_CAMPOS.find((nome) => novosErros[nome]);
    if (campo) refs[campo].current?.focus();
  }

  function cancelar() {
    if (enviandoRef.current) return;
    aoCancelar();
  }

  function atualizarOcorrencia() {
    if (enviandoRef.current) return;
    aoAtualizarOcorrencia();
  }

  async function aoEnviar(evento) {
    evento.preventDefault();
    if (enviandoRef.current) return;

    setErro('');
    setPedeAtualizacao(false);
    const novosErros = validarEncaminhamento(dados, ocorrencia.status);
    setErros(novosErros);
    if (Object.keys(novosErros).length > 0) {
      focarPrimeiroInvalido(novosErros);
      return;
    }

    enviandoRef.current = true;
    setEnviando(true);
    try {
      const detalhe = await encaminharOcorrencia(ocorrencia.id, montarEnvioEncaminhamento(dados));
      if (montado.current) aoConcluir(detalhe ?? null);
    } catch (falha) {
      enviandoRef.current = false;
      if (!montado.current) return;
      setEnviando(false);
      if (falha?.status === 401) return; // tratamento central: volta ao login com aviso
      setErro(mensagemErroEncaminhamento(falha));
      setPedeAtualizacao(encaminhamentoPedeAtualizacao(falha));
    }
  }

  function propsAcessibilidade(campo, { comAjuda = false } = {}) {
    const descricoes = [
      comAjuda ? idCampo(`${campo}-ajuda`) : null,
      erros[campo] ? idCampo(`${campo}-erro`) : null,
    ].filter(Boolean);
    return {
      id: idCampo(campo),
      name: campo,
      ref: refs[campo],
      'aria-invalid': Boolean(erros[campo]),
      'aria-describedby': descricoes.length ? descricoes.join(' ') : undefined,
    };
  }

  function mensagemCampo(campo) {
    return (
      erros[campo] && (
        <span id={idCampo(`${campo}-erro`)} className="campo__erro">
          {erros[campo]}
        </span>
      )
    );
  }

  function campoUsuarioDestinatario() {
    const { destinatarioPerfil } = dados;
    if (!destinatarioPerfil) return null;
    const ehTutor = destinatarioPerfil === 'TUTOR';
    const lista = usuariosPorDestinatario[destinatarioPerfil] ?? [];
    let ajuda;
    if (ehTutor) {
      ajuda =
        lista.length === 0
          ? 'Obrigatório. Nenhum tutor ativo cadastrado: escolha outro destinatário.'
          : 'Obrigatório. Só aparecem tutores com acesso ativo.';
    } else {
      ajuda = 'Opcional. Deixe "Toda a equipe" para encaminhar à equipe inteira.';
    }
    return (
      <div className="campo">
        <label htmlFor={idCampo('destinatarioUsuarioId')}>
          {ehTutor ? 'Tutor que vai receber' : 'Pessoa da equipe (opcional)'}
        </label>
        <select
          value={dados.destinatarioUsuarioId}
          aria-disabled={enviando || undefined}
          onChange={alterar('destinatarioUsuarioId')}
          {...propsAcessibilidade('destinatarioUsuarioId', { comAjuda: true })}
        >
          {ehTutor ? (
            <>
              <option value="">Selecione o tutor</option>
              <OpcoesTutores
                sugeridos={tutoresDestinatario.sugeridos}
                outros={tutoresDestinatario.outros}
                rotuloSugeridos={ROTULO_TUTORES_DA_OCORRENCIA}
              />
            </>
          ) : (
            <OpcoesEquipe usuarios={lista} />
          )}
        </select>
        <span id={idCampo('destinatarioUsuarioId-ajuda')} className="campo__ajuda">
          {ajuda}
        </span>
        {mensagemCampo('destinatarioUsuarioId')}
      </div>
    );
  }

  function opcaoInicialResponsavel() {
    if (aberta) return <option value="">Selecione o responsável</option>;
    const atual = ocorrencia.responsavelAcompanhamento?.nome;
    return (
      <option value="">{atual ? `Manter o atual (${atual})` : 'Manter sem responsável'}</option>
    );
  }

  function campoResponsavel() {
    const { tutoresSugeridos, outrosTutores, pedagogicos, gestao } = responsaveis;
    const ajuda = aberta
      ? 'Obrigatório. Quem vai acompanhar o caso: tutor, equipe pedagógica ou gestão, com acesso ativo.'
      : 'Opcional. Deixe a primeira opção para manter o responsável atual ou escolha outra pessoa para trocar.';
    return (
      <div className="campo">
        <label htmlFor={idCampo('responsavelAcompanhamentoId')}>
          {aberta ? 'Responsável pelo acompanhamento' : 'Responsável pelo acompanhamento (opcional)'}
        </label>
        <select
          value={dados.responsavelAcompanhamentoId}
          aria-disabled={enviando || undefined}
          onChange={alterar('responsavelAcompanhamentoId')}
          {...propsAcessibilidade('responsavelAcompanhamentoId', { comAjuda: true })}
        >
          {opcaoInicialResponsavel()}
          <OpcoesTutores
            sugeridos={tutoresSugeridos}
            outros={outrosTutores}
            rotuloSugeridos={ROTULO_TUTORES_DA_OCORRENCIA}
          />
          {pedagogicos.length > 0 && (
            <optgroup label="Equipe pedagógica">
              <OpcoesDeUsuarios usuarios={pedagogicos} />
            </optgroup>
          )}
          {gestao.length > 0 && (
            <optgroup label="Gestão">
              <OpcoesDeUsuarios usuarios={gestao} />
            </optgroup>
          )}
        </select>
        <span id={idCampo('responsavelAcompanhamentoId-ajuda')} className="campo__ajuda">
          {ajuda}
        </span>
        {mensagemCampo('responsavelAcompanhamentoId')}
      </div>
    );
  }

  function formulario() {
    return (
      <form
        className="formulario encaminhamento"
        onSubmit={aoEnviar}
        noValidate
        aria-busy={enviando}
        aria-labelledby={`${ID_DIALOGO}-titulo`}
      >
        <div className="campo">
          <label htmlFor={idCampo('destinatarioPerfil')}>Encaminhar para</label>
          <select
            value={dados.destinatarioPerfil}
            aria-disabled={enviando || undefined}
            onChange={alterar('destinatarioPerfil')}
            {...propsAcessibilidade('destinatarioPerfil')}
          >
            <option value="">Selecione</option>
            {DESTINATARIOS.map((d) => (
              <option key={d.valor} value={d.valor}>
                {d.rotulo}
              </option>
            ))}
          </select>
          {mensagemCampo('destinatarioPerfil')}
        </div>

        {campoUsuarioDestinatario()}
        {campoResponsavel()}

        <div className="campo">
          <label htmlFor={idCampo('observacao')}>Observação (opcional)</label>
          <textarea
            rows={3}
            maxLength={TAMANHO_MAXIMO_TEXTO_LONGO}
            value={dados.observacao}
            readOnly={enviando}
            onChange={alterar('observacao')}
            {...propsAcessibilidade('observacao', { comAjuda: true })}
          />
          <span id={idCampo('observacao-ajuda')} className="campo__ajuda">
            Até {TAMANHO_MAXIMO_TEXTO_LONGO} caracteres.
          </span>
          {mensagemCampo('observacao')}
        </div>

        {erro && (
          <div className="mensagem mensagem--erro" role="alert">
            <p>{erro}</p>
            {pedeAtualizacao && (
              <button type="button" className="botao botao--secundario" onClick={atualizarOcorrencia}>
                Atualizar a ocorrência
              </button>
            )}
          </div>
        )}

        <div className="dialogo__acoes">
          <button type="submit" className="botao botao--primario" aria-disabled={enviando}>
            {enviando ? 'Encaminhando...' : 'Encaminhar'}
          </button>
          <button
            type="button"
            className="botao botao--secundario"
            onClick={cancelar}
            aria-disabled={enviando}
          >
            Cancelar
          </button>
        </div>
      </form>
    );
  }

  function conteudo() {
    if (carregando) {
      return (
        <p className="texto-secundario" role="status">
          Carregando a lista de pessoas...
        </p>
      );
    }
    if (erroCarga) {
      return (
        <>
          <div className="mensagem mensagem--erro" role="alert">
            <p>{erroCarga}</p>
            <button
              ref={refTentarNovamente}
              type="button"
              className="botao botao--secundario"
              onClick={carregar}
            >
              Tentar novamente
            </button>
          </div>
          <div className="dialogo__acoes">
            <button type="button" className="botao botao--secundario" onClick={cancelar}>
              Cancelar
            </button>
          </div>
        </>
      );
    }
    return formulario();
  }

  return (
    <Dialogo
      id={ID_DIALOGO}
      titulo="Encaminhar ocorrência"
      descricaoId={`${ID_DIALOGO}-descricao`}
      aoFechar={cancelar}
      aoRestaurarFoco={aoRestaurarFoco}
    >
      <p id={`${ID_DIALOGO}-descricao`} className="texto-secundario">
        {aberta
          ? `Escolha para quem a ocorrência nº ${ocorrencia.id} vai e quem vai acompanhar o caso. Ao encaminhar, ela passa para "Em acompanhamento".`
          : `Registre um novo encaminhamento da ocorrência nº ${ocorrencia.id}. O status continua "Em acompanhamento".`}
      </p>
      {conteudo()}
    </Dialogo>
  );
}
