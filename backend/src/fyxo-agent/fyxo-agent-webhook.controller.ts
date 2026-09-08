import { Controller, Headers, HttpCode, Logger, Post, Req, UnauthorizedException } from "@nestjs/common";
import type { RawBodyRequest } from "@nestjs/common";
import type { Request } from "express";
import { InjectQueue } from "@nestjs/bullmq";
import { Queue } from "bullmq";
import { randomUUID } from "node:crypto";
import { Public } from "../common/decorators/public.decorator";
import { PrismaService } from "../prisma/prisma.service";
import { verifyFyxoSignature } from "./verify-signature.util";

/**
 * Receives inbound events from Fyxo Connect (Part 4/5 of the spec):
 * message.received, message.sent/delivered/read/failed, contact.created,
 * contact.opted_out. Must be @Public() — Fyxo calls this directly, it has
 * no PoliOS JWT. Deliberately separate from WhatsAppWebhookController
 * (Meta) — two independent channels per the chosen rollout plan.
 *
 * Per Part 5: verify signature -> ack fast -> queue -> dedupe -> process
 * async. No business/AI logic runs inline in this request.
 */
@Controller("fyxo-agent")
export class FyxoAgentWebhookController {
  private readonly logger = new Logger(FyxoAgentWebhookController.name);

  constructor(
    @InjectQueue("fyxo-agent-jobs") private readonly queue: Queue,
    private readonly prisma: PrismaService,
  ) {}

  @Public()
  @Post("webhook")
  @HttpCode(200)
  async receive(
    @Req() req: RawBodyRequest<Request>,
    @Headers("x-fyxo-signature") signature: string | undefined,
    @Headers("x-fyxo-event") eventType: string | undefined,
    @Headers("x-fyxo-delivery-attempt") deliveryAttempt: string | undefined,
  ) {
    const secret = process.env.FYXO_WEBHOOK_SECRET;
    if (secret) {
      if (!req.rawBody || !verifyFyxoSignature(req.rawBody, signature, secret)) {
        throw new UnauthorizedException("Invalid Fyxo signature");
      }
    } else {
      this.logger.warn("FYXO_WEBHOOK_SECRET not set — accepting Fyxo webhook without signature verification");
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    // §10 confirms the envelope carries no standalone delivery/event id — the
    // docs' own dedup guidance ("make handling idempotent on messageId") is
    // the correlating key. Paired with eventType since one messageId
    // legitimately produces several distinct events (sent, delivered, read).
    // Falls back to a random id only for an event that carries neither
    // messageId nor waId (e.g. a shape we don't recognize), where dedup
    // isn't meaningful anyway.
    const data = (body.data ?? {}) as Record<string, unknown>;
    const correlationId = (data.messageId ?? data.waId ?? body.id) as string | undefined;
    const deliveryId = correlationId ? `${eventType ?? "unknown"}-${correlationId}` : `${eventType ?? "unknown"}-${randomUUID()}`;

    // Dedup: the delivery id is the primary key, so a redelivery of the same
    // event is a harmless unique-constraint failure — ack it and stop.
    try {
      await this.prisma.fyxoWebhookEvent.create({
        data: { id: String(deliveryId), eventType: eventType ?? "unknown", rawBody: body as any },
      });
    } catch {
      this.logger.log(`Duplicate Fyxo webhook delivery ignored: ${deliveryId} (attempt ${deliveryAttempt ?? "?"})`);
      return { received: true, duplicate: true };
    }

    await this.queue.add(
      "process-event",
      { eventType: eventType ?? "unknown", body, deliveryId: String(deliveryId) },
      { attempts: 3, backoff: { type: "exponential", delay: 2000 } },
    );

    return { received: true };
  }
}
