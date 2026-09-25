-- Google Sheets removed: the message log lives in TaskMessageLog and is read
-- straight from the app, so there is nothing left to mirror to a spreadsheet.
-- All three tables were empty (no sheet was ever connected), so this drops no
-- data.

-- DropForeignKey
ALTER TABLE "GoogleOAuthConnection" DROP CONSTRAINT "GoogleOAuthConnection_connectedById_fkey";

-- DropForeignKey
ALTER TABLE "GoogleServiceAccount" DROP CONSTRAINT "GoogleServiceAccount_uploadedById_fkey";

-- DropForeignKey
ALTER TABLE "SheetConnection" DROP CONSTRAINT "SheetConnection_connectedById_fkey";

-- DropTable
DROP TABLE "GoogleOAuthConnection";

-- DropTable
DROP TABLE "GoogleServiceAccount";

-- DropTable
DROP TABLE "SheetConnection";
