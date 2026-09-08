import { Body, Controller, Get, HttpCode, Logger, Post, Query, Res } from "@nestjs/common";
import type { Response } from "express";
import { Public } from "../common/decorators/public.decorator";
import { WhatsAppConversationService } from "./whatsapp-conversation.service";
import { extractMessages, extractStatuses, WhatsAppWebhookBody } from "./whatsapp-payload.types";
import { TasksService } from "../tasks/tasks.service";

/**
 * Receives inbound WhatsApp traffic from Meta. Both routes must be public —
 * Meta calls them directly, it has no PoliOS JWT to present.
 *
 * To actually receive traffic here in local dev, Meta needs a public HTTPS
 * URL (it cannot call http://localhost) — see README for the ngrok steps.
 */
@Controller("whatsapp")
export class WhatsAppWebhookController {
  private readonly logger = new Logger(WhatsAppWebhookController.name);

  constructor(
    private readonly conversationService: WhatsAppConversationService,
    private readonly tasksService: TasksService,
  ) {}

  @Public()
  @Get("webhook")
  verify(
    @Query("hub.mode") mode: string,
    @Query("hub.verify_token") token: string,
    @Query("hub.challenge") challenge: string,
    @Res() res: Response,
  ) {
    const expected = process.env.WHATSAPP_VERIFY_TOKEN ?? "polios-verify-token";
    if (mode === "subscribe" && token === expected) {
      res.status(200).send(challenge);
      return;
    }
    res.status(403).send("Verification failed");
  }

  @Public()
  @Post("webhook")
  @HttpCode(200)
  async receive(@Body() body: WhatsAppWebhookBody) {
    const messages = extractMessages(body);
    for (const message of messages) {
      try {
        await this.conversationService.handleIncomingMessage(message);
      } catch (err) {
        this.logger.error(`Failed to process WhatsApp message: ${(err as Error).message}`);
      }
    }

    // Delivery/read/failed receipts for messages *this app* sent — powers
    // the Task Communication dashboard's Delivered/Read KPIs for real,
    // rather than leaving them permanently at zero.
    const statuses = extractStatuses(body);
    for (const status of statuses) {
      try {
        await this.tasksService.handleWhatsappStatusUpdate(status.id, status.status, status.timestamp);
      } catch (err) {
        this.logger.error(`Failed to process WhatsApp status update: ${(err as Error).message}`);
      }
    }

    return { received: true };
  }
}
