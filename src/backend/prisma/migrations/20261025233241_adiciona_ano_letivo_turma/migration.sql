/*
  Warnings:

  - Added the required column `ano_letivo` to the `turmas` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "turmas" ADD COLUMN     "ano_letivo" INTEGER NOT NULL;
