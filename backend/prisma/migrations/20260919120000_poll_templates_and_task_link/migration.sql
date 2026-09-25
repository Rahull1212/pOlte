-- AlterTable
ALTER TABLE "Poll" ADD COLUMN     "taskId" TEXT,
ADD COLUMN     "templateLanguage" TEXT,
ADD COLUMN     "templateName" TEXT;
-- AlterTable
ALTER TABLE "TaskMessageLog" ADD COLUMN     "pollId" TEXT;
-- CreateIndex
CREATE INDEX "Poll_taskId_idx" ON "Poll"("taskId");
-- CreateIndex
CREATE INDEX "TaskMessageLog_pollId_idx" ON "TaskMessageLog"("pollId");
-- AddForeignKey
ALTER TABLE "Poll" ADD CONSTRAINT "Poll_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "TaskMessageLog" ADD CONSTRAINT "TaskMessageLog_pollId_fkey" FOREIGN KEY ("pollId") REFERENCES "Poll"("id") ON DELETE SET NULL ON UPDATE CASCADE;
