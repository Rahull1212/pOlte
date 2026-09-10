-- CreateTable
CREATE TABLE "AvailableTemplate" (
    "name" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "body" TEXT,
    "status" TEXT,
    "source" TEXT NOT NULL,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AvailableTemplate_pkey" PRIMARY KEY ("name")
);
