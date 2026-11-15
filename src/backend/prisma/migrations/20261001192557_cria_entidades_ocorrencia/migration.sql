-- CreateEnum
CREATE TYPE "status_ocorrencia" AS ENUM ('ABERTO', 'EM_ACOMPANHAMENTO', 'ENCERRADO');

-- CreateEnum
CREATE TYPE "destinatario_perfil" AS ENUM ('TUTOR', 'EQUIPE_PEDAGOGICA', 'GESTAO');

-- CreateTable
CREATE TABLE "ocorrencias" (
    "id" SERIAL NOT NULL,
    "data_hora" TIMESTAMP(3) NOT NULL,
    "local" TEXT NOT NULL,
    "turma_id" INTEGER NOT NULL,
    "categoria_id" INTEGER NOT NULL,
    "descricao" TEXT NOT NULL,
    "demais_envolvidos" TEXT,
    "testemunhas" TEXT,
    "providencias_imediatas" TEXT,
    "observacoes" TEXT,
    "profissional_responsavel_id" INTEGER NOT NULL,
    "responsavel_acompanhamento_id" INTEGER,
    "status" "status_ocorrencia" NOT NULL DEFAULT 'ABERTO',
    "data_encerramento" TIMESTAMP(3),

    CONSTRAINT "ocorrencias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ocorrencias_estudantes" (
    "ocorrencia_id" INTEGER NOT NULL,
    "estudante_id" INTEGER NOT NULL,

    CONSTRAINT "ocorrencias_estudantes_pkey" PRIMARY KEY ("ocorrencia_id","estudante_id")
);

-- CreateTable
CREATE TABLE "encaminhamentos" (
    "id" SERIAL NOT NULL,
    "ocorrencia_id" INTEGER NOT NULL,
    "destinatario_perfil" "destinatario_perfil" NOT NULL,
    "destinatario_usuario_id" INTEGER,
    "registrado_por_id" INTEGER NOT NULL,
    "data_hora" TIMESTAMP(3) NOT NULL,
    "observacao" TEXT,

    CONSTRAINT "encaminhamentos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "providencias" (
    "id" SERIAL NOT NULL,
    "ocorrencia_id" INTEGER NOT NULL,
    "descricao" TEXT NOT NULL,
    "registrado_por_id" INTEGER NOT NULL,
    "data_hora" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "providencias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comunicacoes" (
    "id" SERIAL NOT NULL,
    "ocorrencia_id" INTEGER NOT NULL,
    "destinatario" TEXT NOT NULL,
    "meio" TEXT NOT NULL,
    "descricao" TEXT NOT NULL,
    "registrado_por_id" INTEGER NOT NULL,
    "data_hora" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "comunicacoes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "historicos_ocorrencia" (
    "id" SERIAL NOT NULL,
    "ocorrencia_id" INTEGER NOT NULL,
    "usuario_id" INTEGER NOT NULL,
    "acao" TEXT NOT NULL,
    "descricao" TEXT,
    "data_hora" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "historicos_ocorrencia_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "logs_auditoria" (
    "id" SERIAL NOT NULL,
    "usuario_id" INTEGER,
    "acao" TEXT NOT NULL,
    "recurso" TEXT NOT NULL,
    "data_hora" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "logs_auditoria_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ocorrencias_turma_id_idx" ON "ocorrencias"("turma_id");

-- CreateIndex
CREATE INDEX "ocorrencias_categoria_id_idx" ON "ocorrencias"("categoria_id");

-- CreateIndex
CREATE INDEX "ocorrencias_profissional_responsavel_id_idx" ON "ocorrencias"("profissional_responsavel_id");

-- CreateIndex
CREATE INDEX "ocorrencias_responsavel_acompanhamento_id_idx" ON "ocorrencias"("responsavel_acompanhamento_id");

-- CreateIndex
CREATE INDEX "ocorrencias_estudantes_estudante_id_idx" ON "ocorrencias_estudantes"("estudante_id");

-- CreateIndex
CREATE INDEX "encaminhamentos_ocorrencia_id_idx" ON "encaminhamentos"("ocorrencia_id");

-- CreateIndex
CREATE INDEX "encaminhamentos_destinatario_usuario_id_idx" ON "encaminhamentos"("destinatario_usuario_id");

-- CreateIndex
CREATE INDEX "encaminhamentos_registrado_por_id_idx" ON "encaminhamentos"("registrado_por_id");

-- CreateIndex
CREATE INDEX "providencias_ocorrencia_id_idx" ON "providencias"("ocorrencia_id");

-- CreateIndex
CREATE INDEX "providencias_registrado_por_id_idx" ON "providencias"("registrado_por_id");

-- CreateIndex
CREATE INDEX "comunicacoes_ocorrencia_id_idx" ON "comunicacoes"("ocorrencia_id");

-- CreateIndex
CREATE INDEX "comunicacoes_registrado_por_id_idx" ON "comunicacoes"("registrado_por_id");

-- CreateIndex
CREATE INDEX "historicos_ocorrencia_ocorrencia_id_idx" ON "historicos_ocorrencia"("ocorrencia_id");

-- CreateIndex
CREATE INDEX "historicos_ocorrencia_usuario_id_idx" ON "historicos_ocorrencia"("usuario_id");

-- CreateIndex
CREATE INDEX "logs_auditoria_usuario_id_idx" ON "logs_auditoria"("usuario_id");

-- AddForeignKey
ALTER TABLE "ocorrencias" ADD CONSTRAINT "ocorrencias_turma_id_fkey" FOREIGN KEY ("turma_id") REFERENCES "turmas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ocorrencias" ADD CONSTRAINT "ocorrencias_categoria_id_fkey" FOREIGN KEY ("categoria_id") REFERENCES "categorias"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ocorrencias" ADD CONSTRAINT "ocorrencias_profissional_responsavel_id_fkey" FOREIGN KEY ("profissional_responsavel_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ocorrencias" ADD CONSTRAINT "ocorrencias_responsavel_acompanhamento_id_fkey" FOREIGN KEY ("responsavel_acompanhamento_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ocorrencias_estudantes" ADD CONSTRAINT "ocorrencias_estudantes_ocorrencia_id_fkey" FOREIGN KEY ("ocorrencia_id") REFERENCES "ocorrencias"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ocorrencias_estudantes" ADD CONSTRAINT "ocorrencias_estudantes_estudante_id_fkey" FOREIGN KEY ("estudante_id") REFERENCES "estudantes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "encaminhamentos" ADD CONSTRAINT "encaminhamentos_ocorrencia_id_fkey" FOREIGN KEY ("ocorrencia_id") REFERENCES "ocorrencias"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "encaminhamentos" ADD CONSTRAINT "encaminhamentos_destinatario_usuario_id_fkey" FOREIGN KEY ("destinatario_usuario_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "encaminhamentos" ADD CONSTRAINT "encaminhamentos_registrado_por_id_fkey" FOREIGN KEY ("registrado_por_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "providencias" ADD CONSTRAINT "providencias_ocorrencia_id_fkey" FOREIGN KEY ("ocorrencia_id") REFERENCES "ocorrencias"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "providencias" ADD CONSTRAINT "providencias_registrado_por_id_fkey" FOREIGN KEY ("registrado_por_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comunicacoes" ADD CONSTRAINT "comunicacoes_ocorrencia_id_fkey" FOREIGN KEY ("ocorrencia_id") REFERENCES "ocorrencias"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comunicacoes" ADD CONSTRAINT "comunicacoes_registrado_por_id_fkey" FOREIGN KEY ("registrado_por_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "historicos_ocorrencia" ADD CONSTRAINT "historicos_ocorrencia_ocorrencia_id_fkey" FOREIGN KEY ("ocorrencia_id") REFERENCES "ocorrencias"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "historicos_ocorrencia" ADD CONSTRAINT "historicos_ocorrencia_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "logs_auditoria" ADD CONSTRAINT "logs_auditoria_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
