-- CreateEnum
CREATE TYPE "perfil" AS ENUM ('PROFESSOR', 'TUTOR', 'GESTAO', 'PEDAGOGICO', 'TECNICO_ADMINISTRATIVO');

-- CreateEnum
CREATE TYPE "status_usuario" AS ENUM ('ATIVO', 'BLOQUEADO', 'DESATIVADO');

-- CreateTable
CREATE TABLE "usuarios" (
    "id" SERIAL NOT NULL,
    "nome" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "senha_hash" TEXT NOT NULL,
    "perfil" "perfil" NOT NULL,
    "status" "status_usuario" NOT NULL DEFAULT 'ATIVO',

    CONSTRAINT "usuarios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "turmas" (
    "id" SERIAL NOT NULL,
    "nome" TEXT NOT NULL,
    "etapa" TEXT NOT NULL,

    CONSTRAINT "turmas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "estudantes" (
    "id" SERIAL NOT NULL,
    "nome_completo" TEXT NOT NULL,
    "codigo_escolar" TEXT,
    "turma_id" INTEGER NOT NULL,
    "tutor_id" INTEGER,

    CONSTRAINT "estudantes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "categorias" (
    "id" SERIAL NOT NULL,
    "nome" TEXT NOT NULL,
    "descricao" TEXT,

    CONSTRAINT "categorias_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "usuarios_email_key" ON "usuarios"("email");

-- CreateIndex
CREATE INDEX "estudantes_turma_id_idx" ON "estudantes"("turma_id");

-- CreateIndex
CREATE INDEX "estudantes_tutor_id_idx" ON "estudantes"("tutor_id");

-- AddForeignKey
ALTER TABLE "estudantes" ADD CONSTRAINT "estudantes_turma_id_fkey" FOREIGN KEY ("turma_id") REFERENCES "turmas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "estudantes" ADD CONSTRAINT "estudantes_tutor_id_fkey" FOREIGN KEY ("tutor_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
