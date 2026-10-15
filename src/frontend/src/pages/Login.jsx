import { useEffect, useRef, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import CampoSenha from '../components/CampoSenha.jsx';
import { useSessao } from '../components/Sessao.jsx';
import { estaAutenticado } from '../services/auth.js';
import { ROTA_ALTERAR_SENHA } from '../services/conta.js';

const MENSAGEM_CREDENCIAIS = 'E-mail ou senha inválidos.';
const MENSAGEM_GENERICA = 'Não foi possível entrar agora. Tente novamente em instantes.';
const MENSAGEM_SEM_CONEXAO = 'Não foi possível conectar ao servidor. Tente novamente em instantes.';

// Traduz a falha do login em uma mensagem simples, sem detalhes técnicos (RNF02).
function mensagemDeErro(erro) {
  const status = erro?.status;
  if (status === 401) return MENSAGEM_CREDENCIAIS;
  // 400 (dados ausentes) já vem com texto amigável do back-end.
  if (status === 400 && erro?.message) return erro.message;
  // 0 = sem conexão ou API não configurada: detalhe técnico só no console.
  if (status === 0) {
    console.error('[Sisto] Falha ao conectar à API:', erro?.message);
    return MENSAGEM_SEM_CONEXAO;
  }
  return MENSAGEM_GENERICA;
}

// Tela de login (RF02): e-mail e senha, validação antes do envio e mensagens claras.
export default function Login() {
  const { entrar, aviso, sucesso } = useSessao();
  // O texto do aviso entra na região viva só depois da montagem, para que
  // leitores de tela o anunciem (a região já existe antes do texto).
  const [avisoExibido, setAvisoExibido] = useState('');
  const [sucessoExibido, setSucessoExibido] = useState('');
  const navigate = useNavigate();
  const location = useLocation();

  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [errosCampos, setErrosCampos] = useState({});
  const [erro, setErro] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [mostrarSenha, setMostrarSenha] = useState(false);

  const emailRef = useRef(null);
  const senhaRef = useRef(null);

  useEffect(() => {
    emailRef.current?.focus();
  }, []);

  useEffect(() => {
    setAvisoExibido(aviso);
  }, [aviso]);

  useEffect(() => {
    setSucessoExibido(sucesso);
  }, [sucesso]);

  if (estaAutenticado()) {
    return <Navigate to="/" replace />;
  }

  async function aoEnviar(evento) {
    evento.preventDefault();
    if (enviando) return;

    const emailLimpo = email.trim();
    const novosErros = {};
    if (!emailLimpo) novosErros.email = 'Informe o seu e-mail.';
    if (!senha) novosErros.senha = 'Informe a sua senha.';
    setErrosCampos(novosErros);
    setErro('');

    if (novosErros.email) {
      emailRef.current?.focus();
      return;
    }
    if (novosErros.senha) {
      senhaRef.current?.focus();
      return;
    }

    setEnviando(true);
    try {
      const { trocaSenhaObrigatoria } = await entrar(emailLimpo, senha);
      // RN10: senha redefinida pela Gestão — vai direto para a troca.
      if (trocaSenhaObrigatoria) {
        navigate(ROTA_ALTERAR_SENHA, { replace: true });
        return;
      }
      const destino = location.state?.de && location.state.de !== '/login' ? location.state.de : '/';
      navigate(destino, { replace: true });
    } catch (falha) {
      setErro(mensagemDeErro(falha));
      // Após erro, a senha é apagada e o campo volta a ficar mascarado.
      setSenha('');
      setMostrarSenha(false);
      setEnviando(false);
      senhaRef.current?.focus();
    }
  }

  return (
    <section className="cartao cartao--login" aria-labelledby="titulo-login">
      <h1 id="titulo-login">Entrar no Sisto</h1>
      <p className="texto-secundario">Use o e-mail e a senha cadastrados pela gestão da escola.</p>

      <div role="status" aria-live="polite">
        {avisoExibido && !erro && <p className="mensagem mensagem--aviso">{avisoExibido}</p>}
        {sucessoExibido && !avisoExibido && !erro && (
          <p className="mensagem mensagem--sucesso">{sucessoExibido}</p>
        )}
      </div>

      {erro && (
        <p className="mensagem mensagem--erro" role="alert">
          {erro}
        </p>
      )}

      <form className="formulario" onSubmit={aoEnviar} noValidate aria-busy={enviando}>
        <div className="campo">
          <label htmlFor="login-email">E-mail</label>
          <input
            ref={emailRef}
            id="login-email"
            name="email"
            type="email"
            autoComplete="username"
            inputMode="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-invalid={Boolean(errosCampos.email)}
            aria-describedby={errosCampos.email ? 'login-email-erro' : undefined}
          />
          {errosCampos.email && (
            <span id="login-email-erro" className="campo__erro">
              {errosCampos.email}
            </span>
          )}
        </div>

        <div className="campo">
          <label htmlFor="login-senha">Senha</label>
          <CampoSenha
            inputRef={senhaRef}
            id="login-senha"
            name="senha"
            autoComplete="current-password"
            value={senha}
            onChange={(e) => setSenha(e.target.value)}
            mostrar={mostrarSenha}
            aoAlternar={() => setMostrarSenha((atual) => !atual)}
            aria-invalid={Boolean(errosCampos.senha)}
            aria-describedby={errosCampos.senha ? 'login-senha-erro' : undefined}
          />
          {errosCampos.senha && (
            <span id="login-senha-erro" className="campo__erro">
              {errosCampos.senha}
            </span>
          )}
        </div>

        <button type="submit" className="botao botao--primario botao--largo" disabled={enviando}>
          {enviando ? 'Entrando...' : 'Entrar'}
        </button>
      </form>

      {/* RF03: não há recuperação por e-mail (etapa futura, fora do escopo). */}
      <p className="login__ajuda texto-secundario">Esqueceu a senha? Procure a Gestão da escola.</p>
    </section>
  );
}
