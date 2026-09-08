import { Injectable, Logger } from "@nestjs/common";
import { randomUUID } from "node:crypto";

export interface FyxoTemplateMessageInput {
  to: string;
  templateName: string;
  templateLanguage: string;
  variables: string[];
  idempotencyKey: string;
}

export interface FyxoTextMessageInput {
  to: string;
  body: string;
  idempotencyKey: string;
}

export interface FyxoSendResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

export interface FyxoMessageStatus {
  id: string;
  status: string;
  to?: string;
  raw: unknown;
}

/**
 * Real client for Fyxo Connect's documented messaging contract (confirmed
 * against the published API.md — see docs/fyxo-connect-api.md):
 *   POST {FYXO_BASE_URL}/v1/messages
 *   Authorization: Bearer <FYXO_API_KEY>
 *   Idempotency-Key: <deterministic-key>
 * Every response — success or failure — is wrapped in the documented
 * envelope: { success: true, data: {...} } or { success: false, error: {...} }.
 * sendTextMessage()'s "text" field name, and GET /v1/messages/:id's shape,
 * are both confirmed by the docs (§5, §9) — no longer guesses.
 *
 * Still NOT documented anywhere: how to download inbound media (voice/
 * photo) referenced by a webhook — §10's webhook payload only shows the
 * delivery-status shape, not a message.received media body. downloadMedia()
 * below stays best-effort until a real payload has been seen.
 *
 * Auth is the API key alone — the docs describe no separate "account id"
 * credential; `accountId` only ever appears as an optional field in the
 * send body to pick a non-default connected number, so it's not required
 * to consider Fyxo configured.
 *
 * Same "simulate when unconfigured" degrade pattern as WhatsAppApiService
 * (Meta) and FyxoConnectService (bulk messaging) — with no FYXO_API_KEY set,
 * every send is logged and reported back as a simulated success so the rest
 * of the agent layer (CadreAgent, deterministic buttons, dashboards) is
 * fully exercisable without live credentials.
 */
@Injectable()
export class FyxoWhatsAppService {
  private readonly logger = new Logger(FyxoWhatsAppService.name);

  get isConfigured(): boolean {
    return Boolean(process.env.FYXO_API_KEY);
  }

  private get baseUrl(): string {
    return process.env.FYXO_BASE_URL ?? "https://api.connect.fyxo.ai/api";
  }

  async sendTemplateMessage(input: FyxoTemplateMessageInput): Promise<FyxoSendResult> {
    return this.postMessage(
      {
        to: input.to,
        templateName: input.templateName,
        templateLanguage: input.templateLanguage,
        variables: input.variables,
      },
      input.idempotencyKey,
    );
  }

  // §5: "text" is the confirmed field name for a free-form send (only
  // deliverable inside the 24h reply window — see §6).
  async sendTextMessage(input: FyxoTextMessageInput): Promise<FyxoSendResult> {
    return this.postMessage({ to: input.to, text: input.body }, input.idempotencyKey);
  }

  // §9: GET /v1/messages/:id, response wrapped in the { success, data } envelope.
  async getMessage(messageId: string): Promise<FyxoMessageStatus | null> {
    if (!this.isConfigured) {
      this.logger.warn(`[Fyxo WhatsApp not configured] would fetch message ${messageId}`);
      return null;
    }
    try {
      const response = await fetch(`${this.baseUrl}/v1/messages/${messageId}`, {
        headers: { Authorization: `Bearer ${process.env.FYXO_API_KEY}` },
      });
      const parsed = (await response.json().catch(() => null)) as { success?: boolean; data?: Record<string, unknown> } | null;
      if (!response.ok || !parsed?.data) {
        this.logger.error(`Fyxo getMessage failed (${response.status}) for ${messageId}`);
        return null;
      }
      const data = parsed.data;
      return {
        id: String(data.id ?? messageId),
        status: String(data.status ?? "unknown"),
        to: typeof data.to === "string" ? data.to : undefined,
        raw: data,
      };
    } catch (err) {
      this.logger.error(`Fyxo getMessage threw: ${(err as Error).message}`);
      return null;
    }
  }

  // Best-effort: no media-fetch endpoint is documented. Tries the two most
  // common BSP shapes — a direct URL already present on the webhook payload,
  // or a media id that needs a follow-up GET — mirroring how
  // WhatsAppApiService.downloadMedia() handles Meta's two-step media fetch.
  async downloadMedia(mediaIdOrUrl: string): Promise<Buffer | null> {
    if (!this.isConfigured) {
      this.logger.warn(`[Fyxo WhatsApp not configured] would download media ${mediaIdOrUrl}`);
      return null;
    }
    try {
      const isDirectUrl = /^https?:\/\//i.test(mediaIdOrUrl);
      const url = isDirectUrl ? mediaIdOrUrl : `${this.baseUrl}/v1/media/${mediaIdOrUrl}`;
      const response = await fetch(url, { headers: { Authorization: `Bearer ${process.env.FYXO_API_KEY}` } });
      if (!response.ok) {
        this.logger.error(`Fyxo media download failed (${response.status}) for ${mediaIdOrUrl}`);
        return null;
      }
      return Buffer.from(await response.arrayBuffer());
    } catch (err) {
      this.logger.error(`Fyxo media download threw: ${(err as Error).message}`);
      return null;
    }
  }

  private async postMessage(payload: Record<string, unknown>, idempotencyKey: string): Promise<FyxoSendResult> {
    if (!this.isConfigured) {
      this.logger.warn(
        `[Fyxo WhatsApp not configured — simulating] would send ${JSON.stringify(payload)} (Idempotency-Key: ${idempotencyKey})`,
      );
      return { success: true, messageId: `simulated-${randomUUID()}` };
    }

    try {
      const response = await fetch(`${this.baseUrl}/v1/messages`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.FYXO_API_KEY}`,
          "Idempotency-Key": idempotencyKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });
      // §3: every response — success or failure — is wrapped in
      // { success, data } / { success: false, error: { code, message } }.
      const parsed = (await response.json().catch(() => null)) as
        | { success?: boolean; data?: { id?: string }; error?: { code?: string; message?: string } }
        | null;
      if (!response.ok || !parsed?.success) {
        const reason = parsed?.error?.message ?? `Fyxo API ${response.status}`;
        this.logger.error(`Fyxo send failed (${response.status}): ${reason}`);
        return { success: false, error: reason };
      }
      return { success: true, messageId: parsed.data?.id };
    } catch (err) {
      this.logger.error(`Fyxo send threw: ${(err as Error).message}`);
      return { success: false, error: (err as Error).message };
    }
  }
}
