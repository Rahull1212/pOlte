-- CreateEnum
CREATE TYPE "WhatsappDeliveryStatus" AS ENUM ('PENDING', 'SENT', 'FAILED');

-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "whatsappSentAt" TIMESTAMP(3),
ADD COLUMN     "whatsappStatus" "WhatsappDeliveryStatus" NOT NULL DEFAULT 'PENDING';
