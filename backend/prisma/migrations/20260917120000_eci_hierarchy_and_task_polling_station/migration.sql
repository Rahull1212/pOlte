-- The area tree becomes the Election Commission's own hierarchy:
-- State > District > Assembly Constituency > Polling Station.
--
-- Mandals were a revenue administrative unit with no electoral meaning, so
-- they are not deleted but *reclassified* as Constituencies: every Mandal
-- already sits under a District and holds Booths, which is exactly where an
-- AC sits. Doing it this way keeps every row id, so the 39 users, 52 tasks
-- and everything else pointing at these areas stay valid. Real AC names and
-- numbers are loaded afterwards by prisma/import-eci-regions.ts.
UPDATE "Region" SET "type" = 'CONSTITUENCY' WHERE "type" = 'MANDAL';

-- MANDAL is now unused and removed from the enum. Postgres cannot drop a
-- value in place, so the type is rebuilt.
ALTER TYPE "RegionType" RENAME TO "RegionType_old";
CREATE TYPE "RegionType" AS ENUM ('STATE', 'DISTRICT', 'CONSTITUENCY', 'BOOTH');
ALTER TABLE "Region" ALTER COLUMN "type" TYPE "RegionType" USING ("type"::text::"RegionType");
DROP TYPE "RegionType_old";

-- The official location a task is carried out at. A polling station fixes
-- the Assembly Constituency, District and State by ancestry, so those four
-- official fields can never disagree with one another.
-- AlterTable
ALTER TABLE "Task" ADD COLUMN "pollingStationId" TEXT;

-- AlterTable
ALTER TABLE "TaskBatch" ADD COLUMN "pollingStationId" TEXT;

-- CreateIndex
CREATE INDEX "Task_pollingStationId_idx" ON "Task"("pollingStationId");

-- CreateIndex
CREATE INDEX "TaskBatch_pollingStationId_idx" ON "TaskBatch"("pollingStationId");

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_pollingStationId_fkey" FOREIGN KEY ("pollingStationId") REFERENCES "Region"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskBatch" ADD CONSTRAINT "TaskBatch_pollingStationId_fkey" FOREIGN KEY ("pollingStationId") REFERENCES "Region"("id") ON DELETE SET NULL ON UPDATE CASCADE;
