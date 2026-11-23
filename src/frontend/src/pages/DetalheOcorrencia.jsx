import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import Dado from '../components/Dado.jsx';
import EncaminharOcorrencia from '../components/EncaminharOcorrencia.jsx';
import EncerrarOcorrencia from '../components/EncerrarOcorrencia.jsx';
import RegistrarComunicacao from '../components/RegistrarComunicacao.jsx';
import RegistrarProvidencia from '../components/RegistrarProvidencia.jsx';
import SecaoHistorico from '../components/SecaoHistorico.jsx';
import { SeloStatusOcorrencia } from '../components/ListaOcorrencias.jsx';
import { useSessao } from '../components/Sessao.jsx';
import { exibirFalha, useCarregamento } from '../components/useCarregamento.js';
import { useTituloPagina } from '../components/useTituloPagina.js';
import { rotuloTurma } from '../services/mensagensEstudantes.js';
import {
  MENSAGEM_COMUNICACAO_REGISTRADA,
  MENSAGEM_ENCAMINHAMENTO_REGISTRADO,
  MENSAGEM_ENCERRAR_SEM_PROVIDENCIA,
  MENSAGEM_OCORRENCIA_ENCERRADA,
  MENSAGEM_PROVIDENCIA_REGISTRADA,
  MENSAGEM_SEM_COMUNICACOES,
  MENSAGEM_SEM_ENCAMINHAMENTOS,
  MENSAGEM_SEM_PROVIDENCIAS,
  TEXTO_NAO_INFORMADO,
  TEXTO_TODA_A_EQUIPE,
  formatarDataHora,
  mensagemErroDetalheOcorrencia,
  mensagemOcorrenciaRegistrada,
  rotuloDestinatario,
  temProvidencia,
  textoOuNaoInformado,
} from '../services/mensagensOcorrencias.js';
import { obterOcorrencia } from '../services/ocorrencias.js';
import {
  podeAtualizarOcorrencia,
  podeEncaminharOcorrencia,
  podeRegistrarComunicacao,
} from '../services/perfis.js';

const ID_SUCESSO = 'ocorrencia-registrada';

function SecaoEstudantes({ estudantes }) {
  return (
    <section className="detalhe-ocorrencia__secao" aria-labelledby="titulo-estudantes">
      <h2 id="titulo-estudantes">Estudantes envolvidos</h2>
      <ul className="detalhe-ocorrencia__itens">
        {estudantes.map((estudante) => (
          <li key={estudante.id} className="detalhe-ocorrencia__item">
            <p className="detalhe-ocorrencia__nome">{estudante.nomeCompleto}</p>
            <dl className="dados-ocorrencia dados-ocorrencia--compacto">
              <Dado rotulo="Turma">{rotuloTurma(estudante.turma) || TEXTO_NAO_INFORMADO}</Dado>
              {/* RN20: o código escolar só vem na resposta para a Gestão. */}
              {'codigoEscolar' in estudante && (
                <Dado rotulo="Código escolar">{textoOuNaoInformado(estudante.codigoEscolar)}</Dado>
              )}
            </dl>
          </li>
        ))}
      </ul>
    </section>
  );
}

function SecaoEncaminhamentos({ encaminhamentos }) {
  return (
    <section className="detalhe-ocorrencia__secao" aria-labelledby="titulo-encaminhamentos">
      <h2 id="titulo-encaminhamentos">Encaminhamentos</h2>
      {encaminhamentos.length === 0 ? (
        <p className="texto-secundario">{MENSAGEM_SEM_ENCAMINHAMENTOS}</p>
      ) : (
        <ul className="detalhe-ocorrencia__itens">
          {encaminhamentos.map((e) => (
            <li key={e.id} className="detalhe-ocorrencia__item">
              <dl className="dados-ocorrencia dados-ocorrencia--compacto">
                <Dado rotulo="Destinatário">
                  {rotuloDestinatario(e.destinatarioPerfil) || TEXTO_NAO_INFORMADO}
                  {' — '}
                  {e.destinatarioUsuario?.nome || TEXTO_TODA_A_EQUIPE}
                </Dado>
                <Dado rotulo="Registrado por">{textoOuNaoInformado(e.registradoPor?.nome)}</Dado>
                <Dado rotulo="Data e hora">
                  {formatarDataHora(e.dataHora) || TEXTO_NAO_INFORMADO}
                </Dado>
                <Dado rotulo="Observação" longo>
                  {textoOuNaoInformado(e.observacao)}
                </Dado>
              </dl>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function SecaoComunicacoes({ comunicacoes }) {
  return (
    <section className="detalhe-ocorrencia__secao" aria-labelledby="titulo-comunicacoes">
      <h2 id="titulo-comunicacoes">Comunicações</h2>
      {comunicacoes.length === 0 ? (
        <p className="texto-secundario">{MENSAGEM_SEM_COMUNICACOES}</p>
      ) : (
        <ul className="detalhe-ocorrencia__itens">
          {comunicacoes.map((c) => (
            <li key={c.id} className="detalhe-ocorrencia__item">
              <dl className="dados-ocorrencia dados-ocorrencia--compacto">
                <Dado rotulo="Destinatário">{textoOuNaoInformado(c.destinatario)}</Dado>
                <Dado rotulo="Meio">{textoOuNaoInformado(c.meio)}</Dado>
                <Dado rotulo="Data e hora">
                  {formatarDataHora(c.dataHora) || TEXTO_NAO_INFORMADO}
                </Dado>
                <Dado rotulo="Registrada por">{textoOuNaoInformado(c.registradoPor?.nome)}</Dado>
                <Dado rotulo="Descrição" longo>
                  {textoOuNaoInformado(c.descricao)}
                </Dado>
              </dl>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function SecaoProvidencias({ providencias }) {
  return (
    <section className="detalhe-ocorrencia__secao" aria-labelledby="titulo-providencias">
      <h2 id="titulo-providencias">Providências adotadas</h2>
      {providencias.length === 0 ? (
        <p className="texto-secundario">{MENSAGEM_SEM_PROVIDENCIAS}</p>
      ) : (
        <ul className="detalhe-ocorrencia__itens">
          {providencias.map((p) => (
            <li key={p.id} className="detalhe-ocorrencia__item">
              <dl className="dados-ocorrencia dados-ocorrencia--compacto">
                <Dado rotulo="Registrada por">{textoOuNaoInformado(p.registradoPor?.nome)}</Dado>
                <Dado rotulo="Data e hora">
                  {formatarDataHora(p.dataHora) || TEXTO_NAO_INFORMADO}
                </Dado>
                <Dado rotulo="Descrição" longo>
                  {textoOuNaoInformado(p.descricao)}
                </Dado>
              </dl>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Todos os campos do RF05, os encaminhamentos, as comunicações e as providências. */
function ConteudoOcorrencia({ ocorrencia }) {
  return (
    <>
      <section className="detalhe-ocorrencia__secao" aria-labelledby="titulo-dados">
        <h2 id="titulo-dados">Dados da ocorrência</h2>
        <dl className="dados-ocorrencia">
          <Dado rotulo="Número da ocorrência">{ocorrencia.id}</Dado>
          <Dado rotulo="Status">
            <SeloStatusOcorrencia status={ocorrencia.status} />
          </Dado>
          <Dado rotulo="Data e hora do fato">
            {formatarDataHora(ocorrencia.dataHora) || TEXTO_NAO_INFORMADO}
          </Dado>
          <Dado rotulo="Local">{textoOuNaoInformado(ocorrencia.local)}</Dado>
          <Dado rotulo="Turma da ocorrência">
            {rotuloTurma(ocorrencia.turma) || TEXTO_NAO_INFORMADO}
          </Dado>
          <Dado rotulo="Categoria">{textoOuNaoInformado(ocorrencia.categoria?.nome)}</Dado>
          <Dado rotulo="Profissional responsável">
            {textoOuNaoInformado(ocorrencia.profissionalResponsavel?.nome)}
          </Dado>
          {ocorrencia.responsavelAcompanhamento && (
            <Dado rotulo="Responsável pelo acompanhamento">
              {textoOuNaoInformado(ocorrencia.responsavelAcompanhamento.nome)}
            </Dado>
          )}
          {ocorrencia.dataEncerramento && (
            <Dado rotulo="Data de encerramento">
              {formatarDataHora(ocorrencia.dataEncerramento) || TEXTO_NAO_INFORMADO}
            </Dado>
          )}
        </dl>
      </section>

      <SecaoEstudantes estudantes={ocorrencia.estudantes ?? []} />

      <section className="detalhe-ocorrencia__secao" aria-labelledby="titulo-fato">
        <h2 id="titulo-fato">O que aconteceu</h2>
        <dl className="dados-ocorrencia">
          <Dado rotulo="Descrição do fato" longo>
            {textoOuNaoInformado(ocorrencia.descricao)}
          </Dado>
          <Dado rotulo="Demais envolvidos" longo>
            {textoOuNaoInformado(ocorrencia.demaisEnvolvidos)}
          </Dado>
          <Dado rotulo="Testemunhas" longo>
            {textoOuNaoInformado(ocorrencia.testemunhas)}
          </Dado>
          <Dado rotulo="Providências imediatas" longo>
            {textoOuNaoInformado(ocorrencia.providenciasImediatas)}
          </Dado>
          <Dado rotulo="Observações" longo>
            {textoOuNaoInformado(ocorrencia.observacoes)}
          </Dado>
        </dl>
      </section>

      <SecaoEncaminhamentos encaminhamentos={ocorrencia.encaminhamentos ?? []} />
      <SecaoComunicacoes comunicacoes={ocorrencia.comunicacoes ?? []} />
      <SecaoProvidencias providencias={ocorrencia.providencias ?? []} />
    </>
  );
}

/**
 * Filtros e página da lista de onde o usuário veio (#87), recebidos pelo state
 * da navegação: só uma query string simples ('?...'), sem outro caminho.
 */
function buscaDaLista(state) {
  const busca = state?.buscaLista;
  return typeof busca === 'string' && /^\?[^#/]*$/.test(busca) ? busca : '';
}

// Detalhe da ocorrência (RF05, UC03, RN19, RN20), somente leitura e aos 5
// perfis. O que aparece é o que a API devolve: fora da visibilidade do
// usuário, a API responde 404 como se a ocorrência não existisse.
// Vindo do registro (#46), mostra no topo a confirmação "Ocorrência nº X
// registrada com sucesso.", recebida pelo state da navegação; o state é
// apagado logo em seguida, para a faixa não reaparecer ao recarregar a
// página nem ao voltar a ela pelo histórico.
// Ações (#50): Gestão e Pedagógico encaminham ocorrências não encerradas
// pelo botão "Encaminhar" (UC02, RF08, RN15); o detalhe é substituído pela
// resposta da API, com o novo status, responsável e encaminhamento. Esconder
// o botão é só usabilidade: a proteção real é do back-end (403/409).
// Comunicação (#52): Tutor, Gestão e Pedagógico registram, em ocorrências não
// encerradas, um contato feito fora do sistema pelo botão "Registrar
// comunicação" (RF09, RN16, RN17); o detalhe também é substituído pela
// resposta da API, já com a comunicação na lista. Para o Tutor, a API só
// aceita ocorrências que ele pode ver (RN19): fora disso, 404.
// Providência e encerramento (#84): com a ocorrência "Em acompanhamento", a
// Gestão, o Pedagógico e o responsável pelo acompanhamento veem "Registrar
// providência" e "Encerrar ocorrência" (UC04, RN04, RN22). Encerrar pede
// confirmação; sem providência, a tela orienta (RN04) e não envia. O detalhe
// é substituído pela resposta da API (lista de providências, selo "Encerrado"
// e data de encerramento). Encerrada, a ocorrência não mostra nenhuma ação.
// Histórico (#85): seção "Histórico" no fim do cartão, recarregada depois de
// cada ação concluída (encaminhar, comunicar, registrar providência, encerrar).
function Detalhe({ id }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { usuario } = useSessao();
  const [sucesso, setSucesso] = useState(() =>
    location.state?.ocorrenciaRegistrada !== undefined
      ? mensagemOcorrenciaRegistrada(location.state.ocorrenciaRegistrada)
      : '',
  );

  const [ocorrencia, setOcorrencia] = useState(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState(null);

  const [encaminhando, setEncaminhando] = useState(false);
  const [comunicando, setComunicando] = useState(false);
  const [registrandoProvidencia, setRegistrandoProvidencia] = useState(false);
  const [encerrando, setEncerrando] = useState(false);
  // RN04: aviso exibido ao tentar encerrar sem providência registrada.
  const [avisoEncerramento, setAvisoEncerramento] = useState('');
  // #85: muda a cada ação concluída, para a seção "Histórico" buscar de novo.
  const [versaoHistorico, setVersaoHistorico] = useState(0);

  const { montado } = useCarregamento();
  const refSucesso = useRef(null);
  const refAviso = useRef(null);
  const refTitulo = useRef(null);

  useEffect(() => {
    if (location.state?.ocorrenciaRegistrada === undefined) return;
    navigate(`${location.pathname}${location.search}`, { replace: true, state: null });
  }, [location, navigate]);

  useEffect(() => {
    if (sucesso) refSucesso.current?.focus();
  }, [sucesso]);

  useEffect(() => {
    if (avisoEncerramento) refAviso.current?.focus();
  }, [avisoEncerramento]);

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      const dados = await obterOcorrencia(id);
      if (montado.current) setOcorrencia(dados);
    } catch (falha) {
      // 401: o tratamento central já leva ao login com aviso.
      if (montado.current && exibirFalha(falha)) {
        setErro({
          mensagem: mensagemErroDetalheOcorrencia(falha),
          // Inexistente, fora da visibilidade ou id inválido: tentar de novo não adianta.
          naoEncontrada: [400, 404].includes(falha?.status),
        });
      }
    } finally {
      if (montado.current) setCarregando(false);
    }
  }, [id]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  // #85: o histórico respondeu 404/400 — a ocorrência não existe mais para o
  // usuário (RN19). Mesma tela de "não encontrada" do detalhe.
  const historicoSemOcorrencia = useCallback((falha) => {
    if (!montado.current) return;
    setEncaminhando(false);
    setComunicando(false);
    setRegistrandoProvidencia(false);
    setEncerrando(false);
    setAvisoEncerramento('');
    setSucesso('');
    setOcorrencia(null);
    setErro({ mensagem: mensagemErroDetalheOcorrencia(falha), naoEncontrada: true });
  }, []);

  function abrirEncaminhamento() {
    setSucesso('');
    setAvisoEncerramento('');
    setEncaminhando(true);
  }

  // Sucesso: a resposta 201 já é o detalhe completo (status, responsável e o
  // encaminhamento novo aparecem sem recarregar a página).
  function concluirEncaminhamento(detalhe) {
    setEncaminhando(false);
    if (detalhe) setOcorrencia(detalhe);
    else carregar(); // resposta sem corpo (fora do contrato): busca de novo
    setSucesso(MENSAGEM_ENCAMINHAMENTO_REGISTRADO);
    setVersaoHistorico((v) => v + 1);
  }

  function abrirComunicacao() {
    setSucesso('');
    setAvisoEncerramento('');
    setComunicando(true);
  }

  // Sucesso: a resposta 201 já é o detalhe completo, com a nova comunicação.
  function concluirComunicacao(detalhe) {
    setComunicando(false);
    if (detalhe) setOcorrencia(detalhe);
    else carregar(); // resposta sem corpo (fora do contrato): busca de novo
    setSucesso(MENSAGEM_COMUNICACAO_REGISTRADA);
    setVersaoHistorico((v) => v + 1);
  }

  function abrirProvidencia() {
    setSucesso('');
    setAvisoEncerramento('');
    setRegistrandoProvidencia(true);
  }

  // Sucesso: a resposta 201 já é o detalhe completo, com a nova providência.
  function concluirProvidencia(detalhe) {
    setRegistrandoProvidencia(false);
    if (detalhe) setOcorrencia(detalhe);
    else carregar(); // resposta sem corpo (fora do contrato): busca de novo
    setSucesso(MENSAGEM_PROVIDENCIA_REGISTRADA);
    setVersaoHistorico((v) => v + 1);
  }

  // RN04: sem providência registrada, orienta e não abre a confirmação.
  function abrirEncerramento() {
    setSucesso('');
    if (!temProvidencia(ocorrencia)) {
      setAvisoEncerramento(MENSAGEM_ENCERRAR_SEM_PROVIDENCIA);
      return;
    }
    setAvisoEncerramento('');
    setEncerrando(true);
  }

  // Sucesso: a resposta 200 já é o detalhe completo, com o status "Encerrado"
  // e a data de encerramento; os botões de ação somem.
  function concluirEncerramento(detalhe) {
    setEncerrando(false);
    if (detalhe) setOcorrencia(detalhe);
    else carregar(); // resposta sem corpo (fora do contrato): busca de novo
    setSucesso(MENSAGEM_OCORRENCIA_ENCERRADA);
    setVersaoHistorico((v) => v + 1);
  }

  // 404/409 no envio: a ocorrência mudou (ex.: encerrada por outra pessoa).
  function atualizarAposConflito() {
    setEncaminhando(false);
    setComunicando(false);
    setRegistrandoProvidencia(false);
    setEncerrando(false);
    setAvisoEncerramento('');
    carregar();
  }

  const naoEncerrada = Boolean(ocorrencia) && ocorrencia.status !== 'ENCERRADO';
  const podeEncaminhar = naoEncerrada && podeEncaminharOcorrencia(usuario?.perfil);
  const podeComunicar = naoEncerrada && podeRegistrarComunicacao(usuario?.perfil);
  // Só "Em acompanhamento" (RN04) e Gestão, Pedagógico ou o responsável (RN22).
  const podeAtualizar = podeAtualizarOcorrencia(usuario, ocorrencia);

  function acoes() {
    if (!podeEncaminhar && !podeComunicar && !podeAtualizar) return null;
    return (
      <>
        <section className="detalhe-ocorrencia__acoes" aria-label="Ações sobre a ocorrência">
          {podeEncaminhar && (
            <button type="button" className="botao botao--primario" onClick={abrirEncaminhamento}>
              Encaminhar
            </button>
          )}
          {podeComunicar && (
            <button type="button" className="botao botao--secundario" onClick={abrirComunicacao}>
              Registrar comunicação
            </button>
          )}
          {podeAtualizar && (
            <button type="button" className="botao botao--secundario" onClick={abrirProvidencia}>
              Registrar providência
            </button>
          )}
          {podeAtualizar && (
            <button type="button" className="botao botao--alerta" onClick={abrirEncerramento}>
              Encerrar ocorrência
            </button>
          )}
        </section>
        {podeAtualizar && avisoEncerramento && (
          <p
            ref={refAviso}
            tabIndex={-1}
            role="alert"
            className="mensagem mensagem--aviso detalhe-ocorrencia__aviso"
          >
            {avisoEncerramento}
          </p>
        )}
      </>
    );
  }

  function conteudo() {
    if (carregando) {
      return (
        <p className="texto-secundario" role="status">
          Carregando a ocorrência...
        </p>
      );
    }
    if (erro) {
      return (
        <div className="mensagem mensagem--erro" role="alert">
          <p>{erro.mensagem}</p>
          {erro.naoEncontrada ? (
            <p>
              Confira se o endereço está correto ou volte para a lista e escolha outra ocorrência.
            </p>
          ) : (
            <button type="button" className="botao botao--secundario" onClick={carregar}>
              Tentar novamente
            </button>
          )}
        </div>
      );
    }
    if (!ocorrencia) return null;
    return (
      <>
        {/* Ações no topo do cartão: no celular ficam ao alcance sem rolar o detalhe todo. */}
        {acoes()}
        <ConteudoOcorrencia ocorrencia={ocorrencia} />
        <SecaoHistorico
          id={id}
          versao={versaoHistorico}
          aoNaoEncontrar={historicoSemOcorrencia}
        />
      </>
    );
  }

  const titulo = ocorrencia ? `Ocorrência nº ${ocorrencia.id}` : 'Detalhe da ocorrência';

  return (
    <div className="pagina-ocorrencia detalhe-ocorrencia">
      <p className="detalhe-ocorrencia__voltar">
        <Link to={`/ocorrencias${buscaDaLista(location.state)}`}>Voltar para a lista</Link>
      </p>

      <div role="status" aria-live="polite">
        {sucesso && (
          <p id={ID_SUCESSO} ref={refSucesso} tabIndex={-1} className="mensagem mensagem--sucesso">
            {sucesso}
          </p>
        )}
      </div>

      <h1 ref={refTitulo} tabIndex={-1}>
        {titulo}
      </h1>

      <div className="cartao detalhe-ocorrencia__cartao">{conteudo()}</div>

      {encaminhando && ocorrencia && (
        <EncaminharOcorrencia
          ocorrencia={ocorrencia}
          aoConcluir={concluirEncaminhamento}
          aoCancelar={() => setEncaminhando(false)}
          aoAtualizarOcorrencia={atualizarAposConflito}
          aoRestaurarFoco={() => refTitulo.current?.focus()}
        />
      )}

      {comunicando && ocorrencia && (
        <RegistrarComunicacao
          ocorrencia={ocorrencia}
          aoConcluir={concluirComunicacao}
          aoCancelar={() => setComunicando(false)}
          aoAtualizarOcorrencia={atualizarAposConflito}
          aoRestaurarFoco={() => refTitulo.current?.focus()}
        />
      )}

      {registrandoProvidencia && ocorrencia && (
        <RegistrarProvidencia
          ocorrencia={ocorrencia}
          aoConcluir={concluirProvidencia}
          aoCancelar={() => setRegistrandoProvidencia(false)}
          aoAtualizarOcorrencia={atualizarAposConflito}
          aoRestaurarFoco={() => refTitulo.current?.focus()}
        />
      )}

      {encerrando && ocorrencia && (
        <EncerrarOcorrencia
          ocorrencia={ocorrencia}
          aoConcluir={concluirEncerramento}
          aoCancelar={() => setEncerrando(false)}
          aoAtualizarOcorrencia={atualizarAposConflito}
          aoRestaurarFoco={() => refTitulo.current?.focus()}
        />
      )}
    </div>
  );
}

// A chave pelo id recria a página ao trocar de ocorrência, sem reaproveitar
// dados nem a faixa de sucesso da anterior.
export default function DetalheOcorrencia() {
  const { id } = useParams();
  // Só o número vai para a aba (RNF06): texto digitado na URL não entra no título.
  useTituloPagina(/^\d+$/.test(id) ? `Ocorrência nº ${id}` : 'Detalhe da ocorrência');
  return <Detalhe key={id} id={id} />;
}
