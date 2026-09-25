-- The Create Campaign form no longer asks for an overall target or budget:
-- those are allocated per area on the Targets/Budget screens. Null now means
-- "none declared", and AllocationsService applies no cap in that case.
-- Widening only — existing values are untouched.
-- AlterTable
ALTER TABLE "Campaign" ALTER COLUMN "totalTarget" DROP NOT NULL,
ALTER COLUMN "totalBudget" DROP NOT NULL;

