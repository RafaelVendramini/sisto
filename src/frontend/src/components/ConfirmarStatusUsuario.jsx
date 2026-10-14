import { useRef, useState } from 'react';
import { rotuloPerfil, rotuloStatus } from '../services/perfis.js';
import {
  listaPodeEstarDesatualizada,
  mensagemErroAlteracaoUsuario,
} from '../services/mensagensUsuarios.js';
import { atualizarUsuario } from '../services/usuarios.js';
import Dialogo from './Dialogo.jsx';

const AVISO_SEM_EXCLUSAO =
  'O usuário não será excluído: o cadastro e o histórico dos registros dele continuam guardados no Sisto, e o acesso pode ser reativado depois.';

/**
 * Textos de cada mudança de status (RF04, RN07, RN09) para quem está Ativo
 * (ou, no caso de ATIVO, para quem vai ser reativado). `sucesso` é a mensagem
 * exibida na página depois que a API confirma a alteração.
 */
export const ACOES_STATUS = Object.freeze({
  BLOQUEADO: {
    botao: 'Bloquear',
    titulo: 'Bloquear usuário',
    pergunta: (nome) => `Bloquear o acesso de ${nome}?`,
    detalhe: () =>
      'O acesso será cortado imediatamente, inclusive se a pessoa estiver usando o Sisto agora. Ela não conseguirá entrar até que o acesso seja reativado.',
    confirmar: 'Bloquear acesso',
    enviando: 'Bloqueando...',
    sucesso: (nome) => `Usuário ${nome} bloqueado.`,
    perigo: true,
  },
  DESATIVADO: {
    botao: 'Desativar',
    titulo: 'Desativar usuário',
    pergunta: (nome) => `Desativar o usuário ${nome}?`,
    detalhe: () =>
      'Use esta opção quando a pessoa deixar a escola. O acesso será cortado imediatamente, inclusive se ela estiver usando o Sisto agora, e ela não conseguirá entrar até que o acesso seja reativado.',
    confirmar: 'Desativar usuário',
    enviando: 'Desativando...',
    sucesso: (nome) => `Usuário ${nome} desativado.`,
    perigo: true,
  },
  ATIVO: {
    botao: 'Reativar',
    titulo: 'Reativar usuário',
    pergunta: (nome) => `Reativar o acesso de ${nome}?`,
    detalhe: (usuario) => {
      const perfil = rotuloPerfil(usuario.perfil);
      return `A pessoa poderá entrar no Sisto novamente com o mesmo e-mail e a mesma senha${
        perfil ? `, com o perfil ${perfil}` : ''
      }.`;
    },
    confirmar: 'Reativar acesso',
    enviando: 'Reativando...',
    sucesso: (nome) => `Usuário ${nome} reativado.`,
    perigo: false,
  },
});

/**
 * Troca entre Bloqueado e Desativado: a pessoa já está sem acesso, então o
 * texto não fala em "cortar o acesso agora" — só muda a situação registrada.
 */
const TROCA_SEM_ACESSO = Object.freeze({
  BLOQUEADO: { titulo: 'Bloquear usuário', confirmar: 'Marcar como bloqueado', enviando: 'Salvando...' },
  DESATIVADO: {
    titulo: 'Desativar usuário',
    confirmar: 'Marcar como desativado',
    enviando: 'Salvando...',
  },
});

/** Textos do diálogo conforme o status atual do usuário e o novo status. */
export function textosConfirmacao(usuario, novoStatus) {
  const base = ACOES_STATUS[novoStatus];
  const troca = TROCA_SEM_ACESSO[novoStatus];
  if (!troca || usuario.status === 'ATIVO' || !rotuloStatus(usuario.status)) {
    return {
      ...base,
      pergunta: base.pergunta(usuario.nome),
      detalhe: base.detalhe(usuario),
    };
  }
  const de = rotuloStatus(usuario.status);
  const para = rotuloStatus(novoStatus);
  return {
    ...base,
    ...troca,
    pergunta: `Mudar a situação de ${usuario.nome} de ${de} para ${para}?`,
    detalhe:
      'A pessoa continua sem acesso ao Sisto; só muda a situação registrada. Ela poderá ser reativada depois.',
    // Não corta acesso agora (botão sem destaque de perigo), mas mantém o
    // aviso de que não há exclusão e o histórico é mantido (RN07).
    perigo: false,
    avisoExclusao: true,
  };
}

/**
 * Diálogo de confirmação antes de bloquear, desativar ou reativar (RF04).
 * Só chama o PUT /usuarios/{id} (com o novo `status`) depois da confirmação.
 * Não existe opção de excluir usuário (RN07).
 *
 * @param {object} props
 * @param {{ id: number, nome: string, perfil: string, status: string }} props.usuario
 * @param {'ATIVO' | 'BLOQUEADO' | 'DESATIVADO'} props.novoStatus
 * @param {(atualizado: object) => void} props.aoConcluir
 * @param {() => void} props.aoCancelar
 * @param {() => void} [props.aoRestaurarFoco]
 * @param {() => void} [props.aoListaDesatualizada] - chamado após 404 ou 409 de alteração simultânea
 */
export default function ConfirmarStatusUsuario({
  usuario,
  novoStatus,
  aoConcluir,
  aoCancelar,
  aoRestaurarFoco,
  aoListaDesatualizada,
}) {
  const acao = textosConfirmacao(usuario, novoStatus);
  const [erro, setErro] = useState('');
  const [enviando, setEnviando] = useState(false);
  const cancelarRef = useRef(null);
  // Trava síncrona contra duplo clique (o estado só muda no próximo render).
  const enviandoRef = useRef(false);

  function cancelar() {
    if (enviandoRef.current) return;
    aoCancelar();
  }

  async function confirmar() {
    if (enviandoRef.current) return;
    enviandoRef.current = true;
    setErro('');
    setEnviando(true);
    try {
      const atualizado = await atualizarUsuario(usuario.id, { status: novoStatus });
      aoConcluir(atualizado ?? { ...usuario, status: novoStatus });
    } catch (falha) {
      enviandoRef.current = false;
      setEnviando(false);
      if (falha?.status === 401) return; // tratamento central: volta ao login com aviso
      if (listaPodeEstarDesatualizada(falha)) aoListaDesatualizada?.();
      setErro(mensagemErroAlteracaoUsuario(falha));
    }
  }

  return (
    <Dialogo
      id="dialogo-status-usuario"
      papel="alertdialog"
      titulo={acao.titulo}
      descricaoId="dialogo-status-usuario-descricao"
      aoFechar={cancelar}
      focoInicialRef={cancelarRef}
      aoRestaurarFoco={aoRestaurarFoco}
    >
      <div id="dialogo-status-usuario-descricao">
        <p className="dialogo__pergunta">{acao.pergunta}</p>
        <p>{acao.detalhe}</p>
        {(acao.perigo || acao.avisoExclusao) && (
          <p className="mensagem mensagem--aviso">{AVISO_SEM_EXCLUSAO}</p>
        )}
      </div>

      {erro && (
        <p className="mensagem mensagem--erro" role="alert">
          {erro}
        </p>
      )}

      <div className="dialogo__acoes" aria-busy={enviando}>
        <button
          type="button"
          className={`botao ${acao.perigo ? 'botao--perigo' : 'botao--primario'}`}
          onClick={confirmar}
          aria-disabled={enviando}
        >
          {enviando ? acao.enviando : acao.confirmar}
        </button>
        <button
          ref={cancelarRef}
          type="button"
          className="botao botao--secundario"
          onClick={cancelar}
          aria-disabled={enviando}
        >
          Cancelar
        </button>
      </div>
    </Dialogo>
  );
}
