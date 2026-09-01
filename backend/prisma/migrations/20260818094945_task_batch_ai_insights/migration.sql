-- DropForeignKey
ALTER TABLE "AIInsight" DROP CONSTRAINT "AIInsight_campaignId_fkey";

-- AlterTable
ALTER TABLE "AIInsight" ADD COLUMN     "taskBatchId" TEXT,
ALTER COLUMN "campaignId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "AIInsight" ADD CONSTRAINT "AIInsight_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIInsight" ADD CONSTRAINT "AIInsight_taskBatchId_fkey" FOREIGN KEY ("taskBatchId") REFERENCES "TaskBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
