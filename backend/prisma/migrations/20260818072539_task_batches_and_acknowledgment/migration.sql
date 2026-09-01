-- CreateEnum
CREATE TYPE "TaskAcknowledgment" AS ENUM ('AWAITING', 'ACCEPTED', 'DECLINED');

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'TASK_DECLINED';

-- AlterEnum
ALTER TYPE "TaskPriority" ADD VALUE 'URGENT';

-- DropForeignKey
ALTER TABLE "Task" DROP CONSTRAINT "Task_campaignId_fkey";

-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "acknowledgedAt" TIMESTAMP(3),
ADD COLUMN     "acknowledgment" "TaskAcknowledgment" NOT NULL DEFAULT 'AWAITING',
ADD COLUMN     "additionalDetails" TEXT,
ADD COLUMN     "batchId" TEXT,
ADD COLUMN     "needsReassignment" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "objective" TEXT,
ALTER COLUMN "campaignId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "TaskBatch" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "objective" TEXT,
    "description" TEXT,
    "additionalDetails" TEXT,
    "remarks" TEXT,
    "deadline" TIMESTAMP(3) NOT NULL,
    "priority" "TaskPriority" NOT NULL DEFAULT 'MEDIUM',
    "campaignId" TEXT,
    "targetRegionIds" TEXT[],
    "attachmentUrls" TEXT[],
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskBatch_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "TaskBatch" ADD CONSTRAINT "TaskBatch_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskBatch" ADD CONSTRAINT "TaskBatch_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "TaskBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
