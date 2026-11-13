import { AVISO_TEXTO_PROVISORIO, MARCADOR_A_DEFINIR } from '../services/textosLegais.js';

// Divide o texto nos trechos marcados com **negrito** (formato de textosLegais.js).
function trechos(texto) {
  return texto.split(/(\*\*[^*]+\*\*)/).filter(Boolean);
}

// Texto com negrito; trechos "[A DEFINIR PELA ESCOLA...]" ficam destacados (#92).
function TextoFormatado({ texto }) {
  return trechos(texto).map((trecho, indice) => {
    if (!trecho.startsWith('**') || !trecho.endsWith('**')) return trecho;
    const conteudo = trecho.slice(2, -2);
    if (conteudo.startsWith(MARCADOR_A_DEFINIR)) {
      return (
        <mark key={indice} className="texto-legal__a-definir">
          <strong>{conteudo}</strong>
        </mark>
      );
    }
    return <strong key={indice}>{conteudo}</strong>;
  });
}

function Bloco({ bloco }) {
  if (typeof bloco === 'string') {
    return (
      <p>
        <TextoFormatado texto={bloco} />
      </p>
    );
  }
  return (
    <ul className="texto-legal__lista">
      {bloco.lista.map((item) => (
        <li key={item}>
          <TextoFormatado texto={item} />
        </li>
      ))}
    </ul>
  );
}

/**
 * Página de texto legal (Política de privacidade, Termos de uso — #92).
 * O conteúdo vem de services/textosLegais.js; o componente só o apresenta.
 * @param {{ id: string, documento: { titulo: string, nota: string, secoes: Array } }} props
 */
export default function TextoLegal({ id, documento }) {
  const idTitulo = `titulo-${id}`;
  return (
    <article className="cartao texto-legal" aria-labelledby={idTitulo}>
      <p className="mensagem mensagem--aviso texto-legal__aviso">
        <strong>{AVISO_TEXTO_PROVISORIO}</strong>
      </p>
      <h1 id={idTitulo}>{documento.titulo}</h1>
      <p className="texto-secundario">
        <TextoFormatado texto={documento.nota} />
      </p>
      {documento.secoes.map((secao) => {
        const idSecao = `${id}-${secao.titulo.split('.')[0]}`;
        return (
          <section key={secao.titulo} className="texto-legal__secao" aria-labelledby={idSecao}>
            <h2 id={idSecao}>{secao.titulo}</h2>
            {secao.blocos.map((bloco, indice) => (
              <Bloco key={indice} bloco={bloco} />
            ))}
          </section>
        );
      })}
    </article>
  );
}
