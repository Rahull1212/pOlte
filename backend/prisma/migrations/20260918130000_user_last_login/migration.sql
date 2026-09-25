-- Shown on the Admin Profile. Nullable with no backfill: we genuinely do
-- not know when existing users last signed in, and inventing a timestamp
-- would be worse than showing "Never signed in".
-- AlterTable
ALTER TABLE "User" ADD COLUMN     "lastLoginAt" TIMESTAMP(3);

