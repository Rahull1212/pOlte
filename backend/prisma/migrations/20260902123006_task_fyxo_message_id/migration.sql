-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "fyxoMessageId" TEXT;

-- CreateIndex
CREATE INDEX "Task_fyxoMessageId_idx" ON "Task"("fyxoMessageId");
