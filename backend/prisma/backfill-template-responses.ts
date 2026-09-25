import { PrismaClient } from "@prisma/client";
import { extractInboundMessage } from "../src/fyxo-agent/fyxo-inbound.types";
import { phoneMatchFilter } from "../src/fyxo-whatsapp/phone.util";
import { TEMPLATE_BUTTON_ACTIONS } from "../src/fyxo-whatsapp/templates";

const prisma = new PrismaClient();

/**
 * How close two records must be, in time, to be treated as the same
 * response. Ten seconds: comfortably wider than the gap between a live
 * write and its webhook receipt, far narrower than a person tapping the
 * same button twice on purpose.
 */
const DEDUP_WINDOW_MS = 10_000;

/**
 * Recovers inbound responses that arrived before they were being recorded.
 *
 * Only button taps were stored at first, and even those only after the
 * label/dedup fixes. Everything else — typed replies, voice notes, photos —
 * was answered and forgotten. But FyxoWebhookEvent kept the raw JSON of
 * every delivery, so the history is recoverable rather than lost.
 *
 * Idempotent: a response already recorded for the same person, action and
 * timestamp is skipped, so re-running adds nothing.
 *
 *   npx ts-node prisma/backfill-template-responses.ts
 */
async function main() {
  const events = await prisma.fyxoWebhookEvent.findMany({
    where: { eventType: "message.received" },
    orderBy: { receivedAt: "asc" },
  });
  console.log(`Scanning ${events.length} stored message.received event(s)…`);

  let created = 0;
  let skipped = 0;
  let unmatched = 0;

  for (const event of events) {
    const body = event.rawBody as Record<string, unknown> | null;
    if (!body) continue;

    const msg = extractInboundMessage(body);
    if (!msg) continue;

    // Same phone matching the live router uses: Fyxo sends E.164 digits,
    // PoliOS stores the national form.
    const cadre = await prisma.user.findFirst({
      where: phoneMatchFilter(msg.from),
      select: { id: true, name: true },
    });
    if (!cadre) {
      unmatched += 1;
      continue;
    }

    const { responseType, action, label, rawPayload } = classify(msg);

    // The event's own receive time is the truth here — "now" would stamp a
    // month of history with today's date and wreck any time-based analysis.
    const respondedAt = event.receivedAt;

    // Matched on a window, not an exact timestamp: a row written live
    // stamps its own now(), which differs from the webhook's receivedAt by
    // milliseconds. Exact equality therefore never matched and re-running
    // duplicated everything it had already recovered.
    const existing = await prisma.templateResponse.findFirst({
      where: {
        cadreId: cadre.id,
        action,
        respondedAt: {
          gte: new Date(respondedAt.getTime() - DEDUP_WINDOW_MS),
          lte: new Date(respondedAt.getTime() + DEDUP_WINDOW_MS),
        },
      },
      select: { id: true },
    });
    if (existing) {
      skipped += 1;
      continue;
    }

    // Attribute to whatever task message that Cadre had most recently been
    // sent at the time — the same best-effort rule the live path uses.
    const priorMessage = await prisma.taskMessageLog.findFirst({
      where: { cadreId: cadre.id, taskId: { not: null }, sentAt: { lte: respondedAt } },
      orderBy: { sentAt: "desc" },
      select: { id: true, taskId: true },
    });

    await prisma.templateResponse.create({
      data: {
        messageLogId: priorMessage?.id,
        taskId: priorMessage?.taskId ?? undefined,
        cadreId: cadre.id,
        cadreName: cadre.name,
        cadrePhone: msg.from,
        responseType,
        action,
        label,
        rawPayload,
        respondedAt,
      },
    });
    created += 1;
  }

  console.log(`Recovered ${created} response(s); ${skipped} already recorded; ${unmatched} from unknown numbers.`);
}

/** Mirrors ConversationRouterService.recordInbound so both agree. */
function classify(msg: ReturnType<typeof extractInboundMessage> & object) {
  const text = msg.text?.trim();

  if (msg.type === "button") {
    const payload = msg.buttonId ?? text ?? "";
    const [prefix, taskId] = payload.split(":");
    // A payload-carrying tap names its own action; a bare label is matched
    // back to one, exactly as the live path does.
    const action = taskId
      ? prefix
      : (TEMPLATE_BUTTON_ACTIONS.find((b) => b.label.toLowerCase() === payload.trim().toLowerCase())
          ?.action ?? "QUICK_REPLY");
    return { responseType: "BUTTON" as const, action, label: payload || null, rawPayload: payload || null };
  }
  if (msg.type === "audio") {
    return {
      responseType: "MEDIA" as const,
      action: "VOICE_NOTE",
      label: null,
      rawPayload: msg.mediaUrl ?? msg.mediaId ?? null,
    };
  }
  if (msg.type === "image" || msg.type === "document") {
    return {
      responseType: "MEDIA" as const,
      action: msg.type === "image" ? "PHOTO" : "DOCUMENT",
      label: msg.caption ?? null,
      rawPayload: msg.mediaUrl ?? msg.mediaId ?? null,
    };
  }
  if (text) {
    return { responseType: "TEXT" as const, action: "REPLY", label: text, rawPayload: text };
  }
  return {
    responseType: "TEXT" as const,
    action: "UNKNOWN",
    label: null,
    rawPayload: JSON.stringify(msg).slice(0, 2000),
  };
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
