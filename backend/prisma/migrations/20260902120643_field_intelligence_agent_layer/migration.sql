-- CreateEnum
CREATE TYPE "FieldReportSource" AS ENUM ('CADRE_VOICE_REPORT', 'CADRE_TEXT_REPORT', 'CADRE_PHOTO_REPORT', 'CADRE_DOCUMENT_REPORT');

-- CreateEnum
CREATE TYPE "FieldReportReviewStatus" AS ENUM ('SUBMITTED', 'NEEDS_REVIEW', 'VERIFIED');

-- CreateTable
CREATE TABLE "FieldReport" (
    "id" TEXT NOT NULL,
    "taskId" TEXT,
    "cadreId" TEXT NOT NULL,
    "source" "FieldReportSource" NOT NULL,
    "rawMediaUrl" TEXT,
    "originalTranscript" TEXT,
    "detectedLanguage" TEXT,
    "normalizedText" TEXT,
    "extractedData" JSONB,
    "issues" JSONB,
    "confidence" DOUBLE PRECISION,
    "reviewStatus" "FieldReportReviewStatus" NOT NULL DEFAULT 'SUBMITTED',
    "evidenceUrls" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FieldReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FyxoWebhookEvent" (
    "id" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "FyxoWebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentActivityLog" (
    "id" TEXT NOT NULL,
    "correlationId" TEXT NOT NULL,
    "agentName" TEXT NOT NULL,
    "toolName" TEXT,
    "userId" TEXT,
    "cadreId" TEXT,
    "taskId" TEXT,
    "conversationId" TEXT,
    "messageId" TEXT,
    "intent" TEXT,
    "confidence" DOUBLE PRECISION,
    "model" TEXT,
    "promptVersion" TEXT,
    "input" JSONB,
    "output" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentActivityLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FieldReport_taskId_idx" ON "FieldReport"("taskId");

-- CreateIndex
CREATE INDEX "FieldReport_cadreId_idx" ON "FieldReport"("cadreId");

-- CreateIndex
CREATE INDEX "FieldReport_reviewStatus_idx" ON "FieldReport"("reviewStatus");

-- CreateIndex
CREATE INDEX "AgentActivityLog_correlationId_idx" ON "AgentActivityLog"("correlationId");

-- CreateIndex
CREATE INDEX "AgentActivityLog_cadreId_createdAt_idx" ON "AgentActivityLog"("cadreId", "createdAt");

-- AddForeignKey
ALTER TABLE "FieldReport" ADD CONSTRAINT "FieldReport_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FieldReport" ADD CONSTRAINT "FieldReport_cadreId_fkey" FOREIGN KEY ("cadreId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
