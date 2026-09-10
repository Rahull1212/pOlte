-- CreateEnum
CREATE TYPE "TaskCompletionConfirmation" AS ENUM ('AWAITING', 'YES', 'NO');

-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "completionCheckFyxoMessageId" TEXT,
ADD COLUMN     "completionCheckSentAt" TIMESTAMP(3),
ADD COLUMN     "completionConfirmation" "TaskCompletionConfirmation",
ADD COLUMN     "completionConfirmedAt" TIMESTAMP(3);
