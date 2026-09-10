-- AlterTable
ALTER TABLE "User" ADD COLUMN     "fyxoTemplateBody" TEXT,
ADD COLUMN     "fyxoTemplateLanguage" TEXT,
ADD COLUMN     "fyxoTemplateName" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "User_fyxoTemplateName_key" ON "User"("fyxoTemplateName");
