import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AiService } from "../ai/ai.service";
import { SpeechToTextService } from "../agents/speech-to-text.service";
import { FieldReportSource } from "@prisma/client";

/**
 * The Field Intelligence Agent's orchestration layer (Part 12/18/19 of the
 * spec) — "the agent" itself is AiService.extractFieldIntelligence() (the
 * actual understand/extract/classify/validate step, reusing the same
 * Claude-wrapper AI infra as every other insight in this app); this service
 * is the pipeline around it: speech-to-text -> extraction -> persistence to
 * the new FieldReport model -> a structured trace row
 * (AgentActivityLog) standing in for the "VoiceReportReceived /
 * VoiceReportProcessed / FieldReportCreated" events from the spec, since
 * this app has no generic domain-event bus to publish onto (see the
 * architecture assessment — "Events" here is the political-rally feature,
 * not a pub/sub system).
 */
@Injectable()
export class FieldReportsService {
  private readonly logger = new Logger(FieldReportsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly aiService: AiService,
    private readonly stt: SpeechToTextService,
  ) {}

  async createFromVoice(input: {
    cadreId: string;
    taskId: string | null;
    audio: Buffer;
    filename: string;
    mimeType: string;
    rawMediaUrl: string | null;
    correlationId: string;
  }) {
    await this.logAgentActivity({
      correlationId: input.correlationId,
      agentName: "FieldIntelligenceAgent",
      cadreId: input.cadreId,
      taskId: input.taskId,
      intent: "voice_report_received",
    });

    const transcription = await this.stt.transcribe(input.audio, input.filename, input.mimeType);
    if (!transcription) {
      // STT unconfigured or failed — never drop the voice note. Store it
      // with the raw audio for manual review rather than silently losing it.
      const report = await this.prisma.fieldReport.create({
        data: {
          taskId: input.taskId,
          cadreId: input.cadreId,
          source: "CADRE_VOICE_REPORT",
          rawMediaUrl: input.rawMediaUrl,
          reviewStatus: "NEEDS_REVIEW",
          evidenceUrls: input.rawMediaUrl ? [input.rawMediaUrl] : [],
        },
      });
      await this.logAgentActivity({
        correlationId: input.correlationId,
        agentName: "FieldIntelligenceAgent",
        cadreId: input.cadreId,
        taskId: input.taskId,
        intent: "voice_report_transcription_unavailable",
        confidence: 0,
        output: { reportId: report.id },
      });
      return report;
    }

    return this.createFromTranscript({
      cadreId: input.cadreId,
      taskId: input.taskId,
      transcript: transcription.transcript,
      language: transcription.detectedLanguage,
      source: "CADRE_VOICE_REPORT",
      rawMediaUrl: input.rawMediaUrl,
      correlationId: input.correlationId,
    });
  }

  async createFromText(input: { cadreId: string; taskId: string | null; text: string; correlationId: string }) {
    return this.createFromTranscript({
      cadreId: input.cadreId,
      taskId: input.taskId,
      transcript: input.text,
      language: null,
      source: "CADRE_TEXT_REPORT",
      rawMediaUrl: null,
      correlationId: input.correlationId,
    });
  }

  async createFromPhoto(input: { cadreId: string; taskId: string | null; mediaUrl: string; caption?: string | null; correlationId: string }) {
    const report = await this.prisma.fieldReport.create({
      data: {
        taskId: input.taskId,
        cadreId: input.cadreId,
        source: "CADRE_PHOTO_REPORT",
        rawMediaUrl: input.mediaUrl,
        originalTranscript: input.caption ?? null,
        evidenceUrls: [input.mediaUrl],
        reviewStatus: "SUBMITTED",
      },
    });
    await this.logAgentActivity({
      correlationId: input.correlationId,
      agentName: "FieldIntelligenceAgent",
      cadreId: input.cadreId,
      taskId: input.taskId,
      intent: "photo_report_received",
      output: { reportId: report.id },
    });
    return report;
  }

  private async createFromTranscript(input: {
    cadreId: string;
    taskId: string | null;
    transcript: string;
    language: string | null;
    source: Extract<FieldReportSource, "CADRE_VOICE_REPORT" | "CADRE_TEXT_REPORT">;
    rawMediaUrl: string | null;
    correlationId: string;
  }) {
    let taskContext: { name: string; objective: string | null } | null = null;
    if (input.taskId) {
      taskContext = await this.prisma.task.findUnique({ where: { id: input.taskId }, select: { name: true, objective: true } });
    }

    const extraction = await this.aiService.extractFieldIntelligence({
      transcript: input.transcript,
      language: input.language,
      taskContext,
    });

    const report = await this.prisma.fieldReport.create({
      data: {
        taskId: input.taskId,
        cadreId: input.cadreId,
        source: input.source,
        rawMediaUrl: input.rawMediaUrl,
        originalTranscript: input.transcript,
        detectedLanguage: input.language,
        normalizedText: extraction.summary,
        extractedData: { region: extraction.region, householdsVisited: extraction.householdsVisited },
        issues: extraction.issues,
        confidence: extraction.confidence,
        reviewStatus: extraction.needsReview ? "NEEDS_REVIEW" : "SUBMITTED",
        evidenceUrls: input.rawMediaUrl ? [input.rawMediaUrl] : [],
      },
    });

    await this.logAgentActivity({
      correlationId: input.correlationId,
      agentName: "FieldIntelligenceAgent",
      cadreId: input.cadreId,
      taskId: input.taskId,
      intent: input.source === "CADRE_VOICE_REPORT" ? "voice_report_processed" : "text_report_processed",
      confidence: extraction.confidence,
      model: "claude-sonnet-4-5",
      input: { transcript: input.transcript, language: input.language },
      output: { reportId: report.id, issues: extraction.issues, needsReview: extraction.needsReview },
    });

    return report;
  }

  private async logAgentActivity(data: {
    correlationId: string;
    agentName: string;
    cadreId?: string | null;
    taskId?: string | null;
    intent?: string;
    confidence?: number;
    model?: string;
    input?: unknown;
    output?: unknown;
  }) {
    try {
      await this.prisma.agentActivityLog.create({
        data: {
          correlationId: data.correlationId,
          agentName: data.agentName,
          cadreId: data.cadreId ?? undefined,
          taskId: data.taskId ?? undefined,
          intent: data.intent,
          confidence: data.confidence,
          model: data.model,
          input: data.input as any,
          output: data.output as any,
        },
      });
    } catch (err) {
      // Logging must never break the actual pipeline.
      this.logger.error(`Failed to write AgentActivityLog: ${(err as Error).message}`);
    }
  }

  listForTask(taskId: string) {
    return this.prisma.fieldReport.findMany({ where: { taskId }, orderBy: { createdAt: "desc" } });
  }

  reviewedVerify(id: string) {
    return this.prisma.fieldReport.update({ where: { id }, data: { reviewStatus: "VERIFIED" } });
  }

  /** Aggregate field-intelligence metrics for the existing dashboards (Part 22), scoped by the caller to a set of cadre ids. */
  async getDashboardMetrics(cadreIds: string[]) {
    if (cadreIds.length === 0) {
      return { totalFieldReports: 0, voiceReports: 0, householdsVisited: 0, needsReview: 0, topIssues: [] as { category: string; count: number }[] };
    }
    const reports = await this.prisma.fieldReport.findMany({ where: { cadreId: { in: cadreIds } } });

    let householdsVisited = 0;
    const issuesByCategory = new Map<string, number>();
    for (const r of reports) {
      const extracted = r.extractedData as { householdsVisited?: number } | null;
      householdsVisited += extracted?.householdsVisited ?? 0;
      const issues = (r.issues as { category: string }[] | null) ?? [];
      for (const issue of issues) {
        issuesByCategory.set(issue.category, (issuesByCategory.get(issue.category) ?? 0) + 1);
      }
    }

    return {
      totalFieldReports: reports.length,
      voiceReports: reports.filter((r) => r.source === "CADRE_VOICE_REPORT").length,
      householdsVisited,
      needsReview: reports.filter((r) => r.reviewStatus === "NEEDS_REVIEW").length,
      topIssues: Array.from(issuesByCategory.entries())
        .map(([category, count]) => ({ category, count }))
        .sort((a, b) => b.count - a.count),
    };
  }
}
