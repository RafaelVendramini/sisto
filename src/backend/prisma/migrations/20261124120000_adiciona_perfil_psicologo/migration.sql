-- Issue #153 (SSD 1.18, Story #152): perfil e destinatário Psicólogo escolar.
--
-- Acrescenta o valor PSICOLOGO aos enums "perfil" (usuário — RF01) e
-- "destinatario_perfil" (encaminhamento — RN03, RN15). Não altera nenhum
-- dado existente: nenhum usuário nem encaminhamento passa a PSICOLOGO, e a
-- observação dos encaminhamentos atuais continua como está (nenhum tem
-- destinatário PSICOLOGO).
--
-- O ADD VALUE sempre acrescenta o valor no FIM do tipo (a ordem do enum no
-- schema.prisma acompanha a do banco). No PostgreSQL 12 ou mais novo ele pode
-- rodar dentro da transação da migration, desde que o valor novo não seja
-- USADO na mesma transação — esta migration não usa.
--
-- Índices por expressão da migration 20261123120000_unicidade_rn18_turma_categoria
-- (categorias_nome_normalizado_key e turmas_nome_etapa_ano_letivo_normalizado_key):
-- esta migration NÃO os toca. O SQL abaixo foi conferido com
-- `prisma migrate diff` (schema anterior -> schema novo): só os dois ALTER TYPE,
-- sem nenhum "DROP INDEX" (ver a nota no model Turma do schema.prisma).

-- AlterEnum
ALTER TYPE "perfil" ADD VALUE 'PSICOLOGO';

-- AlterEnum
ALTER TYPE "destinatario_perfil" ADD VALUE 'PSICOLOGO';
