-- CreateEnum
CREATE TYPE "BulkCampaignStatus" AS ENUM ('DRAFT', 'SENDING', 'SENT', 'FAILED');

-- CreateEnum
CREATE TYPE "BulkRecipientStatus" AS ENUM ('PENDING', 'SENT', 'DELIVERED', 'READ', 'FAILED', 'OPTED_OUT');

-- CreateTable
CREATE TABLE "BulkMessageCampaign" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "messageText" TEXT,
    "mediaUrl" TEXT,
    "templateId" TEXT,
    "status" "BulkCampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "totalContacts" INTEGER NOT NULL DEFAULT 0,
    "validCount" INTEGER NOT NULL DEFAULT 0,
    "invalidCount" INTEGER NOT NULL DEFAULT 0,
    "duplicateCount" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),

    CONSTRAINT "BulkMessageCampaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BulkRecipient" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "name" TEXT,
    "phone" TEXT NOT NULL,
    "rawPhone" TEXT NOT NULL,
    "districtName" TEXT,
    "constituencyName" TEXT,
    "mandalName" TEXT,
    "boothName" TEXT,
    "regionId" TEXT,
    "isValidPhone" BOOLEAN NOT NULL DEFAULT true,
    "isDuplicate" BOOLEAN NOT NULL DEFAULT false,
    "selected" BOOLEAN NOT NULL DEFAULT true,
    "status" "BulkRecipientStatus" NOT NULL DEFAULT 'PENDING',
    "providerMessageId" TEXT,
    "sentAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "readAt" TIMESTAMP(3),
    "failedReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BulkRecipient_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BulkMessageCampaign_status_idx" ON "BulkMessageCampaign"("status");

-- CreateIndex
CREATE INDEX "BulkRecipient_campaignId_status_idx" ON "BulkRecipient"("campaignId", "status");

-- CreateIndex
CREATE INDEX "BulkRecipient_campaignId_selected_idx" ON "BulkRecipient"("campaignId", "selected");

-- CreateIndex
CREATE INDEX "BulkRecipient_providerMessageId_idx" ON "BulkRecipient"("providerMessageId");

-- AddForeignKey
ALTER TABLE "BulkMessageCampaign" ADD CONSTRAINT "BulkMessageCampaign_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BulkRecipient" ADD CONSTRAINT "BulkRecipient_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "BulkMessageCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BulkRecipient" ADD CONSTRAINT "BulkRecipient_regionId_fkey" FOREIGN KEY ("regionId") REFERENCES "Region"("id") ON DELETE SET NULL ON UPDATE CASCADE;
