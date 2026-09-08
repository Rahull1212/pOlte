-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "WhatsappDeliveryStatus" ADD VALUE 'DELIVERED';
ALTER TYPE "WhatsappDeliveryStatus" ADD VALUE 'READ';

-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "completedAt" TIMESTAMP(3),
ADD COLUMN     "deliveredAt" TIMESTAMP(3),
ADD COLUMN     "readAt" TIMESTAMP(3),
ADD COLUMN     "whatsappMessageId" TEXT;

-- CreateIndex
CREATE INDEX "Task_whatsappMessageId_idx" ON "Task"("whatsappMessageId");
