// Testes do modelo de dados de cadastro (Subtask #7 — SSD Seção 11).
// Nenhum teste aqui abre conexão com o banco.
//
// Fonte das verificações:
// - DMMF do client gerado (`Prisma.dmmf`) + enums/ScalarFieldEnum exportados:
//   models, campos, kind (scalar/enum/object), tipo, relações e nome da tabela.
// - O DMMF de runtime do Prisma 7 é reduzido: NÃO expõe isRequired, isId,
//   isUnique, default nem onDelete (cada campo traz só name/kind/type/
//   relationName). Para esses modificadores lemos o schema.prisma, mas apenas
//   o bloco do model em questão e apenas a linha do campo verificado.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Prisma, Perfil, StatusUsuario } from '@prisma/client';

const MODELS_CADASTRO = ['Usuario', 'Turma', 'Estudante', 'Categoria'];

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
// Modificadores não expostos pelo DMMF de runtime (?, @id, @unique, @default,
// onDelete). Leitura restrita à linha do campo dentro do bloco do model.
// ---------------------------------------------------------------------------
const schemaTexto = readFileSync(
  fileURLToPath(new URL('../prisma/schema.prisma', import.meta.url)),
  'utf8',
);

function linhaDoCampo(model, campo) {
  const bloco = schemaTexto.match(new RegExp(`^model ${model} \\{\\r?\\n([\\s\\S]*?)^\\}`, 'm'));
  if (!bloco) throw new Error(`model ${model} não encontrado no schema.prisma`);

  for (const linhaBruta of bloco[1].split(/\r?\n/)) {
    const linha = linhaBruta.replace(/\/\/.*$/, '').trim(); // descarta comentários
    const partes = linha.match(/^(\w+)\s+(\w+)(\[\])?(\?)?\s*(.*)$/);
    if (partes && partes[1] === campo) {
      return { opcional: partes[4] === '?', atributos: partes[5] };
    }
  }
  throw new Error(`campo ${model}.${campo} não encontrado no schema.prisma`);
}

function onDeleteDaRelacao(model, campo) {
  const { atributos } = linhaDoCampo(model, campo);
  return atributos.match(/@relation\([^)]*onDelete:\s*(\w+)/)?.[1] ?? null;
}

// ---------------------------------------------------------------------------

describe('Schema de cadastros — models, campos e relações (DMMF)', () => {
  it('contém os models de cadastro', () => {
    expect(Object.keys(Prisma.ModelName)).toEqual(expect.arrayContaining(MODELS_CADASTRO));
  });

  it('enum Perfil contém os 5 perfis do RF01', () => {
    expect(Object.values(Perfil).sort()).toEqual(
      ['GESTAO', 'PEDAGOGICO', 'PROFESSOR', 'TECNICO_ADMINISTRATIVO', 'TUTOR'].sort(),
    );
  });

  it('enum StatusUsuario contém ativo, bloqueado e desativado (RN07)', () => {
    expect(Object.values(StatusUsuario).sort()).toEqual(['ATIVO', 'BLOQUEADO', 'DESATIVADO']);
  });

  it('Usuario tem somente os campos da Seção 11 (sem campo de senha em texto puro)', () => {
    expect(Object.keys(Prisma.UsuarioScalarFieldEnum).sort()).toEqual(
      [
        'email',
        'id',
        'nome',
        'perfil',
        'senha_alterada_em',
        'senha_hash',
        'status',
        'troca_senha_obrigatoria',
      ].sort(),
    );
    expect(Prisma.UsuarioScalarFieldEnum).not.toHaveProperty('senha');
  });

  it('Usuario: campos de troca de senha (RN10, RN12 — Issue #18)', () => {
    expect(campoDmmf('Usuario', 'troca_senha_obrigatoria')).toMatchObject({
      kind: 'scalar',
      type: 'Boolean',
    });
    expect(campoDmmf('Usuario', 'senha_alterada_em')).toMatchObject({
      kind: 'scalar',
      type: 'DateTime',
    });
  });

  it('Turma, Estudante e Categoria têm somente os campos da Seção 11', () => {
    expect(Object.keys(Prisma.TurmaScalarFieldEnum).sort()).toEqual(['etapa', 'id', 'nome']);
    expect(Object.keys(Prisma.EstudanteScalarFieldEnum).sort()).toEqual(
      ['codigo_escolar', 'id', 'nome_completo', 'turma_id', 'tutor_id'].sort(),
    );
    expect(Object.keys(Prisma.CategoriaScalarFieldEnum).sort()).toEqual(
      ['descricao', 'id', 'nome'].sort(),
    );
  });

  it('mapeia as tabelas para nomes no plural minúsculo', () => {
    expect(modelDmmf('Usuario').dbName).toBe('usuarios');
    expect(modelDmmf('Turma').dbName).toBe('turmas');
    expect(modelDmmf('Estudante').dbName).toBe('estudantes');
    expect(modelDmmf('Categoria').dbName).toBe('categorias');
  });

  it('ids e chaves estrangeiras são Int', () => {
    for (const model of MODELS_CADASTRO) {
      expect(campoDmmf(model, 'id')).toMatchObject({ kind: 'scalar', type: 'Int' });
    }
    expect(campoDmmf('Estudante', 'turma_id')).toMatchObject({ kind: 'scalar', type: 'Int' });
    expect(campoDmmf('Estudante', 'tutor_id')).toMatchObject({ kind: 'scalar', type: 'Int' });
  });

  it('campos textuais são String', () => {
    const textuais = {
      Usuario: ['nome', 'email', 'senha_hash'],
      Turma: ['nome', 'etapa'],
      Estudante: ['nome_completo', 'codigo_escolar'],
      Categoria: ['nome', 'descricao'],
    };
    for (const [model, campos] of Object.entries(textuais)) {
      for (const campo of campos) {
        expect(campoDmmf(model, campo)).toMatchObject({ kind: 'scalar', type: 'String' });
      }
    }
  });

  it('perfil e status do Usuario são enums restritos (RF01, RN07)', () => {
    expect(campoDmmf('Usuario', 'perfil')).toMatchObject({ kind: 'enum', type: 'Perfil' });
    expect(campoDmmf('Usuario', 'status')).toMatchObject({ kind: 'enum', type: 'StatusUsuario' });
  });

  it('Estudante relaciona-se com Turma e com Usuario (tutor), na mesma relação vista por Usuario', () => {
    expect(campoDmmf('Estudante', 'turma')).toMatchObject({ kind: 'object', type: 'Turma' });
    const tutor = campoDmmf('Estudante', 'tutor');
    expect(tutor).toMatchObject({ kind: 'object', type: 'Usuario' });

    const tutorados = campoDmmf('Usuario', 'tutorados');
    expect(tutorados).toMatchObject({ kind: 'object', type: 'Estudante' });
    expect(tutorados.relationName).toBe(tutor.relationName);
  });
});

describe('Schema de cadastros — modificadores (não expostos pelo DMMF de runtime)', () => {
  it('ids são chave primária com autoincremento', () => {
    for (const model of MODELS_CADASTRO) {
      const { atributos } = linhaDoCampo(model, 'id');
      expect(atributos).toContain('@id');
      expect(atributos).toContain('@default(autoincrement())');
    }
  });

  it('Usuario: email único e status com padrão ATIVO', () => {
    expect(linhaDoCampo('Usuario', 'email').atributos).toContain('@unique');
    expect(linhaDoCampo('Usuario', 'status').atributos).toContain('@default(ATIVO)');
  });

  it('Usuario: troca_senha_obrigatoria obrigatório com padrão false; senha_alterada_em opcional', () => {
    const troca = linhaDoCampo('Usuario', 'troca_senha_obrigatoria');
    expect(troca.opcional).toBe(false);
    expect(troca.atributos).toContain('@default(false)');
    expect(linhaDoCampo('Usuario', 'senha_alterada_em').opcional).toBe(true);
  });

  it('obrigatoriedade conforme a Seção 11', () => {
    const obrigatorios = {
      Usuario: ['nome', 'email', 'senha_hash', 'perfil', 'status'],
      Turma: ['nome', 'etapa'],
      Estudante: ['nome_completo', 'turma_id', 'turma'],
      Categoria: ['nome'],
    };
    for (const [model, campos] of Object.entries(obrigatorios)) {
      for (const campo of campos) {
        expect(linhaDoCampo(model, campo).opcional, `${model}.${campo}`).toBe(false);
      }
    }

    const opcionais = {
      Estudante: ['codigo_escolar', 'tutor_id', 'tutor'],
      Categoria: ['descricao'],
    };
    for (const [model, campos] of Object.entries(opcionais)) {
      for (const campo of campos) {
        expect(linhaDoCampo(model, campo).opcional, `${model}.${campo}`).toBe(true);
      }
    }
  });

  it('Estudante → tutor (Usuario) e → turma usam Restrict, sem cascata (RN07)', () => {
    expect(onDeleteDaRelacao('Estudante', 'tutor')).toBe('Restrict');
    expect(onDeleteDaRelacao('Estudante', 'turma')).toBe('Restrict');
  });
});
