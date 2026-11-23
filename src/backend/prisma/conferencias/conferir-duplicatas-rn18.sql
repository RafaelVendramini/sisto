-- Sisto — Issue #129 — Conferência de duplicatas da RN18 ANTES de aplicar a
-- migration 20261123120000_unicidade_rn18_turma_categoria em produção.
--
-- SOMENTE LEITURA: só há SELECTs, dentro de uma transação READ ONLY que
-- termina em ROLLBACK. Nada é gravado nem bloqueado para escrita.
-- Pode ser colado no SQL Editor do Neon ou rodado com psql:
--   psql "<DATABASE_URL de produção>" -f src/backend/prisma/conferencias/conferir-duplicatas-rn18.sql
--
-- Como ler o resultado:
-- - Consultas 1 e 2 (mesma expressão dos índices): se devolverem QUALQUER
--   linha, a migration FALHA nesse banco. Corrija antes pela tela da Gestão
--   (renomeie uma das categorias/turmas) e rode esta conferência de novo.
-- - Consultas 3 e 4 (critério mais amplo, próximo ao do service: qualquer
--   espaço em branco nas pontas, inclusive tabulação e espaço não separável,
--   e normalização NFC): só informativas. Linhas aqui que NÃO aparecem em 1
--   e 2 não impedem a migration, mas são duplicatas pela RN18 que a API já
--   recusaria numa nova gravação.
-- - Consulta 0 (primeira, para aparecer mesmo se a 3 ou a 4 falharem em banco
--   que não seja UTF8): collation do banco (o lower() do índice segue a collation;
--   em "C" só as letras A–Z mudam de caixa).
-- As consultas mostram só ids, textos de categoria/turma e contagens; não há
-- dados de estudantes nem de usuários (RNF06).

BEGIN TRANSACTION READ ONLY;

-- 0. Collation do banco e totais (contexto).
SELECT
  current_database()                    AS banco,
  datcollate                            AS collation,
  datctype                              AS ctype,
  (SELECT count(*) FROM categorias)     AS total_categorias,
  (SELECT count(*) FROM turmas)         AS total_turmas,
  (SELECT count(*) FROM pg_indexes
    WHERE indexname IN ('categorias_nome_normalizado_key',
                        'turmas_nome_etapa_ano_letivo_normalizado_key')) AS indices_ja_existentes
FROM pg_database
WHERE datname = current_database();

-- 1. Categorias duplicadas pela expressão do índice: lower(btrim(nome)).
SELECT
  lower(btrim(nome))                    AS chave_indice,
  count(*)                              AS quantidade,
  array_agg(id ORDER BY id)             AS ids,
  array_agg(nome ORDER BY id)           AS nomes_gravados
FROM categorias
GROUP BY lower(btrim(nome))
HAVING count(*) > 1
ORDER BY chave_indice;

-- 2. Turmas duplicadas pela expressão do índice:
--    (lower(btrim(nome)), lower(btrim(etapa)), ano_letivo).
SELECT
  lower(btrim(nome))                    AS nome_indice,
  lower(btrim(etapa))                   AS etapa_indice,
  ano_letivo,
  count(*)                              AS quantidade,
  array_agg(id ORDER BY id)             AS ids,
  array_agg(nome || ' — ' || etapa ORDER BY id) AS turmas_gravadas
FROM turmas
GROUP BY lower(btrim(nome)), lower(btrim(etapa)), ano_letivo
HAVING count(*) > 1
ORDER BY ano_letivo, nome_indice, etapa_indice;

-- 3. (Informativa) Categorias duplicadas pelo critério amplo:
--    NFC + remoção de qualquer espaço em branco nas pontas + minúsculas.
SELECT
  lower(regexp_replace(normalize(nome, NFC), '^[[:space:] ]+|[[:space:] ]+$', '', 'g')) AS chave_ampla,
  count(*)                              AS quantidade,
  array_agg(id ORDER BY id)             AS ids,
  array_agg(nome ORDER BY id)           AS nomes_gravados
FROM categorias
GROUP BY 1
HAVING count(*) > 1
ORDER BY 1;

-- 4. (Informativa) Turmas duplicadas pelo critério amplo.
SELECT
  lower(regexp_replace(normalize(nome, NFC), '^[[:space:] ]+|[[:space:] ]+$', '', 'g'))  AS nome_amplo,
  lower(regexp_replace(normalize(etapa, NFC), '^[[:space:] ]+|[[:space:] ]+$', '', 'g')) AS etapa_ampla,
  ano_letivo,
  count(*)                              AS quantidade,
  array_agg(id ORDER BY id)             AS ids,
  array_agg(nome || ' — ' || etapa ORDER BY id) AS turmas_gravadas
FROM turmas
GROUP BY 1, 2, 3
HAVING count(*) > 1
ORDER BY 3, 1, 2;

ROLLBACK;
