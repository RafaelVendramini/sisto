-- Issue #129 (RN18): unicidade de categoria e de turma garantida também no banco.
--
-- Até aqui a RN18 era checada só nos services (services/categorias.js e
-- services/turmas.js), dentro de uma transação SERIALIZABLE. Os índices abaixo
-- são a segunda barreira: recusam também gravações feitas por fora da API
-- (script, console SQL, seed) e qualquer caminho futuro que esqueça a checagem.
-- A violação (SQLSTATE 23505, P2002 no Prisma) é respondida pela API com o
-- mesmo 409 CATEGORIA_DUPLICADA / TURMA_DUPLICADA da checagem do service.
--
-- Índices por EXPRESSÃO (comparação sem diferenciar maiúsculas/minúsculas e
-- ignorando espaços nas pontas). O Prisma não representa esse tipo de índice
-- no schema.prisma; ver o comentário nos models Categoria e Turma.
--
-- Diferenças em relação à chave do service (NFC + trim + toLowerCase do JS):
-- - btrim() sem segundo argumento remove só o espaço comum (U+0020); o trim()
--   do JS remove também tabulação, quebra de linha, espaço não separável etc.;
-- - lower() segue a collation/ctype do banco (em "C", só A–Z mudam de caixa);
-- - não há normalização NFC no índice.
-- Pela API isso não faz diferença: o service grava o texto já em NFC e sem
-- espaços nas pontas, e a checagem dele é a mais abrangente. O índice pega o
-- caso principal (maiúsculas/minúsculas e espaços) também fora da API.
--
-- ANTES DE APLICAR EM UM BANCO COM DADOS: se já houver duplicatas pela
-- expressão do índice, o CREATE UNIQUE INDEX falha e a migration fica marcada
-- como falha (nada é criado). Rodar antes o SQL de conferência (só leitura)
-- entregue na Issue #129 e corrigir as duplicatas pela tela da Gestão.

-- RN18: nome da categoria único (sem caixa e sem espaços nas pontas).
CREATE UNIQUE INDEX "categorias_nome_normalizado_key"
  ON "categorias" (lower(btrim("nome")));

-- RN18: trio (nome, etapa, ano letivo) da turma único (textos sem caixa e
-- sem espaços nas pontas). A mesma turma em outro ano letivo é aceita.
CREATE UNIQUE INDEX "turmas_nome_etapa_ano_letivo_normalizado_key"
  ON "turmas" (lower(btrim("nome")), lower(btrim("etapa")), "ano_letivo");
