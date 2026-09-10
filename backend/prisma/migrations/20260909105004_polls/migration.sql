-- CreateEnum
CREATE TYPE "PollRecipientStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'ANSWERED');

-- CreateTable
CREATE TABLE "Poll" (
    "id" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "options" TEXT[],
    "targetRegionIds" TEXT[],
    "deadline" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "awaitingAllocation" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Poll_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PollRecipient" (
    "id" TEXT NOT NULL,
    "pollId" TEXT NOT NULL,
    "cadreId" TEXT,
    "status" "PollRecipientStatus" NOT NULL DEFAULT 'PENDING',
    "fyxoMessageId" TEXT,
    "sentAt" TIMESTAMP(3),
    "selectedOption" INTEGER,
    "answeredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PollRecipient_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PollRecipient_pollId_idx" ON "PollRecipient"("pollId");

-- CreateIndex
CREATE INDEX "PollRecipient_fyxoMessageId_idx" ON "PollRecipient"("fyxoMessageId");

-- AddForeignKey
ALTER TABLE "Poll" ADD CONSTRAINT "Poll_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PollRecipient" ADD CONSTRAINT "PollRecipient_pollId_fkey" FOREIGN KEY ("pollId") REFERENCES "Poll"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PollRecipient" ADD CONSTRAINT "PollRecipient_cadreId_fkey" FOREIGN KEY ("cadreId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
