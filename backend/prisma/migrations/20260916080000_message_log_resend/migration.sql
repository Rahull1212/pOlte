-- Resend support on the message log: the variables the template was
-- originally rendered with (so a retry repeats the same message rather than
-- re-deriving one that may have changed), plus per-attempt bookkeeping.
-- AlterTable
ALTER TABLE "TaskMessageLog" ADD COLUMN     "lastRetryAt" TIMESTAMP(3),
ADD COLUMN     "retryCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "retryHistory" JSONB,
ADD COLUMN     "variables" TEXT[];

-- Backs the KPI filters (all / SENT / FAILED) on the Message Log page.
-- CreateIndex
CREATE INDEX "TaskMessageLog_status_sentAt_idx" ON "TaskMessageLog"("status", "sentAt");
