-- An Admin now accepts or declines a campaign they are assigned; a Super
-- Admin creates it and hands it over. Until an Admin accepts, they cannot
-- allocate that campaign's work to their Cadres.
--
-- Existing assignments default to PENDING, deliberately: they were made
-- before accepting existed, so nobody has actually agreed to them. Marking
-- them ACCEPTED would manufacture consent that was never given.
-- CreateEnum
CREATE TYPE "CampaignAssignmentStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED');

-- AlterTable
ALTER TABLE "CampaignAdmin" ADD COLUMN     "respondedAt" TIMESTAMP(3),
ADD COLUMN     "responseNote" TEXT,
ADD COLUMN     "status" "CampaignAssignmentStatus" NOT NULL DEFAULT 'PENDING';

-- CreateIndex
CREATE INDEX "CampaignAdmin_adminId_status_idx" ON "CampaignAdmin"("adminId", "status");

