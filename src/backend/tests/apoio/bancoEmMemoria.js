// "Banco" em memória que imita o Prisma nos testes do `npm test` — Sisto
// (Issue #129). Antes, este motor estava copiado em cada arquivo de teste de
// ocorrências e de relatórios; as variações entre as cópias viraram opções.
//
// O motor AVALIA o `where`, o `select` e o `orderBy` gerados pelos services
// sobre tabelas em memória (arrays de registros com os campos snake_case do
// schema.prisma). Não há banco de verdade: nenhum teste do `npm test` abre
// conexão (ver tests/setup-unitarios.js).
//
// Uso típico (o arquivo de teste continua dono do estado e da transação):
//
//   let banco;
//   const { clientMock } = criarBancoEmMemoria({ obterBanco: () => banco });
//   vi.mock('../src/lib/prisma.js', () => ({ default: new Proxy({}, {
//     get: (_a, prop) => (prop === '$transaction' ? ... : clientMock()[prop]),
//   }) }));
//
// `obterBanco` é uma função porque os testes REATRIBUEM `banco` (montagem a
// cada teste e rollback da transação com structuredClone).
//
// Suportado no `where`: AND, OR, igualdade (Date comparada pelo instante),
// `in`, `gte`/`lte` (com Date), relação "um" (objeto aninhado) e relação
// "muitos" com `some`. Qualquer outro operador ou campo inexistente lança
// erro "mock: ...", para o teste falhar em vez de passar por engano.

/** Tabelas do schema usadas pelos testes de ocorrências (modelo do Prisma → chave no `banco`). */
export const TABELAS_OCORRENCIAS = Object.freeze({
  usuario: 'usuarios',
  turma: 'turmas',
  categoria: 'categorias',
  estudante: 'estudantes',
  ocorrencia: 'ocorrencias',
  ocorrenciaEstudante: 'ocorrenciasEstudantes',
  encaminhamento: 'encaminhamentos',
  comunicacao: 'comunicacoes',
  providencia: 'providencias',
  historicoOcorrencia: 'historicos',
  logAuditoria: 'logs',
});

/**
 * Relações do schema usadas pelos testes de ocorrências.
 * Formato: ['um', modelo, campo FK] ou ['muitos', modelo, campo FK no filho].
 */
export const RELACOES_OCORRENCIAS = Object.freeze({
  ocorrencia: {
    turma: ['um', 'turma', 'turma_id'],
    categoria: ['um', 'categoria', 'categoria_id'],
    profissional_responsavel: ['um', 'usuario', 'profissional_responsavel_id'],
    responsavel_acompanhamento: ['um', 'usuario', 'responsavel_acompanhamento_id'],
    estudantes: ['muitos', 'ocorrenciaEstudante', 'ocorrencia_id'],
    encaminhamentos: ['muitos', 'encaminhamento', 'ocorrencia_id'],
  },
  ocorrenciaEstudante: {
    ocorrencia: ['um', 'ocorrencia', 'ocorrencia_id'],
    estudante: ['um', 'estudante', 'estudante_id'],
  },
  estudante: {
    turma: ['um', 'turma', 'turma_id'],
    tutor: ['um', 'usuario', 'tutor_id'],
  },
  encaminhamento: {
    destinatario_usuario: ['um', 'usuario', 'destinatario_usuario_id'],
    registrado_por: ['um', 'usuario', 'registrado_por_id'],
  },
  comunicacao: { registrado_por: ['um', 'usuario', 'registrado_por_id'] },
  providencia: { registrado_por: ['um', 'usuario', 'registrado_por_id'] },
});

/** Operações de escrita do delegado (útil para registrar só as gravações). */
export const OPERACOES_ESCRITA = Object.freeze(['create', 'createMany', 'update']);

/** Date vira o instante em ms; os demais valores ficam como estão. */
export const comoNumero = (valor) => (valor instanceof Date ? valor.getTime() : valor);

/** Total de relações num select (inclusive aninhadas) — limite do aviso do pg. */
function contarRelacoes(select) {
  return Object.values(select ?? {}).reduce(
    (total, valor) =>
      valor && typeof valor === 'object' ? total + 1 + contarRelacoes(valor.select) : total,
    0,
  );
}

/**
 * Cria o motor do banco em memória.
 * @param {object} opcoes
 * @param {() => object} opcoes.obterBanco devolve o objeto `banco` atual do teste
 * @param {Record<string, string>} [opcoes.tabelas] modelo → chave no `banco` (padrão TABELAS_OCORRENCIAS)
 * @param {object} [opcoes.relacoes] relações por modelo (padrão RELACOES_OCORRENCIAS)
 * @param {Record<string, () => object>} [opcoes.padroes] valores padrão no create, por modelo (@default do schema)
 * @param {number | null} [opcoes.limiteRelacoes] máximo de relações num select (aviso do pg); null = sem limite
 * @param {boolean} [opcoes.selectAninhado] false = select de relação lança erro (consultas que não devem usá-lo)
 * @param {(modelo: string, operacao: string, args: object | undefined, contexto: unknown) => void} [opcoes.aoOperar]
 *   chamado em toda operação do delegado, antes de executá-la (ex.: registrar escritas ou consultas na transação)
 * @param {string[]} [opcoes.modelosSemId] modelos sem id autoincremento (PK composta)
 */
export function criarBancoEmMemoria({
  obterBanco,
  tabelas = TABELAS_OCORRENCIAS,
  relacoes = RELACOES_OCORRENCIAS,
  padroes = {},
  limiteRelacoes = null,
  selectAninhado = true,
  aoOperar = () => {},
  modelosSemId = ['ocorrenciaEstudante'],
}) {
  const linhas = (modelo) => obterBanco()[tabelas[modelo]];

  function relacionado(modelo, registro, campo) {
    const [tipo, alvo, fk] = relacoes[modelo][campo];
    if (tipo === 'um') {
      return registro[fk] == null ? null : (linhas(alvo).find((r) => r.id === registro[fk]) ?? null);
    }
    return linhas(alvo).filter((r) => r[fk] === registro.id);
  }

  /** Avalia um `where` do Prisma sobre um registro. */
  function corresponde(modelo, registro, where = {}) {
    return Object.entries(where).every(([chave, condicao]) => {
      if (chave === 'AND') return condicao.every((w) => corresponde(modelo, registro, w));
      if (chave === 'OR') return condicao.some((w) => corresponde(modelo, registro, w));
      const relacao = relacoes[modelo]?.[chave];
      if (relacao) {
        const [tipo, alvo] = relacao;
        if (tipo === 'muitos') {
          const operadores = Object.keys(condicao);
          if (operadores.length !== 1 || operadores[0] !== 'some') {
            throw new Error(`mock: operador de lista não suportado em ${modelo}.${chave}`);
          }
          return relacionado(modelo, registro, chave).some((f) => corresponde(alvo, f, condicao.some));
        }
        const pai = relacionado(modelo, registro, chave);
        return pai !== null && corresponde(alvo, pai, condicao);
      }
      if (!(chave in registro)) throw new Error(`mock: campo inexistente ${modelo}.${chave}`);
      const valor = registro[chave];
      if (condicao !== null && typeof condicao === 'object' && !(condicao instanceof Date)) {
        return Object.entries(condicao).every(([operador, alvo]) => {
          if (operador === 'in') return alvo.includes(valor);
          if (operador === 'gte' || operador === 'lte') {
            if (!(alvo instanceof Date)) {
              throw new Error(`mock: ${operador} exige Date em ${modelo}.${chave}`);
            }
            return operador === 'gte'
              ? comoNumero(valor) >= alvo.getTime()
              : comoNumero(valor) <= alvo.getTime();
          }
          throw new Error(`mock: operador ${operador} não suportado em ${modelo}.${chave}`);
        });
      }
      return comoNumero(valor) === comoNumero(condicao);
    });
  }

  function selecionar(modelo, registro, select) {
    if (!select) return { ...registro };
    return Object.fromEntries(
      Object.entries(select).map(([campo, valor]) => {
        if (valor === true) {
          if (!(campo in registro)) throw new Error(`mock: campo inexistente ${modelo}.${campo}`);
          return [campo, registro[campo]];
        }
        if (!selectAninhado) {
          throw new Error(`mock: select aninhado não previsto em ${modelo}.${campo}`);
        }
        const [tipo, alvo] = relacoes[modelo][campo];
        const rel = relacionado(modelo, registro, campo);
        if (tipo === 'muitos') return [campo, rel.map((r) => selecionar(alvo, r, valor.select))];
        return [campo, rel === null ? null : selecionar(alvo, rel, valor.select)];
      }),
    );
  }

  function valorOrdenacao(modelo, registro, especificacao) {
    const [[campo, direcao]] = Object.entries(especificacao);
    if (typeof direcao === 'object') {
      const [, alvo] = relacoes[modelo][campo];
      return valorOrdenacao(alvo, relacionado(modelo, registro, campo), direcao);
    }
    return { valor: comoNumero(registro[campo]), direcao };
  }

  function ordenar(modelo, registros, orderBy) {
    if (!orderBy) return registros;
    const criterios = Array.isArray(orderBy) ? orderBy : [orderBy];
    return [...registros].sort((a, b) => {
      for (const criterio of criterios) {
        const va = valorOrdenacao(modelo, a, criterio);
        const vb = valorOrdenacao(modelo, b, criterio);
        if (va.valor === vb.valor) continue;
        const menor = va.valor < vb.valor ? -1 : 1;
        return va.direcao === 'desc' ? -menor : menor;
      }
      return 0;
    });
  }

  /** Insere com os valores padrão do modelo e o próximo id (exceto PK composta). */
  function inserir(modelo, data) {
    const tabela = linhas(modelo);
    const registro = { ...(padroes[modelo]?.() ?? {}), ...data };
    if (!modelosSemId.includes(modelo)) registro.id = Math.max(0, ...tabela.map((r) => r.id)) + 1;
    tabela.push(registro);
    return registro;
  }

  /**
   * Delegado de um modelo (prisma.<modelo>): findMany (com skip/take), count,
   * findFirst, findUnique, create, createMany e update (P2025 se não achar).
   * @param {string} modelo
   * @param {unknown} [contexto] repassado ao aoOperar (ex.: true dentro da transação)
   */
  function delegado(modelo, contexto) {
    const anotar = (operacao, args) => {
      aoOperar(modelo, operacao, args, contexto);
      if (limiteRelacoes !== null && contarRelacoes(args?.select) > limiteRelacoes) {
        throw new Error(
          `mock: mais de ${limiteRelacoes} relações numa consulta de ${modelo} (aviso do pg)`,
        );
      }
    };
    const buscar = (args = {}) =>
      ordenar(modelo, linhas(modelo).filter((r) => corresponde(modelo, r, args.where)), args.orderBy);
    return {
      findMany: async (args) => {
        anotar('findMany', args);
        // skip/take: paginação do GET /ocorrencias (Issue #86).
        const inicio = args?.skip ?? 0;
        const fim = args?.take === undefined ? undefined : inicio + args.take;
        return buscar(args)
          .slice(inicio, fim)
          .map((r) => selecionar(modelo, r, args?.select));
      },
      count: async (args) => {
        anotar('count', args);
        return buscar(args).length;
      },
      findFirst: async (args) => {
        anotar('findFirst', args);
        const [r] = buscar(args);
        return r ? selecionar(modelo, r, args?.select) : null;
      },
      findUnique: async (args) => {
        anotar('findUnique', args);
        const [r] = buscar(args);
        return r ? selecionar(modelo, r, args?.select) : null;
      },
      create: async ({ data, select }) => {
        anotar('create', { data, select });
        return selecionar(modelo, inserir(modelo, data), select);
      },
      createMany: async ({ data }) => {
        anotar('createMany', { data });
        data.forEach((d) => inserir(modelo, d));
        return { count: data.length };
      },
      update: async ({ where, data, select }) => {
        anotar('update', { where, data, select });
        const [r] = buscar({ where });
        if (!r) throw Object.assign(new Error('mock: registro não encontrado'), { code: 'P2025' });
        Object.assign(r, data);
        return selecionar(modelo, r, select);
      },
    };
  }

  /** Client com um delegado por modelo de `tabelas`. */
  function clientMock(contexto) {
    return Object.fromEntries(Object.keys(tabelas).map((m) => [m, delegado(m, contexto)]));
  }

  return { linhas, relacionado, corresponde, selecionar, ordenar, inserir, delegado, clientMock };
}
