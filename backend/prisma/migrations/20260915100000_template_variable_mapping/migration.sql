-- What each {{n}} placeholder in an assigned template is filled with, chosen
-- per template by the Super Admin. Empty array = the default who/what/when
-- order, so existing assignments keep working unchanged.
-- AlterTable
ALTER TABLE "User" ADD COLUMN     "fyxoTemplateVariables" TEXT[];
