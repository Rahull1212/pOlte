-- DropForeignKey
ALTER TABLE "AuditLog" DROP CONSTRAINT "AuditLog_userId_fkey";

-- DropForeignKey
ALTER TABLE "FieldReport" DROP CONSTRAINT "FieldReport_cadreId_fkey";

-- DropForeignKey
ALTER TABLE "ProgressUpdate" DROP CONSTRAINT "ProgressUpdate_cadreId_fkey";

-- AlterTable
ALTER TABLE "AuditLog" ALTER COLUMN "userId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "FieldReport" ALTER COLUMN "cadreId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "ProgressUpdate" ALTER COLUMN "cadreId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "ProgressUpdate" ADD CONSTRAINT "ProgressUpdate_cadreId_fkey" FOREIGN KEY ("cadreId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FieldReport" ADD CONSTRAINT "FieldReport_cadreId_fkey" FOREIGN KEY ("cadreId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
