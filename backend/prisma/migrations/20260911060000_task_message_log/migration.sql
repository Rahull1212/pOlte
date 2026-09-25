-- CreateTable
CREATE TABLE "TaskMessageLog" (
    "id" TEXT NOT NULL,
    "cadreId" TEXT,
    "cadreName" TEXT NOT NULL,
    "cadrePhone" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "taskId" TEXT,
    "taskName" TEXT,
    "assignedById" TEXT,
    "assignedByName" TEXT,
    "kind" TEXT NOT NULL,
    "templateName" TEXT,
    "channel" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "providerMessageId" TEXT,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskMessageLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TaskMessageLog_sentAt_idx" ON "TaskMessageLog"("sentAt");

-- CreateIndex
CREATE INDEX "TaskMessageLog_cadreId_sentAt_idx" ON "TaskMessageLog"("cadreId", "sentAt");

-- CreateIndex
CREATE INDEX "TaskMessageLog_taskId_idx" ON "TaskMessageLog"("taskId");

-- AddForeignKey
ALTER TABLE "TaskMessageLog" ADD CONSTRAINT "TaskMessageLog_cadreId_fkey" FOREIGN KEY ("cadreId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskMessageLog" ADD CONSTRAINT "TaskMessageLog_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskMessageLog" ADD CONSTRAINT "TaskMessageLog_assignedById_fkey" FOREIGN KEY ("assignedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
