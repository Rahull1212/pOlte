// Minimal shape of a WhatsApp Cloud API webhook delivery — only the fields
// this app actually reads. Full reference:
// https://developers.facebook.com/docs/whatsapp/cloud-api/webhooks/payload-examples

export interface WhatsAppInboundMessage {
  from: string; // sender's phone number, no "+" prefix
  id: string;
  timestamp: string;
  type: "text" | "image" | "audio" | "document" | "interactive" | string;
  text?: { body: string };
  image?: { id: string; mime_type: string; caption?: string };
  audio?: { id: string; mime_type: string };
  interactive?: {
    type: string;
    list_reply?: { id: string; title: string };
    button_reply?: { id: string; title: string };
  };
}

export interface WhatsAppWebhookBody {
  entry?: Array<{
    changes?: Array<{
      value?: {
        messaging_product?: string;
        messages?: WhatsAppInboundMessage[];
      };
    }>;
  }>;
}

export function extractMessages(body: WhatsAppWebhookBody): WhatsAppInboundMessage[] {
  const messages: WhatsAppInboundMessage[] = [];
  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      messages.push(...(change.value?.messages ?? []));
    }
  }
  return messages;
}
