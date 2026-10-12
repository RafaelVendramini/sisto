import { describe, it, expect } from 'vitest';
import bcrypt from 'bcrypt';
import {
  executarSeedUsuarios,
  montarUsuariosSeed,
  validarVariaveisSeed,
  normalizarEmail,
  ErroValidacaoSeed,
  USUARIOS_FICTICIOS,
} from '../prisma/seed-usuarios.js';
import { CUSTO_BCRYPT } from '../src/services/senha.js';

// Valores fictícios (RN05) — nenhum teste usa o .env nem o banco.
// Sem NODE_ENV => ambiente não-produção (cria os 5 usuários).
const ENV_VALIDO = Object.freeze({
  SEED_GESTAO_EMAIL: '  Gestao.Teste@Sisto.Exemplo ',
  SEED_GESTAO_SENHA: 'senhaGestaoFicticia1',
  SEED_SENHA_USUARIOS: 'senhaUsuariosFicticia2',
});

// Produção: só a Gestão; SEED_SENHA_USUARIOS não é exigida.
const ENV_PRODUCAO = Object.freeze({
  NODE_ENV: 'production',
  SEED_GESTAO_EMAIL: 'gestao.teste@sisto.exemplo',
  SEED_GESTAO_SENHA: 'senhaGestaoFicticia1',
});

// Custo baixo do bcrypt para acelerar os testes que não verificam o custo.
const RAPIDO = Object.freeze({ custoBcrypt: 4 });

const PERFIS = ['PROFESSOR', 'TUTOR', 'GESTAO', 'PEDAGOGICO', 'TECNICO_ADMINISTRATIVO'];

/** Captura a mensagem do erro lançado por fn (falha o teste se não lançar). */
function mensagemDeErro(fn) {
  try {
    fn();
  } catch (erro) {
    return erro.message;
  }
  throw new Error('Era esperado que a função lançasse erro.');
}

/** Client Prisma falso, em memória, com e-mail único (como o @unique do schema). */
function criarClientFake() {
  const usuarios = [];
  let proximoId = 1;
  const chamadas = { findMany: 0, upsert: 0, transaction: 0 };

  return {
    usuarios,
    chamadas,
    usuario: {
      async findMany({ where }) {
        chamadas.findMany += 1;
        return usuarios.filter((u) => where.email.in.includes(u.email)).map((u) => ({ email: u.email }));
      },
      async upsert({ where, update, create }) {
        chamadas.upsert += 1;
        const existente = usuarios.find((u) => u.email === where.email);
        if (existente) {
          Object.assign(existente, update);
          return { id: existente.id };
        }
        const novo = { id: proximoId++, ...create };
        usuarios.push(novo);
        return { id: novo.id };
      },
    },
    async $transaction(operacoes) {
      chamadas.transaction += 1;
      return Promise.all(operacoes);
    },
  };
}

describe('Seed — validação das variáveis de ambiente', () => {
  it('aceita variáveis válidas e normaliza o e-mail da Gestão (trim + minúsculas)', () => {
    const config = validarVariaveisSeed(ENV_VALIDO);
    expect(config.gestaoEmail).toBe('gestao.teste@sisto.exemplo');
    expect(config.somenteGestao).toBe(false);
    expect(normalizarEmail('  A@B.Exemplo ')).toBe('a@b.exemplo');
  });

  it.each(['SEED_GESTAO_EMAIL', 'SEED_GESTAO_SENHA', 'SEED_SENHA_USUARIOS'])(
    'aborta quando %s está ausente (fora de produção)',
    (nome) => {
      const env = { ...ENV_VALIDO };
      delete env[nome];
      expect(() => validarVariaveisSeed(env)).toThrow(new RegExp(`${nome} não definida`));
    },
  );

  it('lança ErroValidacaoSeed (mensagem segura para exibir)', () => {
    expect(() => validarVariaveisSeed({})).toThrow(ErroValidacaoSeed);
  });

  it('aborta quando uma variável está vazia ou só com espaços (e-mail)', () => {
    expect(() => validarVariaveisSeed({ ...ENV_VALIDO, SEED_GESTAO_SENHA: '' })).toThrow(
      /SEED_GESTAO_SENHA não definida/,
    );
    expect(() => validarVariaveisSeed({ ...ENV_VALIDO, SEED_GESTAO_EMAIL: '   ' })).toThrow(
      /SEED_GESTAO_EMAIL não definida/,
    );
  });

  it.each(['SEED_GESTAO_SENHA', 'SEED_SENHA_USUARIOS'])(
    'aborta quando %s tem menos de 8 caracteres (RN10), sem exibir o valor',
    (nome) => {
      const curta = 'Ab3456x';
      const mensagem = mensagemDeErro(() => validarVariaveisSeed({ ...ENV_VALIDO, [nome]: curta }));
      expect(mensagem).toMatch(new RegExp(`${nome}: A senha deve ter no mínimo 8 caracteres`));
      expect(mensagem).not.toContain(curta);
    },
  );

  it.each(['SEED_GESTAO_SENHA', 'SEED_SENHA_USUARIOS'])(
    'aborta quando %s passa de 72 bytes (limite do bcrypt), sem exibir o valor',
    (nome) => {
      // 40 caracteres, 80 bytes em UTF-8 (cada "ç" ocupa 2 bytes).
      const longa = 'ç'.repeat(40);
      const mensagem = mensagemDeErro(() => validarVariaveisSeed({ ...ENV_VALIDO, [nome]: longa }));
      expect(mensagem).toMatch(new RegExp(`${nome}: A senha deve ter no máximo 72 bytes`));
      expect(mensagem).not.toContain(longa);
    },
  );

  it.each([
    ['SEED_GESTAO_SENHA', 'TROQUE_ESTA_SENHA'],
    ['SEED_SENHA_USUARIOS', 'TROQUE_ESTA_SENHA_TAMBEM'],
    ['SEED_GESTAO_SENHA', 'troque_minha_senha_123'],
  ])('recusa %s com o valor de exemplo do .env.example (prefixo TROQUE_)', (nome, valor) => {
    const mensagem = mensagemDeErro(() => validarVariaveisSeed({ ...ENV_VALIDO, [nome]: valor }));
    expect(mensagem).toMatch(new RegExp(`${nome} ainda usa o valor de exemplo do .env.example`));
    expect(mensagem).not.toContain(valor);
  });

  it('aborta quando o e-mail da Gestão é inválido ou repete um e-mail fictício do seed', () => {
    expect(() => validarVariaveisSeed({ ...ENV_VALIDO, SEED_GESTAO_EMAIL: 'sem-arroba' })).toThrow(
      /SEED_GESTAO_EMAIL não é um e-mail válido/,
    );
    expect(() =>
      validarVariaveisSeed({ ...ENV_VALIDO, SEED_GESTAO_EMAIL: ' PROFESSOR@sisto.exemplo' }),
    ).toThrow(/não pode repetir/);
  });

  it('lista todos os problemas de uma vez e nunca inclui os valores das senhas', () => {
    const mensagem = mensagemDeErro(() =>
      validarVariaveisSeed({ SEED_GESTAO_SENHA: 'curta1', SEED_SENHA_USUARIOS: 'curta2' }),
    );
    expect(mensagem).toMatch(/nada foi gravado/);
    expect(mensagem).toMatch(/SEED_GESTAO_EMAIL não definida/);
    expect(mensagem).toMatch(/SEED_GESTAO_SENHA: A senha deve ter/);
    expect(mensagem).toMatch(/SEED_SENHA_USUARIOS: A senha deve ter/);
    expect(mensagem).not.toContain('curta1');
    expect(mensagem).not.toContain('curta2');
  });
});

describe('Seed — validação em produção (NODE_ENV=production)', () => {
  it('não exige SEED_SENHA_USUARIOS e marca somenteGestao', () => {
    const config = validarVariaveisSeed(ENV_PRODUCAO);
    expect(config.somenteGestao).toBe(true);
    expect(config.senhaUsuarios).toBeNull();
  });

  it('ignora SEED_SENHA_USUARIOS inválida em produção', () => {
    expect(() => validarVariaveisSeed({ ...ENV_PRODUCAO, SEED_SENHA_USUARIOS: 'curta' })).not.toThrow();
  });

  it('continua exigindo e-mail e senha válidos da Gestão', () => {
    const mensagem = mensagemDeErro(() =>
      validarVariaveisSeed({ NODE_ENV: 'production', SEED_GESTAO_SENHA: 'TROQUE_ESTA_SENHA' }),
    );
    expect(mensagem).toMatch(/SEED_GESTAO_EMAIL não definida/);
    expect(mensagem).toMatch(/SEED_GESTAO_SENHA ainda usa o valor de exemplo/);
    expect(mensagem).not.toMatch(/SEED_SENHA_USUARIOS/);
  });
});

describe('Seed — montagem dos usuários', () => {
  it('monta 1 usuário por perfil, todos ATIVO, com e-mails únicos e fictícios', async () => {
    const usuarios = await montarUsuariosSeed(validarVariaveisSeed(ENV_VALIDO), RAPIDO);

    expect(usuarios).toHaveLength(5);
    expect(usuarios.map((u) => u.perfil).sort()).toEqual([...PERFIS].sort());
    expect(usuarios.every((u) => u.status === 'ATIVO')).toBe(true);
    expect(new Set(usuarios.map((u) => u.email)).size).toBe(5);

    const gestao = usuarios.find((u) => u.perfil === 'GESTAO');
    expect(gestao.email).toBe('gestao.teste@sisto.exemplo');
    for (const u of usuarios.filter((x) => x.perfil !== 'GESTAO')) {
      expect(u.email).toMatch(/@sisto\.exemplo$/);
      expect(u.email).toBe(u.email.trim().toLowerCase());
    }
  });

  it('grava somente hash bcrypt válido, sem senha em texto no payload', async () => {
    const usuarios = await montarUsuariosSeed(validarVariaveisSeed(ENV_VALIDO), RAPIDO);
    const payload = JSON.stringify(usuarios);

    expect(payload).not.toContain(ENV_VALIDO.SEED_GESTAO_SENHA);
    expect(payload).not.toContain(ENV_VALIDO.SEED_SENHA_USUARIOS);
    for (const u of usuarios) {
      expect(Object.keys(u).sort()).toEqual(['email', 'nome', 'perfil', 'senha_hash', 'status']);
      expect(u.senha_hash).toMatch(/^\$2[aby]\$\d{2}\$/);
    }

    const gestao = usuarios.find((u) => u.perfil === 'GESTAO');
    expect(await bcrypt.compare(ENV_VALIDO.SEED_GESTAO_SENHA, gestao.senha_hash)).toBe(true);
    expect(await bcrypt.compare(ENV_VALIDO.SEED_SENHA_USUARIOS, gestao.senha_hash)).toBe(false);

    for (const u of usuarios.filter((x) => x.perfil !== 'GESTAO')) {
      expect(await bcrypt.compare(ENV_VALIDO.SEED_SENHA_USUARIOS, u.senha_hash)).toBe(true);
    }

    // Mesma senha, hashes distintos (salt por usuário).
    const demais = usuarios.filter((x) => x.perfil !== 'GESTAO').map((u) => u.senha_hash);
    expect(new Set(demais).size).toBe(USUARIOS_FICTICIOS.length);
  });

  it('usa o custo padrão do bcrypt (12) quando nenhum custo é injetado', async () => {
    // Produção => um único hash, para manter o teste rápido.
    const [gestao] = await montarUsuariosSeed(validarVariaveisSeed(ENV_PRODUCAO));
    expect(bcrypt.getRounds(gestao.senha_hash)).toBe(CUSTO_BCRYPT);
    expect(CUSTO_BCRYPT).toBe(12);
  });
});

describe('Seed — execução com client injetado', () => {
  it('fora de produção cria os 5 usuários, em uma única transação', async () => {
    const client = criarClientFake();

    const resultado = await executarSeedUsuarios(client, ENV_VALIDO, RAPIDO);

    expect(client.usuarios).toHaveLength(5);
    expect(client.usuarios.map((u) => u.perfil).sort()).toEqual([...PERFIS].sort());
    expect(client.chamadas.transaction).toBe(1);
    expect(resultado.criados).toHaveLength(5);
    expect(resultado.existentes).toHaveLength(0);
    expect(JSON.stringify(resultado)).not.toMatch(/senha|\$2[aby]\$/);
  });

  it('em produção cria somente o usuário de Gestão, ATIVO', async () => {
    const client = criarClientFake();

    const resultado = await executarSeedUsuarios(client, ENV_PRODUCAO, RAPIDO);

    expect(client.usuarios).toHaveLength(1);
    expect(client.usuarios[0]).toMatchObject({
      email: 'gestao.teste@sisto.exemplo',
      perfil: 'GESTAO',
      status: 'ATIVO',
    });
    expect(await bcrypt.compare(ENV_PRODUCAO.SEED_GESTAO_SENHA, client.usuarios[0].senha_hash)).toBe(true);
    expect(resultado.criados.map((u) => u.perfil)).toEqual(['GESTAO']);
    expect(client.usuarios.some((u) => u.email.endsWith('@sisto.exemplo') && u.perfil !== 'GESTAO')).toBe(false);
  });

  it('em produção também é idempotente', async () => {
    const client = criarClientFake();
    await executarSeedUsuarios(client, ENV_PRODUCAO, RAPIDO);
    const resultado = await executarSeedUsuarios(client, ENV_PRODUCAO, RAPIDO);

    expect(client.usuarios).toHaveLength(1);
    expect(resultado.criados).toHaveLength(0);
    expect(resultado.existentes).toHaveLength(1);
  });

  it('é idempotente: a segunda execução não duplica nem sobrescreve', async () => {
    const client = criarClientFake();
    await executarSeedUsuarios(client, ENV_VALIDO, RAPIDO);
    const antes = structuredClone(client.usuarios);

    // Simula alterações feitas pela aplicação depois do primeiro seed.
    const professor = client.usuarios.find((u) => u.perfil === 'PROFESSOR');
    professor.status = 'BLOQUEADO';
    const hashGestaoOriginal = client.usuarios.find((u) => u.perfil === 'GESTAO').senha_hash;

    // Segunda execução, inclusive com outra senha no .env.
    const resultado = await executarSeedUsuarios(
      client,
      { ...ENV_VALIDO, SEED_GESTAO_SENHA: 'outraSenhaFicticia9' },
      RAPIDO,
    );

    expect(client.usuarios).toHaveLength(5);
    expect(resultado.criados).toHaveLength(0);
    expect(resultado.existentes).toHaveLength(5);
    // Não reativa usuário bloqueado e não troca senha.
    expect(client.usuarios.find((u) => u.perfil === 'PROFESSOR').status).toBe('BLOQUEADO');
    expect(client.usuarios.find((u) => u.perfil === 'GESTAO').senha_hash).toBe(hashGestaoOriginal);
    // Demais campos inalterados.
    for (const original of antes.filter((u) => u.perfil !== 'PROFESSOR')) {
      expect(client.usuarios.find((u) => u.id === original.id)).toEqual(original);
    }
  });

  it('cria apenas os usuários ausentes', async () => {
    const client = criarClientFake();
    await executarSeedUsuarios(client, ENV_VALIDO, RAPIDO);
    client.usuarios.splice(
      client.usuarios.findIndex((u) => u.perfil === 'TUTOR'),
      1,
    );

    const resultado = await executarSeedUsuarios(client, ENV_VALIDO, RAPIDO);

    expect(client.usuarios).toHaveLength(5);
    expect(resultado.criados.map((u) => u.perfil)).toEqual(['TUTOR']);
    expect(resultado.existentes).toHaveLength(4);
  });

  it('trocar SEED_GESTAO_EMAIL cria uma segunda Gestão e mantém a antiga ATIVA (comportamento documentado)', async () => {
    const client = criarClientFake();
    await executarSeedUsuarios(client, ENV_VALIDO, RAPIDO);

    await executarSeedUsuarios(client, { ...ENV_VALIDO, SEED_GESTAO_EMAIL: 'nova.gestao@sisto.exemplo' }, RAPIDO);

    const gestoes = client.usuarios.filter((u) => u.perfil === 'GESTAO');
    expect(gestoes).toHaveLength(2);
    expect(gestoes.every((u) => u.status === 'ATIVO')).toBe(true);
  });

  it('não acessa o banco quando as variáveis são inválidas', async () => {
    const client = criarClientFake();

    await expect(
      executarSeedUsuarios(client, { ...ENV_VALIDO, SEED_SENHA_USUARIOS: 'curta' }, RAPIDO),
    ).rejects.toThrow(ErroValidacaoSeed);

    expect(client.chamadas).toEqual({ findMany: 0, upsert: 0, transaction: 0 });
    expect(client.usuarios).toHaveLength(0);
  });
});
