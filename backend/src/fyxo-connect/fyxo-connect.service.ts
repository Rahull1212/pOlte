import { Injectable, Logger } from "@nestjs/common";
import { randomUUID } from "node:crypto";

export interface FyxoRecipientPayload {
  phone: string;
  name?: string;
  message: string;
}

export interface FyxoSendResult {
  phone: string;
  success: boolean;
  providerMessageId?: string;
  error?: string;
}

/**
 * Thin wrapper around Fyxo Connect — the org's existing WhatsApp messaging
 * platform/API. PoliOS does NOT implement WhatsApp sending itself; this
 * service is the single integration seam a real Fyxo Connect API call goes
 * through. Everything upstream (Excel upload/validation, recipient
 * selection, the message composer, campaign persistence, the dashboard)
 * already works against this service's interface and needs no changes once
 * the real call is wired in below.
 *
 * ============================================================
 * INTEGRATION STATUS: NOT YET WIRED UP — no Fyxo Connect API documentation,
 * base URL, or credentials exist anywhere in this codebase. Rather than
 * guess an endpoint shape (path, auth header, payload field names) and risk
 * silently sending malformed requests, sendBulk() below degrades to a
 * logged simulation — the same "silently degrade when unconfigured"
 * pattern already used by WhatsAppApiService (Meta) and AiService (Claude)
 * elsewhere in this app. With FYXO_CONNECT_BASE_URL/FYXO_CONNECT_API_KEY
 * unset, every send is logged and reported back as a *simulated* success
 * (status SENT, a synthetic providerMessageId) so the rest of the feature —
 * campaign creation, the dashboard, recipient tracking — is fully usable
 * end-to-end without live credentials, exactly like the rest of the app.
 *
 * To wire up the real integration, exactly this is needed:
 *   1. FYXO_CONNECT_BASE_URL  — Fyxo Connect's API base URL
 *   2. FYXO_CONNECT_API_KEY   — the auth credential, and how it's sent
 *                               (Bearer header? custom header? query param?)
 *   3. The bulk-send endpoint: path, HTTP method, and exact request body
 *      shape (field names for phone / name / message / template / media /
 *      an external campaign reference)
 *   4. The response shape — does it return a message id per recipient
 *      synchronously, or only a batch/job id to poll?
 *   5. Rate limits / max recipients per call, so sendBulk() can batch
 *      correctly instead of guessing a batch size
 *   6. Whether WhatsApp template messages are required for
 *      business-initiated bulk sends (standard WhatsApp Business policy
 *      outside a 24h customer-service window), and if so how to list/
 *      reference Fyxo Connect's approved templates
 *   7. The delivery-status webhook contract Fyxo Connect will call back on
 *      — payload shape, the field that correlates back to
 *      providerMessageId, timestamp field(s) per status, and any signature
 *      header to verify the call really came from Fyxo Connect (see
 *      FyxoWebhookController, which is where that plugs in)
 *
 * Once those are confirmed, replace the body of sendBulk()'s "not
 * configured" branch with the real HTTP call(s).
 */
@Injectable()
export class FyxoConnectService {
  private readonly logger = new Logger(FyxoConnectService.name);

  get isConfigured(): boolean {
    return Boolean(process.env.FYXO_CONNECT_BASE_URL && process.env.FYXO_CONNECT_API_KEY);
  }

  async sendBulk(recipients: FyxoRecipientPayload[]): Promise<FyxoSendResult[]> {
    if (!this.isConfigured) {
      this.logger.warn(
        `[Fyxo Connect not configured — simulating] would send ${recipients.length} message(s). ` +
          `Set FYXO_CONNECT_BASE_URL and FYXO_CONNECT_API_KEY, and confirm the send-endpoint contract ` +
          `(see FyxoConnectService doc comment), to send for real.`,
      );
      for (const r of recipients) {
        this.logger.debug(`[Fyxo Connect simulated send] to ${r.phone}: ${r.message}`);
      }
      return recipients.map((r) => ({
        phone: r.phone,
        success: true,
        providerMessageId: `simulated-${randomUUID()}`,
      }));
    }

    // FYXO_CONNECT_BASE_URL/API_KEY are set, but the actual send-endpoint
    // contract (path, payload shape, response shape) has not been
    // confirmed — see the class-level doc comment for the exact list of
    // what's needed before this branch can make a real HTTP call.
    this.logger.error(
      "Fyxo Connect credentials are configured, but the send-endpoint contract has not been confirmed yet " +
        "— see FyxoConnectService's doc comment for exactly what's required before this can call the real API.",
    );
    return recipients.map((r) => ({
      phone: r.phone,
      success: false,
      error: "Fyxo Connect endpoint contract not yet confirmed",
    }));
  }
}
