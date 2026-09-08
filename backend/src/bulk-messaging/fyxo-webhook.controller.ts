import { Controller, Headers, HttpCode, Logger, Post, Req, UnauthorizedException } from "@nestjs/common";
import type { RawBodyRequest } from "@nestjs/common";
import type { Request } from "express";
import { Public } from "../common/decorators/public.decorator";
import { BulkMessagingService } from "./bulk-messaging.service";
import { verifyFyxoSignature } from "../fyxo-agent/verify-signature.util";

/**
 * Receives delivery-status callbacks from Fyxo Connect for bulk-message
 * recipients. Must be @Public() — Fyxo Connect calls this directly, it has
 * no PoliOS JWT to present.
 *
 * Confirmed contract (API.md §10): every event arrives as
 *   { event: "message.sent" | "message.delivered" | "message.read" |
 *             "message.failed" | "contact.opted_out" | ...,
 *     sentAt: string,
 *     data: { messageId: string, waId: string } }
 * signed via x-fyxo-signature — see verifyFyxoSignature. FyxoAgentWebhookController
 * uses the same secret/header/algorithm for the task-assignment channel;
 * this is a second, independent endpoint for the bulk-messaging channel
 * (matches the codebase's existing separation of the two features).
 */
@Controller("fyxo-connect")
export class FyxoWebhookController {
  private readonly logger = new Logger(FyxoWebhookController.name);

  constructor(private readonly bulkMessagingService: BulkMessagingService) {}

  @Public()
  @Post("webhook")
  @HttpCode(200)
  async receive(
    @Req() req: RawBodyRequest<Request>,
    @Headers("x-fyxo-signature") signature: string | undefined,
  ) {
    const secret = process.env.FYXO_WEBHOOK_SECRET;
    if (secret) {
      if (!req.rawBody || !verifyFyxoSignature(req.rawBody, signature, secret)) {
        throw new UnauthorizedException("Invalid Fyxo signature");
      }
    } else {
      this.logger.warn("FYXO_WEBHOOK_SECRET not set — accepting Fyxo Connect webhook without signature verification");
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    const data = (body.data ?? {}) as Record<string, unknown>;
    const messageId = (data.messageId ?? data.message_id ?? data.id ?? body.messageId ?? body.id) as string | undefined;
    const event = (body.event ?? body.status) as string | undefined;
    const timestamp = (body.sentAt ?? body.timestamp ?? body.time ?? body.updatedAt) as string | undefined;

    if (!messageId || !event) {
      this.logger.warn(`Fyxo Connect webhook: payload missing data.messageId/event — ${JSON.stringify(body)}`);
      return { received: true, applied: false };
    }

    try {
      const applied = await this.bulkMessagingService.handleStatusWebhook(messageId, event, timestamp);
      return { received: true, applied };
    } catch (err) {
      this.logger.error(`Failed to process Fyxo Connect webhook: ${(err as Error).message}`);
      return { received: true, applied: false };
    }
  }
}
