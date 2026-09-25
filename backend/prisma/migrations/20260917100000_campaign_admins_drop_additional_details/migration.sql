-- "Additional details" removed from tasks: the field duplicated `description`
-- and nothing downstream distinguished them.
-- AlterTable
ALTER TABLE "Task" DROP COLUMN "additionalDetails";

-- AlterTable
ALTER TABLE "TaskBatch" DROP COLUMN "additionalDetails";

-- Admins responsible for a campaign, chosen at creation. A join table because
-- a campaign spans several Admins' areas and an Admin runs several campaigns.
-- CreateTable
CREATE TABLE "CampaignAdmin" (
    "campaignId" TEXT NOT NULL,
    "adminId" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CampaignAdmin_pkey" PRIMARY KEY ("campaignId","adminId")
);

-- CreateIndex
CREATE INDEX "CampaignAdmin_adminId_idx" ON "CampaignAdmin"("adminId");

-- AddForeignKey
ALTER TABLE "CampaignAdmin" ADD CONSTRAINT "CampaignAdmin_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignAdmin" ADD CONSTRAINT "CampaignAdmin_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
