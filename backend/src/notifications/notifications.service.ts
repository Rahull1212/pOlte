import { Injectable, NotFoundException } from "@nestjs/common";
import { NotificationType } from "../shared-types";
import { PrismaService } from "../prisma/prisma.service";
import { WhatsAppApiService } from "../whatsapp-api/whatsapp-api.service";
import { FyxoWhatsAppService } from "../fyxo-whatsapp/fyxo-whatsapp.service";
import { MessageLogService } from "../message-log/message-log.service";
import { renderFyxoBody } from "../fyxo-whatsapp/templates";

// Personalized per recipient (the Cadre's own name is always variables[0]),
// so notifyMany takes a function rather than a fixed array.
export interface FyxoTemplateSpec {
  name: string;
  language: string;
  // Optional — only the templates with real approved (or submitted) copy
  // carry this (see FYXO_TEMPLATES); used to log a human-readable
  // rendering of what was actually sent, not to build the API request.
  body?: string;
  variablesFor: (recipientName: string) => string[];
  /**
   * Per-recipient quick-reply button payloads (API.md §5), keyed by user id
   * because the payload is that Cadre's own Task id — it's what comes back
   * as `reference` when they tap, and the only thing that makes a tap
   * unambiguous for a Cadre holding several tasks. Omitted for sends with no
   * buttons worth identifying.
   */
  buttonPayloadsFor?: (recipientUserId: string) => (string | null)[] | undefined;
}

// Which task a message belongs to, for the message log. Supplied by
// task-related callers (TasksService); a notification that isn't about a
// task omits it and is logged with blank Task/Assigned By columns.
export interface MessageContext {
  taskName: string;
  // The Admin who allocated the task — accountable for this send.
  assignedByName: string;
  assignedById?: string;
  /**
   * Which Task row this send belongs to, per recipient.
   *
   * A function rather than a value because one allocation notifies many
   * Cadres and each has their OWN Task row — the same reason
   * buttonPayloadsFor is per-recipient. Without this the message log stored
   * only a task NAME, so an inbound button tap had no task to attach to and
   * the response dashboard could never link a reply to the work it was
   * about.
   */
  taskIdFor?: (recipientUserId: string) => string | undefined;
}

export interface WhatsAppPushOutcome {
  success: boolean;
  messageId?: string;
  // Which provider actually carried this send — callers that persist a
  // message id (e.g. TasksService.allocateToCadres) need this to know
  // whether to store it as whatsappMessageId (Meta) or fyxoMessageId (Fyxo),
  // since a delivery-status webhook only ever correlates within one channel.
  channel: "META" | "FYXO";
}

@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly whatsAppApi: WhatsAppApiService,
    private readonly fyxoWhatsApp: FyxoWhatsAppService,
    private readonly messageLog: MessageLogService,
  ) {}

  async notify(input: {
    userId: string;
    type: NotificationType;
    title: string;
    message: string;
    relatedEntityType?: string;
    relatedEntityId?: string;
    fyxoTemplate?: FyxoTemplateSpec;
    messageContext?: MessageContext;
  }) {
    const { fyxoTemplate, messageContext, ...notificationData } = input;
    const notification = await this.prisma.notification.create({ data: notificationData });
    await this.pushToWhatsApp(input.userId, input);
    return notification;
  }

  /**
   * Returns each recipient's WhatsApp outcome (success/messageId, or absent
   * entirely when nothing was attempted because they're not a Cadre) —
   * callers that need to persist per-recipient delivery status
   * (TasksService.allocateToCadres) read this instead of firing-and-
   * forgetting blind.
   */
  async notifyMany(
    userIds: string[],
    input: Omit<Parameters<NotificationsService["notify"]>[0], "userId">,
  ): Promise<Map<string, WhatsAppPushOutcome>> {
    const { fyxoTemplate, messageContext, ...notificationData } = input;
    await this.prisma.notification.createMany({
      data: userIds.map((userId) => ({ ...notificationData, userId })),
    });
    const results = await Promise.all(
      userIds.map(async (userId) => [userId, await this.pushToWhatsApp(userId, input)] as const),
    );
    return new Map(results.filter((r): r is [string, WhatsAppPushOutcome] => r[1] !== null));
  }

  findForUser(userId: string) {
    return this.prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
  }

  /**
   * Scoped to the owner: `id` alone let any authenticated user mark any
   * other user's notification read. updateMany with both keys means a
   * mismatched pair simply matches nothing, rather than needing a separate
   * read to check ownership.
   */
  async markRead(id: string, userId: string) {
    const { count } = await this.prisma.notification.updateMany({
      where: { id, userId },
      data: { isRead: true },
    });
    if (count === 0) throw new NotFoundException("Notification not found");
    return { id, isRead: true };
  }

  /**
   * Every in-app notification is mirrored to WhatsApp for Cadres, since per
   * this build's scope Cadres work entirely from WhatsApp and may never open
   * the web portal to see their notification bell. Returns null when
   * nothing was attempted (not a Cadre), else the send's success/failure.
   *
   * When a caller supplies a fyxoTemplate AND Fyxo Connect is configured,
   * this sends the real interactive template (with Accept/Decline/View
   * Details buttons) via Fyxo INSTEAD of the plain Meta text — the one seam
   * where the new agent-driven flow (Fyxo) takes over from the existing
   * Meta-based notification path, scoped to exactly the notification types
   * that pass a template (today, only TASK_ASSIGNED). With no fyxoTemplate,
   * or Fyxo unconfigured, behavior is byte-for-byte what it was before this
   * agent layer existed.
   */
  private async pushToWhatsApp(
    userId: string,
    input: {
      title: string;
      message: string;
      fyxoTemplate?: FyxoTemplateSpec;
      relatedEntityId?: string;
      messageContext?: MessageContext;
    },
  ): Promise<WhatsAppPushOutcome | null> {
    const { title, message, fyxoTemplate, relatedEntityId, messageContext } = input;
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, phone: true, role: true },
    });
    if (!user || user.role !== "CADRE") return null;

    if (fyxoTemplate && this.fyxoWhatsApp.isConfigured) {
      // Must be unique PER RECIPIENT and stable across retries (§5). Keyed
      // only on the batch before, it was identical for every Cadre in one
      // allocation — Fyxo answered the concurrent duplicates with
      // 409 "already in progress", and would have treated them as one
      // message. The recipient's id makes it unique; deriving it from stored
      // ids (not a random UUID) keeps a genuine retry deduplicating.
      const idempotencyKey = `assignment-${relatedEntityId ?? "adhoc"}-${user.id}`;
      const variables = fyxoTemplate.variablesFor(user.name);
      const result = await this.fyxoWhatsApp.sendTemplateMessage({
        to: user.phone,
        templateName: fyxoTemplate.name,
        templateLanguage: fyxoTemplate.language,
        variables,
        buttonPayloads: fyxoTemplate.buttonPayloadsFor?.(user.id),
        idempotencyKey,
      });
      // The log records what the Cadre actually reads on WhatsApp — the
      // template rendered with this recipient's variables, not the template
      // name or the in-app notification wording, which are different text.
      await this.log(user, renderFyxoBody(fyxoTemplate, variables), result, "FYXO", messageContext, fyxoTemplate.name, variables);
      return { ...result, channel: "FYXO" };
    }

    const text = `*${title}*\n${message}\n\n(Reply MENU to open PoliOS)`;
    const result = await this.whatsAppApi.sendText(user.phone, text);
    await this.log(user, text, result, "META", messageContext);
    return { ...result, channel: "META" };
  }

  /**
   * Records an outbound Cadre message in the database log. Never throws:
   * logging must not turn a WhatsApp message that actually reached a Cadre
   * into a failed request. A send with no messageContext is a plain
   * notification rather than a task assignment, and is logged as such.
   */
  private async log(
    user: { id: string; name: string; phone: string },
    message: string,
    result: { success: boolean; messageId?: string },
    channel: "FYXO" | "META",
    messageContext?: MessageContext,
    templateName?: string,
    // Recorded so a Resend from the Message Log repeats this exact message.
    variables?: string[],
  ) {
    try {
      await this.messageLog.record({
        cadreId: user.id,
        cadreName: user.name,
        cadrePhone: user.phone,
        message,
        // Resolved per recipient: this Cadre's own Task row.
        taskId: messageContext?.taskIdFor?.(user.id),
        taskName: messageContext?.taskName,
        assignedById: messageContext?.assignedById,
        assignedByName: messageContext?.assignedByName,
        kind: messageContext ? "ASSIGNMENT" : "NOTIFICATION",
        templateName,
        variables,
        channel,
        success: result.success,
        providerMessageId: result.messageId,
      });
    } catch {
      // already logged by MessageLogService
    }
  }
}
