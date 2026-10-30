import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { SeloStatusOcorrencia } from '../components/ListaOcorrencias.jsx';
import { rotuloTurma } from '../services/mensagensEstudantes.js';
import {
  MENSAGEM_SEM_COMUNICACOES,
  MENSAGEM_SEM_ENCAMINHAMENTOS,
  MENSAGEM_SEM_PROVIDENCIAS,
  TEXTO_NAO_INFORMADO,
  TEXTO_TODA_A_EQUIPE,
  formatarDataHora,
  mensagemErroDetalheOcorrencia,
  mensagemOcorrenciaRegistrada,
  rotuloDestinatario,
} from '../services/mensagensOcorrencias.js';
import { obterOcorrencia } from '../services/ocorrencias.js';

const ID_SUCESSO = 'ocorrencia-registrada';

/** Texto opcional: o próprio texto ou "Não informado" quando vazio. */
function textoOuNaoInformado(valor) {
  return valor === undefined || valor === null || String(valor).trim() === ''
    ? TEXTO_NAO_INFORMADO
    : valor;
}

/** Um par rótulo/valor da lista de dados. `longo` preserva as quebras de linha. */
function Dado({ rotulo, children, longo = false }) {
  return (
    <div className={longo ? 'dados-ocorrencia__longo' : undefined}>
      <dt>{rotulo}</dt>
      <dd className={longo ? 'texto-longo' : undefined}>{children}</dd>
    </div>
  );
}

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

// Detalhe da ocorrência (RF05, UC03, RN19, RN20), somente leitura e aos 5
// perfis. O que aparece é o que a API devolve: fora da visibilidade do
// usuário, a API responde 404 como se a ocorrência não existisse.
// Vindo do registro (#46), mostra no topo a confirmação "Ocorrência nº X
// registrada com sucesso.", recebida pelo state da navegação; o state é
// apagado logo em seguida, para a faixa não reaparecer ao recarregar a
// página nem ao voltar a ela pelo histórico.
// As ações sobre a ocorrência (#50, #52) entram na área marcada abaixo.
function Detalhe({ id }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [sucesso] = useState(() =>
    location.state?.ocorrenciaRegistrada !== undefined
      ? mensagemOcorrenciaRegistrada(location.state.ocorrenciaRegistrada)
      : '',
  );

  const [ocorrencia, setOcorrencia] = useState(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState(null);

  const montado = useRef(true);
  const refSucesso = useRef(null);

  useEffect(() => {
    montado.current = true;
    return () => {
      montado.current = false;
    };
  }, []);

  useEffect(() => {
    if (location.state?.ocorrenciaRegistrada === undefined) return;
    navigate(`${location.pathname}${location.search}`, { replace: true, state: null });
  }, [location, navigate]);

  useEffect(() => {
    if (sucesso) refSucesso.current?.focus();
  }, [sucesso]);

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      const dados = await obterOcorrencia(id);
      if (montado.current) setOcorrencia(dados);
    } catch (falha) {
      // 401: o tratamento central já leva ao login com aviso.
      if (montado.current && falha?.status !== 401) {
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
        <ConteudoOcorrencia ocorrencia={ocorrencia} />
        {/* Ações sobre a ocorrência (#50, #52) entram aqui; nesta versão é somente leitura. */}
      </>
    );
  }

  const titulo = ocorrencia ? `Ocorrência nº ${ocorrencia.id}` : 'Detalhe da ocorrência';

  return (
    <div className="pagina-ocorrencia detalhe-ocorrencia">
      <p className="detalhe-ocorrencia__voltar">
        <Link to="/ocorrencias">Voltar para a lista</Link>
      </p>

      <div role="status" aria-live="polite">
        {sucesso && (
          <p id={ID_SUCESSO} ref={refSucesso} tabIndex={-1} className="mensagem mensagem--sucesso">
            {sucesso}
          </p>
        )}
      </div>

      <h1>{titulo}</h1>

      <div className="cartao detalhe-ocorrencia__cartao">{conteudo()}</div>
    </div>
  );
}

// A chave pelo id recria a página ao trocar de ocorrência, sem reaproveitar
// dados nem a faixa de sucesso da anterior.
export default function DetalheOcorrencia() {
  const { id } = useParams();
  return <Detalhe key={id} id={id} />;
}
