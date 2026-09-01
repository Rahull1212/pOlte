-- CreateEnum
CREATE TYPE "EventRsvpStatus" AS ENUM ('PENDING', 'CONFIRMED', 'DECLINED');

-- AlterTable
ALTER TABLE "Event" ADD COLUMN     "attachmentUrls" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "expectedAttendees" INTEGER,
ADD COLUMN     "instructions" TEXT,
ADD COLUMN     "location" TEXT,
ADD COLUMN     "objective" TEXT,
ADD COLUMN     "organizer" TEXT,
ADD COLUMN     "remarks" TEXT;

-- AlterTable
ALTER TABLE "EventParticipant" ADD COLUMN     "rsvpStatus" "EventRsvpStatus" NOT NULL DEFAULT 'PENDING';
