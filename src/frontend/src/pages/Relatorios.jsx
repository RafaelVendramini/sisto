import { useEffect, useRef, useState } from 'react';
import { useTituloPagina } from '../components/useTituloPagina.js';
import {
  formatarDataRelatorio,
  MENSAGEM_RELATORIO_VAZIO,
  mensagemErroRelatorio,
  validarFiltroRelatorio,
} from '../services/mensagensRelatorios.js';
import { gerarRelatorio, rotuloTipoRelatorio, TIPOS_RELATORIO } from '../services/relatorios.js';

const FILTRO_INICIAL = { tipo: 'periodo', dataInicio: '', dataFim: '' };
const ORDEM_CAMPOS = ['dataInicio', 'dataFim'];

// Cabeçalho da coluna de rótulos em cada tipo com linhas.
const COLUNA_ROTULO = { turma: 'Turma', categoria: 'Categoria' };

/**
 * Relatórios (UC05, RF13, RF14): quantidade de ocorrências no período, por
 * turma ou por categoria, com impressão pelo navegador. Só Gestão e
 * Pedagógico (a rota usa RotaPorPerfil; a proteção real é do back-end).
 * Sem exportação de arquivo nem gráficos (fora do escopo — Seção 5).
 * Na impressão, o CSS esconde cabeçalho, menu, rodapé e formulário: ficam o
 * título, o período e a tabela.
 */
export default function Relatorios() {
  useTituloPagina('Relatórios');
  const [filtro, setFiltro] = useState(FILTRO_INICIAL);
  const [errosCampos, setErrosCampos] = useState({});
  const [erro, setErro] = useState('');
  const [gerando, setGerando] = useState(false);
  const [relatorio, setRelatorio] = useState(null);

  const montado = useRef(true);
  // Só a resposta da geração mais recente é mostrada.
  const ultimaGeracao = useRef(0);
  const refs = { dataInicio: useRef(null), dataFim: useRef(null) };

  useEffect(() => {
    montado.current = true;
    return () => {
      montado.current = false;
    };
  }, []);

  function alterar(campo) {
    return (evento) => {
      const { value } = evento.target;
      setFiltro((atual) => ({ ...atual, [campo]: value }));
      // Ao corrigir o campo, a mensagem de erro dele (e o aria-invalid) some.
      setErrosCampos((atual) => {
        if (!atual[campo]) return atual;
        const { [campo]: _removido, ...restantes } = atual;
        return restantes;
      });
    };
  }

  async function aoEnviar(evento) {
    evento.preventDefault();
    setErro('');

    const novosErros = validarFiltroRelatorio(filtro);
    setErrosCampos(novosErros);
    if (Object.keys(novosErros).length > 0) {
      const campo = ORDEM_CAMPOS.find((nome) => novosErros[nome]);
      if (campo) refs[campo].current?.focus();
      return;
    }

    const geracao = ++ultimaGeracao.current;
    setGerando(true);
    try {
      const resultado = await gerarRelatorio(filtro);
      if (montado.current && geracao === ultimaGeracao.current) setRelatorio(resultado);
    } catch (falha) {
      if (!montado.current || geracao !== ultimaGeracao.current) return;
      setRelatorio(null);
      // 401: o tratamento central já leva ao login com aviso.
      if (falha?.status !== 401) setErro(mensagemErroRelatorio(falha));
    } finally {
      if (montado.current && geracao === ultimaGeracao.current) setGerando(false);
    }
  }

  function propsAcessibilidade(campo) {
    return {
      'aria-invalid': Boolean(errosCampos[campo]),
      'aria-describedby': errosCampos[campo] ? `relatorio-${campo}-erro` : undefined,
    };
  }

  function mensagemCampo(campo) {
    return (
      errosCampos[campo] && (
        <span id={`relatorio-${campo}-erro`} className="campo__erro">
          {errosCampos[campo]}
        </span>
      )
    );
  }

  return (
    <div className="pagina-relatorios">
      <h1>Relatórios</h1>
      <p className="texto-secundario nao-imprimir">
        Escolha o tipo de relatório e o período para ver a quantidade de ocorrências. Depois, use
        o botão “Imprimir” para imprimir ou salvar pela impressão do navegador.
      </p>

      <form
        className="formulario cartao relatorios__formulario nao-imprimir"
        onSubmit={aoEnviar}
        noValidate
        aria-busy={gerando}
        aria-label="Gerar relatório"
      >
        <div className="campo">
          <label htmlFor="relatorio-tipo">Tipo de relatório</label>
          <select
            id="relatorio-tipo"
            name="tipo"
            value={filtro.tipo}
            onChange={alterar('tipo')}
          >
            {TIPOS_RELATORIO.map((item) => (
              <option key={item.valor} value={item.valor}>
                {item.rotulo}
              </option>
            ))}
          </select>
        </div>

        <div className="relatorios__periodo">
          <div className="campo">
            <label htmlFor="relatorio-dataInicio">De</label>
            <input
              ref={refs.dataInicio}
              id="relatorio-dataInicio"
              name="dataInicio"
              type="date"
              required
              value={filtro.dataInicio}
              onChange={alterar('dataInicio')}
              {...propsAcessibilidade('dataInicio')}
            />
            {mensagemCampo('dataInicio')}
          </div>

          <div className="campo">
            <label htmlFor="relatorio-dataFim">Até</label>
            <input
              ref={refs.dataFim}
              id="relatorio-dataFim"
              name="dataFim"
              type="date"
              required
              value={filtro.dataFim}
              onChange={alterar('dataFim')}
              {...propsAcessibilidade('dataFim')}
            />
            {mensagemCampo('dataFim')}
          </div>
        </div>

        <button
          type="submit"
          className="botao botao--primario relatorios__gerar"
          aria-disabled={gerando}
          disabled={gerando}
        >
          {gerando ? 'Gerando...' : 'Gerar relatório'}
        </button>
      </form>

      {erro && (
        <p className="mensagem mensagem--erro nao-imprimir" role="alert">
          {erro}
        </p>
      )}

      {relatorio && !erro && <ResultadoRelatorio relatorio={relatorio} />}
    </div>
  );
}

/**
 * Resultado: cabeçalho com o tipo e o período (dd/mm/aaaa) e a tabela de
 * quantidades com a linha de total. No "Total do período", só o total.
 */
function ResultadoRelatorio({ relatorio }) {
  const { tipo, dataInicio, dataFim, total, linhas } = relatorio;
  const rotuloTipo = rotuloTipoRelatorio(tipo);
  const periodo = `${formatarDataRelatorio(dataInicio)} a ${formatarDataRelatorio(dataFim)}`;
  const vazio = total === 0;

  return (
    <section className="cartao relatorios__resultado" aria-labelledby="titulo-resultado-relatorio">
      <div className="relatorios__cabecalho-resultado">
        <div>
          <h2 id="titulo-resultado-relatorio">{rotuloTipo}</h2>
          <p className="relatorios__periodo-texto">Período: {periodo}</p>
        </div>
        {!vazio && (
          <button
            type="button"
            className="botao botao--secundario nao-imprimir"
            onClick={() => window.print()}
          >
            Imprimir
          </button>
        )}
      </div>

      {vazio ? (
        <p className="texto-secundario" role="status">
          {MENSAGEM_RELATORIO_VAZIO}
        </p>
      ) : (
        <table className="tabela-relatorio">
          <caption className="visualmente-oculto">
            Quantidade de ocorrências — {rotuloTipo}, de {periodo}
          </caption>
          <thead>
            <tr>
              <th scope="col">{COLUNA_ROTULO[tipo] ?? 'Período'}</th>
              <th scope="col" className="tabela-relatorio__quantidade">
                Quantidade
              </th>
            </tr>
          </thead>
          {linhas.length > 0 && (
            <tbody>
              {linhas.map((linha) => (
                <tr key={linha.id}>
                  <td>{linha.rotulo}</td>
                  <td className="tabela-relatorio__quantidade">{linha.quantidade}</td>
                </tr>
              ))}
            </tbody>
          )}
          <tfoot>
            <tr>
              <th scope="row">Total</th>
              <td className="tabela-relatorio__quantidade">{total}</td>
            </tr>
          </tfoot>
        </table>
      )}
    </section>
  );
}
