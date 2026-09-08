import { Injectable, Logger } from "@nestjs/common";
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

const UPLOADS_DIR = join(process.cwd(), "uploads");

/**
 * Thin wrapper around the WhatsApp Business Cloud API (Meta Graph API).
 * Deliberately has zero dependency on any business module — anything that
 * needs to send a WhatsApp message imports this service, not the other way
 * around, which is what keeps the dependency graph acyclic (see
 * WhatsAppModule for the conversation state machine that DOES depend on
 * business modules, and imports this one).
 *
 * With no WHATSAPP_ACCESS_TOKEN configured, every send is a no-op that logs
 * what *would* have been sent — the same "silently degrade" pattern used for
 * the AI module when ANTHROPIC_API_KEY is unset.
 */
@Injectable()
export class WhatsAppApiService {
  private readonly logger = new Logger(WhatsAppApiService.name);

  private get isConfigured() {
    return Boolean(process.env.WHATSAPP_ACCESS_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID);
  }

  private get baseUrl() {
    const version = process.env.WHATSAPP_API_VERSION ?? "v20.0";
    const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
    return `https://graph.facebook.com/${version}/${phoneNumberId}`;
  }

  private get graphApiRoot() {
    const version = process.env.WHATSAPP_API_VERSION ?? "v20.0";
    return `https://graph.facebook.com/${version}`;
  }

  /**
   * Returns whether the send succeeded (or was accepted as a simulated
   * no-op when unconfigured) so callers that need to persist per-recipient
   * delivery status — e.g. TasksService.allocateToCadres — can record it,
   * rather than firing-and-forgetting blind. When real, also returns Meta's
   * message id (wamid) so a later delivered/read status webhook callback
   * can be correlated back to whatever this message was for — see
   * TasksService.handleWhatsappStatusUpdate.
   */
  async sendText(toPhone: string, body: string): Promise<{ success: boolean; messageId?: string }> {
    if (!this.isConfigured) {
      this.logger.warn(`[WhatsApp not configured] would send to ${toPhone}: ${body}`);
      return { success: true };
    }

    try {
      const response = await fetch(`${this.baseUrl}/messages`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: toPhone,
          type: "text",
          text: { body },
        }),
      });
      if (!response.ok) {
        const errorBody = await response.text();
        this.logger.error(`WhatsApp send failed (${response.status}): ${errorBody}`);
        return { success: false };
      }
      const payload = (await response.json().catch(() => null)) as { messages?: { id: string }[] } | null;
      return { success: true, messageId: payload?.messages?.[0]?.id };
    } catch (err) {
      this.logger.error(`WhatsApp send threw: ${(err as Error).message}`);
      return { success: false };
    }
  }

  /**
   * Downloads inbound media (photo/voice note) by its WhatsApp media ID and
   * saves it locally under /uploads. Stands in for real object storage
   * (S3/Cloudinary) until that's built — same limitation as the rest of the
   * app's file handling.
   */
  async downloadMedia(mediaId: string): Promise<string | null> {
    if (!this.isConfigured) {
      this.logger.warn(`[WhatsApp not configured] would download media ${mediaId}`);
      return null;
    }

    try {
      const metaRes = await fetch(`${this.graphApiRoot}/${mediaId}`, {
        headers: { Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}` },
      });
      if (!metaRes.ok) throw new Error(`media lookup failed: ${metaRes.status}`);
      const meta = (await metaRes.json()) as { url: string; mime_type: string };

      const fileRes = await fetch(meta.url, {
        headers: { Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}` },
      });
      if (!fileRes.ok) throw new Error(`media download failed: ${fileRes.status}`);

      const extension = meta.mime_type.split("/")[1]?.split(";")[0] ?? "bin";
      const filename = `${randomUUID()}.${extension}`;
      await mkdir(UPLOADS_DIR, { recursive: true });
      const buffer = Buffer.from(await fileRes.arrayBuffer());
      await writeFile(join(UPLOADS_DIR, filename), buffer);

      const publicUrl = process.env.API_PUBLIC_URL ?? `http://localhost:${process.env.API_PORT ?? 4000}`;
      return `${publicUrl}/uploads/${filename}`;
    } catch (err) {
      this.logger.error(`WhatsApp media download failed: ${(err as Error).message}`);
      return null;
    }
  }
}
