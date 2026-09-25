// Normalized shape for an inbound Fyxo Connect webhook message. The
// documented contract (API.md §10-11) confirms the envelope every event
// arrives in — { event, sentAt, data: { messageId, waId, ... } } — and that
// a text reply's body lands at data.text (per §11's `/^accept/i.test(data.text)`
// example). It does NOT show a message.received payload carrying media
// (voice/photo), so the audio/image/document branches below stay a
// best-effort guess at common WhatsApp-BSP field spellings until a real
// media payload has been seen — tighten those once it has.
export interface FyxoInboundMessage {
  from: string;
  id: string;
  type: "text" | "button" | "audio" | "image" | "document" | string;
  text?: string;
  buttonId?: string;
  mediaUrl?: string;
  mediaId?: string;
  mimeType?: string;
  caption?: string;
}

export function extractInboundMessage(body: Record<string, any>): FyxoInboundMessage | null {
  const msg = body.data ?? body.message ?? body;
  // waId is the confirmed field name (§10/§11); the rest stay as fallbacks
  // in case a differently-shaped event ever reaches here.
  const from = msg.waId ?? msg.from ?? msg.sender ?? msg.contact?.phone ?? body.from;
  if (!from) return null;

  // A real message.received from a BUTTON TAP carries no message id at all —
  // confirmed against a live payload on 2026-09-15:
  //   { contactId, waId, text: "View Report", language, messageType: "button" }
  // Requiring one dropped every tap on the floor. Fall back to something
  // stable enough for logging and dedupe: the contact plus the event time.
  const id =
    msg.messageId ??
    msg.id ??
    body.messageId ??
    body.id ??
    `${msg.contactId ?? from}-${body.sentAt ?? Date.now()}`;

  const buttonReply = msg.button ?? msg.interactive?.button_reply ?? msg.buttonReply;
  const audio = msg.audio ?? msg.voice;
  const image = msg.image ?? msg.photo;
  const document = msg.document;

  // messageType is the confirmed field on a live payload; `type` is kept as a
  // fallback for any other shape.
  let type: FyxoInboundMessage["type"] = msg.messageType ?? msg.type ?? "text";
  if (buttonReply) type = "button";
  else if (audio) type = "audio";
  else if (image) type = "image";
  else if (document) type = "document";

  const media = audio ?? image ?? document;

  return {
    from: String(from),
    id: String(id),
    type,
    text: typeof msg.text === "string" ? msg.text : msg.text?.body,
    // For a template quick reply, the tapped button's LABEL arrives as
    // `text` and there is no separate button object — so the label is the
    // only identifier of which button was pressed.
    buttonId: buttonReply?.id ?? buttonReply?.payload ?? (type === "button" ? msg.text : undefined),
    // Flat fallbacks for the same reason as `caption` below: this API has
    // been observed putting fields at the top level rather than nested
    // under a type object. Without these a flat media payload records the
    // fact of a photo but loses the photo itself.
    mediaUrl: media?.url ?? media?.link ?? (typeof msg.mediaUrl === "string" ? msg.mediaUrl : undefined),
    mediaId: media?.id ?? media?.mediaId ?? (typeof msg.mediaId === "string" ? msg.mediaId : undefined),
    mimeType:
      media?.mimeType ?? media?.mime_type ?? (typeof msg.mimeType === "string" ? msg.mimeType : undefined),
    // Also read flat off the event body. The one live payload we have
    // confirmed (a button tap, 2026-09-15) put its text at the top level
    // rather than nested under a type object, so a caption may well arrive
    // the same way — reading both costs nothing and avoids silently losing
    // the only words attached to a photo.
    caption: image?.caption ?? document?.caption ?? (typeof msg.caption === "string" ? msg.caption : undefined),
  };
}

/**
 * Extracts the correlated message id, event name and failure reason from a
 * message.sent/delivered/read/failed event.
 *
 * Two documented shapes, both handled: API.md §10 nests the fields under
 * `data` ({ event, sentAt, data: { messageId, waId } }), while the partner
 * integration guide shows a failure arriving flat
 * ({ messageId, waMessageId, status, error }) with the event name in the
 * x-fyxo-event header. `data = body.data ?? body` covers both rather than
 * betting on one.
 *
 * `error` is Meta's own wording for a refusal ("Business eligibility payment
 * issue") and is carried through deliberately: the guide's checklist calls
 * for a failed send to surface it, because it usually names the fix. Without
 * it a record reads FAILED with no way to tell billing from a blocked number.
 */
export function extractStatusUpdate(
  body: Record<string, any>,
): { messageId: string; status: string; error?: string } | null {
  const data = body.data ?? body;
  const messageId = data.messageId ?? data.message_id ?? data.id ?? body.messageId ?? body.id;
  const status = body.event ?? body.status ?? data.status ?? data.event;
  if (!messageId || !status) return null;
  const error = data.error ?? body.error;
  return {
    messageId: String(messageId),
    status: String(status),
    error: typeof error === "string" && error.trim() ? error : undefined,
  };
}
