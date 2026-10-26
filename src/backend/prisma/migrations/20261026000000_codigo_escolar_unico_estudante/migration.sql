-- Issue #42 (RN18): código escolar do estudante único quando informado.
--
-- 1. Normaliza dados existentes antes de criar o índice: código só com
--    espaços (ou vazio) equivale a "não informado" e passa a NULL (RN18).
--    Nenhuma linha é apagada; os demais códigos são mantidos como estão.
--    Se já houver códigos repetidos (não vazios), a criação do índice falha
--    e a migration é revertida sem alterar nada: os duplicados precisam ser
--    corrigidos manualmente pela Gestão antes de aplicar.
UPDATE "estudantes"
SET "codigo_escolar" = NULL
WHERE "codigo_escolar" IS NOT NULL AND btrim("codigo_escolar") = '';

-- 2. Índice único. No PostgreSQL, NULLs não conflitam entre si: vários
--    estudantes podem ficar sem código.
-- CreateIndex
CREATE UNIQUE INDEX "estudantes_codigo_escolar_key" ON "estudantes"("codigo_escolar");
