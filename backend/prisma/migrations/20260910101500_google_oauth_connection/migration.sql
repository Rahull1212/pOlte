-- CreateTable
CREATE TABLE "GoogleOAuthConnection" (
    "id" TEXT NOT NULL,
    "clientId" TEXT,
    "clientSecret" TEXT,
    "refreshToken" TEXT,
    "accountEmail" TEXT,
    "connectedById" TEXT,
    "connectedAt" TIMESTAMP(3),

    CONSTRAINT "GoogleOAuthConnection_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "GoogleOAuthConnection" ADD CONSTRAINT "GoogleOAuthConnection_connectedById_fkey" FOREIGN KEY ("connectedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
