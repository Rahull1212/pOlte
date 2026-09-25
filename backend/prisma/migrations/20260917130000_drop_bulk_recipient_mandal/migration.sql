-- Mandal is no longer a level in the hierarchy, so an uploaded contact
-- list has nothing to match it against. District, Assembly Constituency
-- and Polling Station remain.
-- AlterTable
ALTER TABLE "BulkRecipient" DROP COLUMN "mandalName";
