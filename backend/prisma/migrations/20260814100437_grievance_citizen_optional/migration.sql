-- DropForeignKey
ALTER TABLE "Grievance" DROP CONSTRAINT "Grievance_citizenId_fkey";

-- AlterTable
ALTER TABLE "Grievance" ALTER COLUMN "citizenId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "Grievance" ADD CONSTRAINT "Grievance_citizenId_fkey" FOREIGN KEY ("citizenId") REFERENCES "Citizen"("id") ON DELETE SET NULL ON UPDATE CASCADE;
