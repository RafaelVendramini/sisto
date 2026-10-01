// Layout base responsivo (RNF01): cabeçalho com a marca, área de conteúdo e rodapé.
export default function Layout({ children }) {
  return (
    <div className="layout">
      <header className="layout__cabecalho">
        <div className="layout__container layout__cabecalho-conteudo">
          <img
            className="layout__logo"
            src="/logo-sisto.svg"
            alt="Sisto — Gestão de ocorrências escolares"
          />
        </div>
      </header>

      <main className="layout__principal">
        <div className="layout__container">{children}</div>
      </main>

      <footer className="layout__rodape">
        <div className="layout__container">
          EE José Carlos Nogueira Reverendo – Professor
        </div>
      </footer>
    </div>
  );
}
