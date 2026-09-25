-- Meta's own wording for a refused send ("Business eligibility payment
-- issue"), carried in on a message.failed webhook. Stored verbatim because
-- it usually names the fix.
-- AlterTable
ALTER TABLE "TaskMessageLog" ADD COLUMN     "failureReason" TEXT;
