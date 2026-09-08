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
  const id = msg.messageId ?? msg.id ?? body.messageId ?? body.id;
  if (!from || !id) return null;

  const buttonReply = msg.button ?? msg.interactive?.button_reply ?? msg.buttonReply;
  const audio = msg.audio ?? msg.voice;
  const image = msg.image ?? msg.photo;
  const document = msg.document;

  let type: FyxoInboundMessage["type"] = msg.type ?? "text";
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
    buttonId: buttonReply?.id ?? buttonReply?.payload,
    mediaUrl: media?.url ?? media?.link,
    mediaId: media?.id ?? media?.mediaId,
    mimeType: media?.mimeType ?? media?.mime_type,
    caption: image?.caption ?? document?.caption ?? undefined,
  };
}

/**
 * Extracts the correlated message id + event name from a message.sent/
 * delivered/read/failed event. Confirmed shape (§10): the correlating id is
 * nested at data.messageId, and the event name is the top-level "event"
 * field passed straight through as the caller's own status vocabulary
 * (TasksService.handleFyxoStatusUpdate matches on "message.delivered" etc.
 * directly) — body.status/data.status are kept only as a fallback.
 */
export function extractStatusUpdate(body: Record<string, any>): { messageId: string; status: string } | null {
  const data = body.data ?? body;
  const messageId = data.messageId ?? data.message_id ?? data.id ?? body.messageId ?? body.id;
  const status = body.event ?? body.status ?? data.status ?? data.event;
  if (!messageId || !status) return null;
  return { messageId: String(messageId), status: String(status) };
}
