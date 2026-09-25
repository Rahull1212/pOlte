-- Grievances now carry PDFs and Word documents as evidence, not only photos,
-- so the column is renamed to match Task/TaskBatch's `attachmentUrls`.
-- A rename (not drop + add) so existing attachments survive.
ALTER TABLE "Grievance" RENAME COLUMN "photos" TO "attachmentUrls";

-- Who filed it, captured at submission time. Backfilled from the submitter's
-- current role, which is the best available answer for rows that predate the
-- column; from here on it is a snapshot taken at submission.
ALTER TABLE "Grievance" ADD COLUMN "submittedByRole" "Role";

UPDATE "Grievance" g
SET "submittedByRole" = u."role"
FROM "User" u
WHERE u."id" = g."submittedById";

-- Any row whose submitter has since been deleted defaults to CADRE: the
-- WhatsApp flow is how grievances have been filed in practice.
UPDATE "Grievance" SET "submittedByRole" = 'CADRE' WHERE "submittedByRole" IS NULL;

ALTER TABLE "Grievance" ALTER COLUMN "submittedByRole" SET NOT NULL;

-- Seeded to createdAt so existing rows don't all claim to have been touched
-- at migration time.
ALTER TABLE "Grievance" ADD COLUMN "updatedAt" TIMESTAMP(3);
UPDATE "Grievance" SET "updatedAt" = COALESCE("resolvedAt", "createdAt");
ALTER TABLE "Grievance" ALTER COLUMN "updatedAt" SET NOT NULL;

-- CreateIndex
CREATE INDEX "Grievance_submittedById_idx" ON "Grievance"("submittedById");
