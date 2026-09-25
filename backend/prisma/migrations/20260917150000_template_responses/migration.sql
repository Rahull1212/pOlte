-- What a Cadre did with a template we sent: a button tap, or a reply.
-- Nothing recorded inbound responses before — a quick-reply arrived, the
-- router logged a line, and the tap was gone. Without this there is no way
-- to answer "who opened their task and who ignored it".
-- CreateTable
CREATE TABLE "TemplateResponse" (
    "id" TEXT NOT NULL,
    "messageLogId" TEXT,
    "taskId" TEXT,
    "cadreId" TEXT,
    "cadreName" TEXT NOT NULL,
    "cadrePhone" TEXT NOT NULL,
    "responseType" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "label" TEXT,
    "rawPayload" TEXT,
    "respondedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TemplateResponse_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TemplateResponse_taskId_idx" ON "TemplateResponse"("taskId");

-- CreateIndex
CREATE INDEX "TemplateResponse_cadreId_respondedAt_idx" ON "TemplateResponse"("cadreId", "respondedAt");

-- CreateIndex
CREATE INDEX "TemplateResponse_respondedAt_idx" ON "TemplateResponse"("respondedAt");

-- CreateIndex
CREATE INDEX "TemplateResponse_action_idx" ON "TemplateResponse"("action");

-- AddForeignKey
ALTER TABLE "TemplateResponse" ADD CONSTRAINT "TemplateResponse_messageLogId_fkey" FOREIGN KEY ("messageLogId") REFERENCES "TaskMessageLog"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TemplateResponse" ADD CONSTRAINT "TemplateResponse_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TemplateResponse" ADD CONSTRAINT "TemplateResponse_cadreId_fkey" FOREIGN KEY ("cadreId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

