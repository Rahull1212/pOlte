-- CreateTable
CREATE TABLE "GoogleServiceAccount" (
    "id" TEXT NOT NULL,
    "clientEmail" TEXT NOT NULL,
    "privateKey" TEXT NOT NULL,
    "projectId" TEXT,
    "uploadedById" TEXT,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GoogleServiceAccount_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "GoogleServiceAccount" ADD CONSTRAINT "GoogleServiceAccount_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
