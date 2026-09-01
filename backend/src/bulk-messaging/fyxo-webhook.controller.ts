import { Body, Controller, HttpCode, Logger, Post } from "@nestjs/common";
import { Public } from "../common/decorators/public.decorator";
import { BulkMessagingService } from "./bulk-messaging.service";

/**
 * Receives delivery-status callbacks from Fyxo Connect. Must be @Public() —
 * Fyxo Connect calls this directly, it has no PoliOS JWT to present.
 *
 * ============================================================
 * CONTRACT NOT YET CONFIRMED. This accepts a best-guess generic shape:
 *   { messageId | message_id | id: string,
 *     status | event: "sent" | "delivered" | "read" | "failed" | "opted_out",
 *     timestamp | time | updatedAt?: string }
 * and tries a few common field-name spellings so it has the best chance of
 * working unmodified — but until Fyxo Connect's real webhook payload is
 * confirmed, treat this as a starting point, not a verified contract.
 *
 * Also NOT implemented: verifying the call actually came from Fyxo Connect
 * (e.g. a signature header). Do not point Fyxo Connect at this endpoint in
 * production before that's addressed — same class of gap already flagged
 * for the Meta WhatsApp webhook (see docs/ARC-007).
 * ============================================================
 */
@Controller("fyxo-connect")
export class FyxoWebhookController {
  private readonly logger = new Logger(FyxoWebhookController.name);

  constructor(private readonly bulkMessagingService: BulkMessagingService) {}

  @Public()
  @Post("webhook")
  @HttpCode(200)
  async receive(@Body() body: Record<string, unknown>) {
    const messageId = (body.messageId ?? body.message_id ?? body.id) as string | undefined;
    const status = (body.status ?? body.event) as string | undefined;
    const timestamp = (body.timestamp ?? body.time ?? body.updatedAt) as string | undefined;

    if (!messageId || !status) {
      this.logger.warn(`Fyxo Connect webhook: payload missing messageId/status — ${JSON.stringify(body)}`);
      return { received: true, applied: false };
    }

    try {
      const applied = await this.bulkMessagingService.handleStatusWebhook(messageId, status, timestamp);
      return { received: true, applied };
    } catch (err) {
      this.logger.error(`Failed to process Fyxo Connect webhook: ${(err as Error).message}`);
      return { received: true, applied: false };
    }
  }
}
