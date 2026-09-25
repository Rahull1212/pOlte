import { Processor, WorkerHost } from "@nestjs/bullmq";
import { Job } from "bullmq";
import { Logger } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { ConversationRouterService } from "../agents/conversation-router.service";
import { TasksService } from "../tasks/tasks.service";
import { PrismaService } from "../prisma/prisma.service";
import { extractInboundMessage, extractStatusUpdate } from "./fyxo-inbound.types";

/**
 * The async worker Part 5 requires — everything the webhook controller
 * queued lands here, off the request/response cycle. Business/AI logic
 * (Cadre identity resolution, deterministic button dispatch, the Cadre
 * Agent, the Field Intelligence Agent) all runs from this process(), never
 * inline in the webhook.
 */
@Processor("fyxo-agent-jobs")
export class FyxoAgentJobsProcessor extends WorkerHost {
  private readonly logger = new Logger(FyxoAgentJobsProcessor.name);

  constructor(
    private readonly conversationRouter: ConversationRouterService,
    private readonly tasksService: TasksService,
    private readonly prisma: PrismaService,
  ) {
    super();
  }

  async process(job: Job<{ eventType: string; body: Record<string, unknown>; deliveryId?: string }>): Promise<void> {
    const { eventType, body, deliveryId } = job.data;
    const correlationId = randomUUID();

    try {
      if (eventType === "message.received") {
        // Full body, not truncated — this is the one shape (a template
        // button tap) that was never actually confirmed against a real
        // payload; losing part of it here defeats the point of logging it.
        this.logger.log(`message.received raw payload: ${JSON.stringify(body)}`);
        const message = extractInboundMessage(body);
        if (!message) {
          this.logger.warn(`message.received payload didn't match any known shape (see raw payload logged above)`);
          await this.markProcessed(deliveryId);
          return;
        }
        await this.conversationRouter.handleInboundMessage(message, correlationId);
        await this.markProcessed(deliveryId);
        return;
      }

      if (eventType === "message.sent" || eventType === "message.delivered" || eventType === "message.read" || eventType === "message.failed") {
        const status = extractStatusUpdate(body);
        if (!status) {
          this.logger.warn(`${eventType} payload missing a correlatable message id: ${JSON.stringify(body).slice(0, 300)}`);
          return;
        }
        if (status.error) {
          // Meta's refusal reason — logged loudly as well as stored, because
          // it is the one line that explains why a Cadre got nothing.
          this.logger.warn(`${eventType} for ${status.messageId}: ${status.error}`);
        }
        await this.tasksService.handleFyxoStatusUpdate(status.messageId, eventType, new Date(), status.error);
        return;
      }

      if (eventType === "contact.opted_out") {
        // Nothing to do today beyond logging — this app has no separate
        // opt-out flag on User; Cadres are managed accounts, not
        // self-service WhatsApp subscribers.
        this.logger.log(`Fyxo contact opted out: ${JSON.stringify(body).slice(0, 200)}`);
        return;
      }

      if (eventType === "contact.created") {
        this.logger.log(`Fyxo contact created: ${JSON.stringify(body).slice(0, 200)}`);
        return;
      }

      this.logger.warn(`Unhandled Fyxo event type: ${eventType}`);
    } catch (err) {
      this.logger.error(`Failed to process Fyxo event ${eventType}: ${(err as Error).message}`);
      throw err; // let BullMQ retry with its configured backoff
    }
  }

  /** Best-effort bookkeeping only — never lets a stamping failure fail the job itself. */
  private async markProcessed(deliveryId: string | undefined) {
    if (!deliveryId) return;
    try {
      await this.prisma.fyxoWebhookEvent.update({ where: { id: deliveryId }, data: { processedAt: new Date() } });
    } catch (err) {
      this.logger.warn(`Failed to stamp processedAt for ${deliveryId}: ${(err as Error).message}`);
    }
  }
}
