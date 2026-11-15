// Testes do modelo de dados de ocorrências e auditoria (Subtask #8 — SSD Seção 11).
// Nenhum teste aqui abre conexão com o banco.
//
// Fonte das verificações (mesma abordagem de schema-cadastros.test.js):
// - DMMF do client gerado (`Prisma.dmmf`) + enums/ScalarFieldEnum exportados:
//   models, campos, kind (scalar/enum/object), tipo, relações e nome da tabela.
// - O DMMF de runtime do Prisma 7 não expõe isRequired, isId, isUnique, default,
//   onDelete nem chave primária composta. Para esses modificadores lemos o
//   schema.prisma, restrito ao bloco do model em questão.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Prisma, StatusOcorrencia, DestinatarioPerfil, Perfil } from '@prisma/client';

const MODELS_COM_ID = [
  'Ocorrencia',
  'Encaminhamento',
  'Providencia',
  'Comunicacao',
  'HistoricoOcorrencia',
  'LogAuditoria',
];
const MODELS_OCORRENCIA = [...MODELS_COM_ID, 'OcorrenciaEstudante'];

// Campos exatamente como na Seção 11 do SSD v1.2.
const CAMPOS_SECAO_11 = {
  Ocorrencia: [
    'id',
    'data_hora',
    'local',
    'turma_id',
    'categoria_id',
    'descricao',
    'demais_envolvidos',
    'testemunhas',
    'providencias_imediatas',
    'observacoes',
    'profissional_responsavel_id',
    'responsavel_acompanhamento_id',
    'status',
    'data_encerramento',
  ],
  OcorrenciaEstudante: ['ocorrencia_id', 'estudante_id'],
  Encaminhamento: [
    'id',
    'ocorrencia_id',
    'destinatario_perfil',
    'destinatario_usuario_id',
    'registrado_por_id',
    'data_hora',
    'observacao',
  ],
  Providencia: ['id', 'ocorrencia_id', 'descricao', 'registrado_por_id', 'data_hora'],
  Comunicacao: [
    'id',
    'ocorrencia_id',
    'destinatario',
    'meio',
    'descricao',
    'registrado_por_id',
    'data_hora',
  ],
  HistoricoOcorrencia: ['id', 'ocorrencia_id', 'usuario_id', 'acao', 'descricao', 'data_hora'],
  LogAuditoria: ['id', 'usuario_id', 'acao', 'recurso', 'data_hora'],
};

// Toda FK *_id: model -> { campoFk: campoRelacao }
const FKS = {
  Ocorrencia: {
    turma_id: 'turma',
    categoria_id: 'categoria',
    profissional_responsavel_id: 'profissional_responsavel',
    responsavel_acompanhamento_id: 'responsavel_acompanhamento',
  },
  OcorrenciaEstudante: { ocorrencia_id: 'ocorrencia', estudante_id: 'estudante' },
  Encaminhamento: {
    ocorrencia_id: 'ocorrencia',
    destinatario_usuario_id: 'destinatario_usuario',
    registrado_por_id: 'registrado_por',
  },
  Providencia: { ocorrencia_id: 'ocorrencia', registrado_por_id: 'registrado_por' },
  Comunicacao: { ocorrencia_id: 'ocorrencia', registrado_por_id: 'registrado_por' },
  HistoricoOcorrencia: { ocorrencia_id: 'ocorrencia', usuario_id: 'usuario' },
  LogAuditoria: { usuario_id: 'usuario' },
};

// Relações que apontam para Usuario (RN07)
const RELACOES_USUARIO = [
  ['Ocorrencia', 'profissional_responsavel'],
  ['Ocorrencia', 'responsavel_acompanhamento'],
  ['Encaminhamento', 'destinatario_usuario'],
  ['Encaminhamento', 'registrado_por'],
  ['Providencia', 'registrado_por'],
  ['Comunicacao', 'registrado_por'],
  ['HistoricoOcorrencia', 'usuario'],
  ['LogAuditoria', 'usuario'],
];

// ---------------------------------------------------------------------------
// DMMF do client gerado
// ---------------------------------------------------------------------------
function modelDmmf(nome) {
  const model = Prisma.dmmf.datamodel.models.find((m) => m.name === nome);
  if (!model) throw new Error(`model ${nome} não encontrado no client gerado`);
  return model;
}

function campoDmmf(model, campo) {
  const encontrado = modelDmmf(model).fields.find((f) => f.name === campo);
  if (!encontrado) throw new Error(`campo ${model}.${campo} não encontrado no client gerado`);
  return encontrado;
}

// ---------------------------------------------------------------------------
// Modificadores não expostos pelo DMMF de runtime. Leitura restrita ao bloco
// do model (linha do campo ou atributos de bloco @@).
// ---------------------------------------------------------------------------
const schemaTexto = readFileSync(
  fileURLToPath(new URL('../prisma/schema.prisma', import.meta.url)),
  'utf8',
);

function linhasDoModel(model) {
  const bloco = schemaTexto.match(new RegExp(`^model ${model} \\{\\r?\\n([\\s\\S]*?)^\\}`, 'm'));
  if (!bloco) throw new Error(`model ${model} não encontrado no schema.prisma`);
  return bloco[1]
    .split(/\r?\n/)
    .map((l) => l.replace(/\/\/.*$/, '').trim()) // descarta comentários
    .filter(Boolean);
}

function linhaDoCampo(model, campo) {
  for (const linha of linhasDoModel(model)) {
    const partes = linha.match(/^(\w+)\s+(\w+)(\[\])?(\?)?\s*(.*)$/);
    if (partes && partes[1] === campo) {
      return { opcional: partes[4] === '?', atributos: partes[5] };
    }
  }
  throw new Error(`campo ${model}.${campo} não encontrado no schema.prisma`);
}

function atributosDeBloco(model) {
  return linhasDoModel(model).filter((l) => l.startsWith('@@'));
}

function onDeleteDaRelacao(model, campo) {
  const { atributos } = linhaDoCampo(model, campo);
  return atributos.match(/@relation\([^)]*onDelete:\s*(\w+)/)?.[1] ?? null;
}

// ---------------------------------------------------------------------------

describe('Schema de ocorrências — models, campos e enums (DMMF)', () => {
  it('contém os models de ocorrência e auditoria', () => {
    expect(Object.keys(Prisma.ModelName)).toEqual(expect.arrayContaining(MODELS_OCORRENCIA));
  });

  it('cada model tem somente os campos da Seção 11 (nada inventado, nada omitido)', () => {
    for (const [model, campos] of Object.entries(CAMPOS_SECAO_11)) {
      expect(Object.keys(Prisma[`${model}ScalarFieldEnum`]).sort(), model).toEqual(
        [...campos].sort(),
      );
    }
  });

  it('mapeia as tabelas para nomes no plural snake_case', () => {
    expect(modelDmmf('Ocorrencia').dbName).toBe('ocorrencias');
    expect(modelDmmf('OcorrenciaEstudante').dbName).toBe('ocorrencias_estudantes');
    expect(modelDmmf('Encaminhamento').dbName).toBe('encaminhamentos');
    expect(modelDmmf('Providencia').dbName).toBe('providencias');
    expect(modelDmmf('Comunicacao').dbName).toBe('comunicacoes');
    expect(modelDmmf('HistoricoOcorrencia').dbName).toBe('historicos_ocorrencia');
    expect(modelDmmf('LogAuditoria').dbName).toBe('logs_auditoria');
  });

  it('ids e chaves estrangeiras são Int', () => {
    for (const model of MODELS_COM_ID) {
      expect(campoDmmf(model, 'id'), model).toMatchObject({ kind: 'scalar', type: 'Int' });
    }
    for (const [model, fks] of Object.entries(FKS)) {
      for (const fk of Object.keys(fks)) {
        expect(campoDmmf(model, fk), `${model}.${fk}`).toMatchObject({ kind: 'scalar', type: 'Int' });
      }
    }
  });

  it('campos de data/hora são DateTime', () => {
    expect(campoDmmf('Ocorrencia', 'data_encerramento')).toMatchObject({ kind: 'scalar', type: 'DateTime' });
    for (const model of MODELS_COM_ID) {
      expect(campoDmmf(model, 'data_hora'), model).toMatchObject({ kind: 'scalar', type: 'DateTime' });
    }
  });

  it('campos textuais são String', () => {
    const textuais = {
      Ocorrencia: [
        'local',
        'descricao',
        'demais_envolvidos',
        'testemunhas',
        'providencias_imediatas',
        'observacoes',
      ],
      Encaminhamento: ['observacao'],
      Providencia: ['descricao'],
      Comunicacao: ['destinatario', 'meio', 'descricao'],
      HistoricoOcorrencia: ['acao', 'descricao'],
      LogAuditoria: ['acao', 'recurso'],
    };
    for (const [model, campos] of Object.entries(textuais)) {
      for (const campo of campos) {
        expect(campoDmmf(model, campo), `${model}.${campo}`).toMatchObject({ kind: 'scalar', type: 'String' });
      }
    }
  });

  it('status da Ocorrencia é restrito a aberto, em acompanhamento e encerrado (RF10, RN04)', () => {
    expect(campoDmmf('Ocorrencia', 'status')).toMatchObject({ kind: 'enum', type: 'StatusOcorrencia' });
    expect(Object.values(StatusOcorrencia).sort()).toEqual(
      ['ABERTO', 'EM_ACOMPANHAMENTO', 'ENCERRADO'].sort(),
    );
  });

  it('destinatario_perfil é restrito a tutor, equipe pedagógica e gestão (RN03, RF08)', () => {
    expect(campoDmmf('Encaminhamento', 'destinatario_perfil')).toMatchObject({
      kind: 'enum',
      type: 'DestinatarioPerfil',
    });
    expect(Object.values(DestinatarioPerfil).sort()).toEqual(
      ['EQUIPE_PEDAGOGICA', 'GESTAO', 'TUTOR'].sort(),
    );
  });

  it('destinatario_perfil não aceita Professor nem Técnico-administrativo (enum próprio, não Perfil)', () => {
    expect(Object.values(DestinatarioPerfil)).not.toContain(Perfil.PROFESSOR);
    expect(Object.values(DestinatarioPerfil)).not.toContain(Perfil.TECNICO_ADMINISTRATIVO);
  });
});

describe('Schema de ocorrências — relações (DMMF)', () => {
  it('cada FK tem a relação correspondente apontando para o model certo', () => {
    const alvo = {
      turma: 'Turma',
      categoria: 'Categoria',
      profissional_responsavel: 'Usuario',
      responsavel_acompanhamento: 'Usuario',
      ocorrencia: 'Ocorrencia',
      estudante: 'Estudante',
      destinatario_usuario: 'Usuario',
      registrado_por: 'Usuario',
      usuario: 'Usuario',
    };
    for (const [model, fks] of Object.entries(FKS)) {
      for (const relacao of Object.values(fks)) {
        expect(campoDmmf(model, relacao), `${model}.${relacao}`).toMatchObject({
          kind: 'object',
          type: alvo[relacao],
        });
      }
    }
  });

  it('Ocorrencia envolve vários Estudantes via OcorrenciaEstudante (N:N, RF06)', () => {
    const ladoOcorrencia = campoDmmf('Ocorrencia', 'estudantes');
    const ladoEstudante = campoDmmf('Estudante', 'ocorrencias');
    expect(ladoOcorrencia).toMatchObject({ kind: 'object', type: 'OcorrenciaEstudante' });
    expect(ladoEstudante).toMatchObject({ kind: 'object', type: 'OcorrenciaEstudante' });
    expect(campoDmmf('OcorrenciaEstudante', 'ocorrencia').relationName).toBe(ladoOcorrencia.relationName);
    expect(campoDmmf('OcorrenciaEstudante', 'estudante').relationName).toBe(ladoEstudante.relationName);
  });

  it('Ocorrencia possui vários Encaminhamentos, Providências, Comunicações e Histórico', () => {
    const filhos = {
      encaminhamentos: 'Encaminhamento',
      providencias: 'Providencia',
      comunicacoes: 'Comunicacao',
      historico: 'HistoricoOcorrencia',
    };
    for (const [campo, model] of Object.entries(filhos)) {
      const lista = campoDmmf('Ocorrencia', campo);
      expect(lista, campo).toMatchObject({ kind: 'object', type: model });
      expect(campoDmmf(model, 'ocorrencia').relationName).toBe(lista.relationName);
    }
  });

  it('Ocorrencia pertence a uma Turma e a uma Categoria', () => {
    expect(campoDmmf('Turma', 'ocorrencias').relationName).toBe(campoDmmf('Ocorrencia', 'turma').relationName);
    expect(campoDmmf('Categoria', 'ocorrencias').relationName).toBe(
      campoDmmf('Ocorrencia', 'categoria').relationName,
    );
  });

  it('relações múltiplas entre os mesmos models são nomeadas e distintas', () => {
    const profissional = campoDmmf('Ocorrencia', 'profissional_responsavel').relationName;
    const acompanhamento = campoDmmf('Ocorrencia', 'responsavel_acompanhamento').relationName;
    expect(profissional).toBe('ProfissionalResponsavelOcorrencia');
    expect(acompanhamento).toBe('ResponsavelAcompanhamentoOcorrencia');

    const destinatario = campoDmmf('Encaminhamento', 'destinatario_usuario').relationName;
    const registrador = campoDmmf('Encaminhamento', 'registrado_por').relationName;
    expect(destinatario).toBe('DestinatarioEncaminhamento');
    expect(registrador).toBe('RegistradorEncaminhamento');
  });

  it('cada relação com Usuario tem lado inverso em Usuario com o mesmo nome de relação', () => {
    const nomesNoUsuario = modelDmmf('Usuario')
      .fields.filter((f) => f.kind === 'object')
      .map((f) => f.relationName);
    const nomes = RELACOES_USUARIO.map(([model, campo]) => campoDmmf(model, campo).relationName);

    expect(new Set(nomes).size).toBe(nomes.length);
    expect(nomesNoUsuario).toEqual(expect.arrayContaining(nomes));
  });
});

describe('Schema de ocorrências — modificadores (não expostos pelo DMMF de runtime)', () => {
  it('ids são chave primária com autoincremento', () => {
    for (const model of MODELS_COM_ID) {
      const { atributos } = linhaDoCampo(model, 'id');
      expect(atributos, model).toContain('@id');
      expect(atributos, model).toContain('@default(autoincrement())');
    }
  });

  it('OcorrenciaEstudante não tem id próprio: chave primária composta (ocorrencia_id, estudante_id)', () => {
    expect(Prisma.OcorrenciaEstudanteScalarFieldEnum).not.toHaveProperty('id');
    expect(atributosDeBloco('OcorrenciaEstudante')).toContain('@@id([ocorrencia_id, estudante_id])');
  });

  it('obrigatoriedade conforme a Seção 11', () => {
    const obrigatorios = {
      Ocorrencia: [
        'data_hora',
        'local',
        'turma_id',
        'turma',
        'categoria_id',
        'categoria',
        'descricao',
        'profissional_responsavel_id',
        'profissional_responsavel',
        'status',
      ],
      OcorrenciaEstudante: ['ocorrencia_id', 'ocorrencia', 'estudante_id', 'estudante'],
      Encaminhamento: [
        'ocorrencia_id',
        'ocorrencia',
        'destinatario_perfil',
        'registrado_por_id',
        'registrado_por',
        'data_hora',
      ],
      Providencia: ['ocorrencia_id', 'ocorrencia', 'descricao', 'registrado_por_id', 'registrado_por', 'data_hora'],
      Comunicacao: [
        'ocorrencia_id',
        'ocorrencia',
        'destinatario',
        'meio',
        'descricao',
        'registrado_por_id',
        'registrado_por',
        'data_hora',
      ],
      HistoricoOcorrencia: ['ocorrencia_id', 'ocorrencia', 'usuario_id', 'usuario', 'acao', 'data_hora'],
      LogAuditoria: ['acao', 'recurso', 'data_hora'],
    };
    for (const [model, campos] of Object.entries(obrigatorios)) {
      for (const campo of campos) {
        expect(linhaDoCampo(model, campo).opcional, `${model}.${campo}`).toBe(false);
      }
    }

    const opcionais = {
      Ocorrencia: [
        'demais_envolvidos',
        'testemunhas',
        'providencias_imediatas',
        'observacoes',
        'responsavel_acompanhamento_id',
        'responsavel_acompanhamento',
        'data_encerramento',
      ],
      Encaminhamento: ['destinatario_usuario_id', 'destinatario_usuario', 'observacao'],
      HistoricoOcorrencia: ['descricao'],
      LogAuditoria: ['usuario_id', 'usuario'],
    };
    for (const [model, campos] of Object.entries(opcionais)) {
      for (const campo of campos) {
        expect(linhaDoCampo(model, campo).opcional, `${model}.${campo}`).toBe(true);
      }
    }
  });

  it('Ocorrencia nasce com status ABERTO (UC01, passo 8)', () => {
    expect(linhaDoCampo('Ocorrencia', 'status').atributos).toContain('@default(ABERTO)');
  });

  it('data_hora do fato (Ocorrencia) não tem valor padrão: é informada por quem registra (UC01)', () => {
    expect(linhaDoCampo('Ocorrencia', 'data_hora').atributos).not.toContain('@default');
  });

  it('Histórico e LogAuditoria registram data/hora automaticamente (RN08, RNF04)', () => {
    expect(linhaDoCampo('HistoricoOcorrencia', 'data_hora').atributos).toContain('@default(now())');
    expect(linhaDoCampo('LogAuditoria', 'data_hora').atributos).toContain('@default(now())');
  });

  it('nenhuma relação com Usuario usa cascata: todas são Restrict (RN07)', () => {
    for (const [model, campo] of RELACOES_USUARIO) {
      expect(onDeleteDaRelacao(model, campo), `${model}.${campo}`).toBe('Restrict');
    }
  });

  it('demais relações também são Restrict, preservando o histórico da ocorrência (RN08)', () => {
    for (const [model, fks] of Object.entries(FKS)) {
      for (const relacao of Object.values(fks)) {
        expect(onDeleteDaRelacao(model, relacao), `${model}.${relacao}`).toBe('Restrict');
      }
    }
  });

  it('FKs usadas em consultas têm índice', () => {
    const indices = {
      Ocorrencia: [
        '@@index([turma_id])',
        '@@index([categoria_id])',
        '@@index([profissional_responsavel_id])',
        '@@index([responsavel_acompanhamento_id])',
      ],
      OcorrenciaEstudante: ['@@index([estudante_id])'],
      Encaminhamento: [
        '@@index([ocorrencia_id])',
        '@@index([destinatario_usuario_id])',
        '@@index([registrado_por_id])',
      ],
      Providencia: ['@@index([ocorrencia_id])', '@@index([registrado_por_id])'],
      Comunicacao: ['@@index([ocorrencia_id])', '@@index([registrado_por_id])'],
      HistoricoOcorrencia: ['@@index([ocorrencia_id])', '@@index([usuario_id])'],
      LogAuditoria: ['@@index([usuario_id])'],
    };
    for (const [model, esperados] of Object.entries(indices)) {
      expect(atributosDeBloco(model), model).toEqual(expect.arrayContaining(esperados));
    }
  });
});
