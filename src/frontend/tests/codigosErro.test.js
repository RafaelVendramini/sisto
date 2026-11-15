// Issue #72 (D1) — o front-end identifica os 409 e o 403 da troca de senha
// pendente pelo `codigo` do corpo de erro, com o texto só como reserva quando
// o código não vem. Somente dados fictícios (RN05 / LGPD).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
// Ligação intencional com o back-end (só neste teste, não vai para o build):
// detecta na hora qualquer diferença entre os catálogos de códigos. Exige as
// duas pastas no mesmo repositório; erros.js não importa nada do back-end.
import { CODIGOS_ERRO as CODIGOS_BACKEND } from '../../backend/src/lib/erros.js';
import {
  CODIGOS_ERRO,
  codigoDaFalha,
  falhaTemCodigo,
} from '../src/services/codigosErro.js';
import {
  requisicao,
  ErroApi,
  definirAoTrocaSenhaPendente,
} from '../src/services/api.js';
import { MENSAGEM_TROCA_SENHA_PENDENTE } from '../src/services/mensagens.js';
import * as categorias from '../src/services/mensagensCategorias.js';
import * as turmas from '../src/services/mensagensTurmas.js';
import * as estudantes from '../src/services/mensagensEstudantes.js';
import * as usuarios from '../src/services/mensagensUsuarios.js';
import {
  MENSAGEM_CONFLITO_OCORRENCIA,
  MENSAGEM_ENCERRAR_SEM_PROVIDENCIA,
  mensagemErroEncerramento,
  mensagemErroProvidencia,
  mensagemReservaConflitoOcorrencia,
} from '../src/services/mensagensOcorrencias.js';

function respostaFalsa(status, corpo) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => (corpo === undefined ? '' : JSON.stringify(corpo)),
  };
}

/** Falha como o ErroApi a entrega às telas. */
function falha409(message, codigo) {
  return { status: 409, message, doServidor: true, codigo: codigo ?? null };
}

describe('codigosErro: espelho dos códigos do back-end', () => {
  it('tem exatamente os mesmos códigos e valores de src/backend/src/lib/erros.js', () => {
    expect(CODIGOS_ERRO).toEqual({ ...CODIGOS_BACKEND });
    expect(Object.isFrozen(CODIGOS_ERRO)).toBe(true);
  });

  it('cada código tem como valor o próprio nome', () => {
    for (const [nome, valor] of Object.entries(CODIGOS_ERRO)) expect(valor).toBe(nome);
  });
});

describe('codigosErro: auxiliares', () => {
  it('codigoDaFalha devolve o código só quando é texto não vazio', () => {
    expect(codigoDaFalha({ codigo: 'EMAIL_DUPLICADO' })).toBe('EMAIL_DUPLICADO');
    expect(codigoDaFalha({ codigo: '' })).toBeNull();
    expect(codigoDaFalha({ codigo: 409 })).toBeNull();
    expect(codigoDaFalha({})).toBeNull();
    expect(codigoDaFalha(null)).toBeNull();
  });

  it('com código, só ele decide; a reserva não é consultada', () => {
    const reserva = vi.fn(() => true);
    expect(falhaTemCodigo({ codigo: 'A' }, 'A', reserva)).toBe(true);
    expect(falhaTemCodigo({ codigo: 'B' }, 'A', reserva)).toBe(false);
    expect(reserva).not.toHaveBeenCalled();
  });

  it('sem código, decide a reserva (e sem reserva é falso)', () => {
    expect(falhaTemCodigo({}, 'A', () => true)).toBe(true);
    expect(falhaTemCodigo({}, 'A', () => false)).toBe(false);
    expect(falhaTemCodigo({}, 'A')).toBe(false);
  });
});

describe('api: ErroApi guarda o código do corpo', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_API_URL', 'http://api.exemplo.test');
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('409 com { erro, codigo }: a falha traz mensagem, status e código', async () => {
    fetch.mockResolvedValue(
      respostaFalsa(409, { erro: 'Já existe uma categoria cadastrada com este nome.', codigo: 'CATEGORIA_DUPLICADA' }),
    );
    const erro = await requisicao('/categorias', { metodo: 'POST', corpo: {} }).catch((e) => e);
    expect(erro).toBeInstanceOf(ErroApi);
    expect(erro.status).toBe(409);
    expect(erro.message).toBe('Já existe uma categoria cadastrada com este nome.');
    expect(erro.doServidor).toBe(true);
    expect(erro.codigo).toBe('CATEGORIA_DUPLICADA');
  });

  it('sem código no corpo (ou código inválido), a falha traz codigo null', async () => {
    fetch.mockResolvedValueOnce(respostaFalsa(400, { erro: 'Dado inválido.' }));
    expect((await requisicao('/x').catch((e) => e)).codigo).toBeNull();
    fetch.mockResolvedValueOnce(respostaFalsa(409, { erro: 'Conflito.', codigo: 123 }));
    expect((await requisicao('/x').catch((e) => e)).codigo).toBeNull();
    fetch.mockResolvedValueOnce(respostaFalsa(500));
    expect((await requisicao('/x').catch((e) => e)).codigo).toBeNull();
  });

  it('o construtor aceita o código como 4º argumento (padrão null)', () => {
    expect(new ErroApi('m', 409, true, 'EMAIL_DUPLICADO').codigo).toBe('EMAIL_DUPLICADO');
    expect(new ErroApi('m', 409).codigo).toBeNull();
  });

  describe('403 da troca de senha pendente (RN10)', () => {
    let aviso;
    let remover;
    beforeEach(() => {
      aviso = vi.fn();
      remover = definirAoTrocaSenhaPendente(aviso);
    });
    afterEach(() => remover());

    async function chamar403(corpo) {
      fetch.mockResolvedValue(respostaFalsa(403, corpo));
      return requisicao('/usuarios', { token: 'token-ficticio' }).catch((e) => e);
    }

    it('com o código TROCA_SENHA_OBRIGATORIA avisa, mesmo com outro texto', async () => {
      const erro = await chamar403({ erro: 'Texto fictício.', codigo: 'TROCA_SENHA_OBRIGATORIA' });
      expect(aviso).toHaveBeenCalledTimes(1);
      expect(erro.codigo).toBe('TROCA_SENHA_OBRIGATORIA');
    });

    it('com o texto da troca mas outro código não avisa', async () => {
      await chamar403({ erro: MENSAGEM_TROCA_SENHA_PENDENTE, codigo: 'OUTRO_CODIGO_FICTICIO' });
      expect(aviso).not.toHaveBeenCalled();
    });

    it('sem código, a reserva é o texto da troca', async () => {
      await chamar403({ erro: MENSAGEM_TROCA_SENHA_PENDENTE });
      expect(aviso).toHaveBeenCalledTimes(1);
    });

    it('sem código e com outro texto (perfil sem permissão) não avisa', async () => {
      await chamar403({ erro: 'Acesso não permitido para o seu perfil.' });
      expect(aviso).not.toHaveBeenCalled();
    });

    it('chamada sem token (ex.: login) não avisa, mesmo com o código', async () => {
      fetch.mockResolvedValue(
        respostaFalsa(403, { erro: 'x', codigo: 'TROCA_SENHA_OBRIGATORIA' }),
      );
      await requisicao('/auth/login', { metodo: 'POST', corpo: {} }).catch((e) => e);
      expect(aviso).not.toHaveBeenCalled();
    });
  });
});

// Mesma mensagem, códigos diferentes => tratamentos diferentes; sem código,
// vale a reserva pelo texto (comportamento anterior à #72).
describe.each([
  {
    nome: 'categorias',
    modulo: categorias,
    ehDuplicado: categorias.ehConflitoDeNome,
    codigoDuplicado: 'CATEGORIA_DUPLICADA',
    msgDuplicado: categorias.MENSAGEM_CATEGORIA_DUPLICADA,
    msgConcorrencia: categorias.MENSAGEM_ALTERACAO_SIMULTANEA_CATEGORIA,
  },
  {
    nome: 'turmas',
    modulo: turmas,
    ehDuplicado: turmas.ehTurmaDuplicada,
    codigoDuplicado: 'TURMA_DUPLICADA',
    msgDuplicado: turmas.MENSAGEM_TURMA_DUPLICADA,
    msgConcorrencia: turmas.MENSAGEM_ALTERACAO_SIMULTANEA_TURMA,
  },
  {
    nome: 'estudantes',
    modulo: estudantes,
    ehDuplicado: estudantes.ehCodigoDuplicado,
    codigoDuplicado: 'CODIGO_ESCOLAR_DUPLICADO',
    msgDuplicado: estudantes.MENSAGEM_CODIGO_ESCOLAR_DUPLICADO,
    msgConcorrencia: estudantes.MENSAGEM_ALTERACAO_SIMULTANEA_ESTUDANTE,
  },
])('$nome: 409 identificado pelo código', ({ modulo, ehDuplicado, codigoDuplicado, msgDuplicado, msgConcorrencia }) => {
  it('mesmo texto, códigos diferentes: duplicidade x alteração simultânea', () => {
    for (const texto of [msgDuplicado, msgConcorrencia, 'Texto fictício.']) {
      const dup = falha409(texto, codigoDuplicado);
      const conc = falha409(texto, 'CONFLITO_CONCORRENTE');
      expect(ehDuplicado(dup)).toBe(true);
      expect(modulo.listaPodeEstarDesatualizada(dup)).toBe(false);
      expect(ehDuplicado(conc)).toBe(false);
      expect(modulo.listaPodeEstarDesatualizada(conc)).toBe(true);
    }
  });

  it('sem código, a reserva é o texto (como antes da #72)', () => {
    expect(ehDuplicado(falha409(msgDuplicado))).toBe(true);
    expect(modulo.listaPodeEstarDesatualizada(falha409(msgDuplicado))).toBe(false);
    expect(ehDuplicado(falha409(msgConcorrencia))).toBe(false);
    expect(modulo.listaPodeEstarDesatualizada(falha409(msgConcorrencia))).toBe(true);
  });

  it('o código só vale no 409; 404 continua pedindo recarga', () => {
    expect(ehDuplicado({ status: 400, codigo: codigoDuplicado })).toBe(false);
    expect(modulo.listaPodeEstarDesatualizada({ status: 400, codigo: 'CONFLITO_CONCORRENTE' })).toBe(false);
    expect(modulo.listaPodeEstarDesatualizada({ status: 404 })).toBe(true);
  });
});

describe('usuários: 409 identificado pelo código', () => {
  const { MENSAGEM_EMAIL_DUPLICADO, MENSAGEM_ALTERACAO_SIMULTANEA } = usuarios;

  it('edição: EMAIL_DUPLICADO vai para o campo; o mesmo texto com outro código não', () => {
    expect(usuarios.ehConflitoDeEmail(falha409('Texto fictício.', 'EMAIL_DUPLICADO'))).toBe(true);
    expect(usuarios.ehConflitoDeEmail(falha409(MENSAGEM_EMAIL_DUPLICADO, 'GESTAO_ATIVA_MINIMA'))).toBe(false);
    expect(usuarios.ehConflitoDeEmail(falha409(MENSAGEM_EMAIL_DUPLICADO, 'CONFLITO_CONCORRENTE'))).toBe(false);
  });

  it('edição sem código: reserva pelo texto exato do servidor', () => {
    expect(usuarios.ehConflitoDeEmail(falha409(MENSAGEM_EMAIL_DUPLICADO))).toBe(true);
    expect(usuarios.ehConflitoDeEmail(falha409('Não foi possível alterar o e-mail agora.'))).toBe(false);
    expect(
      usuarios.ehConflitoDeEmail({ status: 409, message: MENSAGEM_EMAIL_DUPLICADO, doServidor: false }),
    ).toBe(false);
  });

  it('cadastro: só EMAIL_DUPLICADO vai para o campo; sem código, todo 409 vai (reserva)', () => {
    expect(usuarios.ehEmailDuplicadoNoCadastro(falha409('x', 'EMAIL_DUPLICADO'))).toBe(true);
    expect(usuarios.ehEmailDuplicadoNoCadastro(falha409(MENSAGEM_EMAIL_DUPLICADO, 'CONFLITO_CONCORRENTE'))).toBe(false);
    expect(usuarios.ehEmailDuplicadoNoCadastro(falha409('x'))).toBe(true);
    expect(usuarios.ehEmailDuplicadoNoCadastro({ status: 400, codigo: 'EMAIL_DUPLICADO' })).toBe(false);
  });

  it('recarga da lista: CONFLITO_CONCORRENTE pelo código; regras (RN11/RN13) não recarregam', () => {
    expect(usuarios.listaPodeEstarDesatualizada(falha409('Texto fictício.', 'CONFLITO_CONCORRENTE'))).toBe(true);
    for (const codigo of ['GESTAO_ATIVA_MINIMA', 'ALTERAR_PROPRIO_ACESSO', 'TUTOR_COM_TUTORADOS', 'EMAIL_DUPLICADO']) {
      expect(usuarios.listaPodeEstarDesatualizada(falha409(MENSAGEM_ALTERACAO_SIMULTANEA, codigo))).toBe(false);
    }
    expect(usuarios.listaPodeEstarDesatualizada(falha409(MENSAGEM_ALTERACAO_SIMULTANEA))).toBe(true);
    expect(usuarios.listaPodeEstarDesatualizada(falha409('Outro texto.'))).toBe(false);
  });
});

describe('ocorrências: 409 da providência e do encerramento', () => {
  it('com a mensagem do back-end, ela é exibida para qualquer código', () => {
    for (const codigo of [
      'OCORRENCIA_ABERTA',
      'OCORRENCIA_ENCERRADA',
      'ENCERRAMENTO_SEM_PROVIDENCIA',
      'CONFLITO_CONCORRENTE',
    ]) {
      expect(mensagemErroEncerramento(falha409('Do servidor.', codigo))).toBe('Do servidor.');
      expect(mensagemErroProvidencia(falha409('Do servidor.', codigo))).toBe('Do servidor.');
    }
  });

  it('sem a mensagem, o código escolhe o texto reserva', () => {
    expect(mensagemErroEncerramento({ status: 409, codigo: 'ENCERRAMENTO_SEM_PROVIDENCIA' })).toBe(
      MENSAGEM_ENCERRAR_SEM_PROVIDENCIA,
    );
    for (const codigo of ['OCORRENCIA_ABERTA', 'OCORRENCIA_ENCERRADA', 'CONFLITO_CONCORRENTE']) {
      expect(mensagemErroEncerramento({ status: 409, codigo })).toBe(MENSAGEM_CONFLITO_OCORRENCIA);
      expect(mensagemErroProvidencia({ status: 409, codigo })).toBe(MENSAGEM_CONFLITO_OCORRENCIA);
    }
  });

  it('sem mensagem e sem código: texto padrão de conflito (como antes)', () => {
    expect(mensagemReservaConflitoOcorrencia({ status: 409 })).toBe(MENSAGEM_CONFLITO_OCORRENCIA);
    expect(mensagemErroEncerramento({ status: 409 })).toBe(MENSAGEM_CONFLITO_OCORRENCIA);
  });
});
