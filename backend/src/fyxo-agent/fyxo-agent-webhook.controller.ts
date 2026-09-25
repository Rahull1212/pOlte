import { Controller, Headers, HttpCode, Logger, Post, Req, UnauthorizedException } from "@nestjs/common";
import type { RawBodyRequest } from "@nestjs/common";
import type { Request } from "express";
import { InjectQueue } from "@nestjs/bullmq";
import { Queue } from "bullmq";
import { randomUUID } from "node:crypto";
import { Public } from "../common/decorators/public.decorator";
import { PrismaService } from "../prisma/prisma.service";
import { verifyFyxoSignature } from "./verify-signature.util";
import { TaskDetailsService } from "./task-details.service";

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
    private readonly taskDetails: TaskDetailsService,
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
    // A button tap carries NO messageId (confirmed against a live payload on
    // 2026-09-15), so keying dedup on waId alone made every tap after the
    // first from the same person look like a redelivery and get dropped —
    // "tapped View Task, then Contact Admin" only ever recorded the first.
    // Falling back to waId + when + what keeps real redeliveries (identical
    // payloads) deduped while letting two distinct taps through.
    const correlationId = (data.messageId ??
      (data.waId
        ? [data.waId, body.sentAt ?? data.sentAt ?? "", data.text ?? ""].join("|")
        : undefined) ??
      body.id) as string | undefined;
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

  /**
   * API.md §11 — Fyxo calls this when a Cadre taps a template button, and
   * sends whatever text we return as a free-form WhatsApp reply (free, since
   * the tap itself opened the 24-hour window).
   *
   * This is the endpoint that makes "Task Details" work, and the reason task
   * text lives in Postgres rather than a spreadsheet: it's read at the moment
   * of the tap, so there is nothing to keep in sync.
   *
   * Unlike the webhook above this answers inline rather than queueing — §11
   * gives us 8 seconds and the reply *is* the response body, so there is
   * nothing to defer.
   */
  @Public()
  @Post("details")
  @HttpCode(200)
  async details(@Req() req: RawBodyRequest<Request>, @Headers("x-fyxo-signature") signature: string | undefined) {
    // The details step carries its own secret in Fyxo's flow builder; most
    // installs set it to the same value as the webhook secret, so that's the
    // fallback rather than refusing to work until a second variable is set.
    const secret = process.env.FYXO_DETAILS_SECRET || process.env.FYXO_WEBHOOK_SECRET;
    if (secret) {
      if (!req.rawBody || !verifyFyxoSignature(req.rawBody, signature, secret)) {
        // Logged loudly: a rejected call is otherwise invisible here, and
        // from the Cadre's side it looks identical to the endpoint being
        // down — they just get the step's fallback text. The usual cause is
        // the secret on the flow step not matching the one configured here
        // (they are set in two different places, and a workspace switch
        // changes the webhook secret but not the flow step's).
        this.logger.error(
          `Details request REJECTED: signature did not verify. ` +
            `Check the secret on the Fyxo flow step matches ` +
            `${process.env.FYXO_DETAILS_SECRET ? "FYXO_DETAILS_SECRET" : "FYXO_WEBHOOK_SECRET"} in .env. ` +
            `(signature header ${signature ? "present" : "MISSING"})`,
        );
        // §11: "without it, anyone who learns your URL can read task content
        // by phone number" — so this refuses rather than degrading.
        throw new UnauthorizedException("Invalid Fyxo signature");
      }
    } else {
      this.logger.warn("No Fyxo details/webhook secret set — answering a details request unverified");
    }

    const body = (req.body ?? {}) as { waId?: string; reference?: string; text?: string };
    this.logger.log(`Details requested: waId=${body.waId ?? "?"} reference=${body.reference ?? "(none)"}`);

    try {
      return { text: await this.taskDetails.buildReply(body) };
    } catch (err) {
      // Returning no `text` makes Fyxo send the step's fallback, which is the
      // right outcome for the Cadre — but log loudly, because it means the
      // lookup broke rather than the task being missing.
      this.logger.error(`Details lookup failed: ${(err as Error).message}`);
      return {};
    }
  }
}
