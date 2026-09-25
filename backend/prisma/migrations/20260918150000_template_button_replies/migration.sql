-- What each Quick Reply on a user's assigned template replies with when a
-- Cadre taps it. Null means "use the built-in behaviour", which is what
-- every existing assignment had before this was configurable.
-- AlterTable
ALTER TABLE "User" ADD COLUMN     "fyxoTemplateButtons" JSONB;

