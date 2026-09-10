import { Injectable } from "@nestjs/common";
import { NotificationType } from "../shared-types";
import { PrismaService } from "../prisma/prisma.service";
import { WhatsAppApiService } from "../whatsapp-api/whatsapp-api.service";
import { FyxoWhatsAppService } from "../fyxo-whatsapp/fyxo-whatsapp.service";
import { GoogleSheetsService } from "../google-sheets/google-sheets.service";
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
}

// Extra columns/routing for the Google Sheet message log. Supplied by
// task-related callers (TasksService); a notification that isn't about a
// task simply omits it and logs with blank Task/Assigned By columns in the
// default tab.
export interface SheetMessageContext {
  taskName: string;
  // The Admin who allocated the task — accountable for this send.
  assignedByName: string;
  // The tab to log into: an Admin's name for a task that Admin created,
  // null for a Super-Admin-created task (the connected default tab).
  tab: string | null;
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
    private readonly googleSheets: GoogleSheetsService,
  ) {}

  async notify(input: {
    userId: string;
    type: NotificationType;
    title: string;
    message: string;
    relatedEntityType?: string;
    relatedEntityId?: string;
    fyxoTemplate?: FyxoTemplateSpec;
    sheetContext?: SheetMessageContext;
  }) {
    const { fyxoTemplate, sheetContext, ...notificationData } = input;
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
    const { fyxoTemplate, sheetContext, ...notificationData } = input;
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

  markRead(id: string) {
    return this.prisma.notification.update({ where: { id }, data: { isRead: true } });
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
      sheetContext?: SheetMessageContext;
    },
  ): Promise<WhatsAppPushOutcome | null> {
    const { title, message, fyxoTemplate, relatedEntityId, sheetContext } = input;
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, phone: true, role: true },
    });
    if (!user || user.role !== "CADRE") return null;

    if (fyxoTemplate && this.fyxoWhatsApp.isConfigured) {
      const idempotencyKey = `assignment-${relatedEntityId ?? user.id}-${fyxoTemplate.name}`;
      const variables = fyxoTemplate.variablesFor(user.name);
      const result = await this.fyxoWhatsApp.sendTemplateMessage({
        to: user.phone,
        templateName: fyxoTemplate.name,
        templateLanguage: fyxoTemplate.language,
        variables,
        idempotencyKey,
      });
      // The sheet logs what the Cadre actually reads on WhatsApp, so it
      // records the template rendered with this recipient's variables —
      // not the template name or the in-app notification wording, which
      // are different text entirely.
      await this.logToSheet(user.name, user.phone, renderFyxoBody(fyxoTemplate, variables), result.success, sheetContext);
      return { ...result, channel: "FYXO" };
    }

    const text = `*${title}*\n${message}\n\n(Reply MENU to open PoliOS)`;
    const result = await this.whatsAppApi.sendText(user.phone, text);
    await this.logToSheet(user.name, user.phone, text, result.success, sheetContext);
    return { ...result, channel: "META" };
  }

  /**
   * Mirrors an outbound Cadre WhatsApp message into the Google Sheet log.
   * Deliberately never throws: the sheet is a reporting side-channel, and a
   * Google API hiccup must not turn a successful WhatsApp send into a failed
   * request (GoogleSheetsService already swallows its own errors — this is
   * the belt-and-braces for anything it doesn't).
   */
  private async logToSheet(
    name: string,
    phone: string,
    message: string,
    success: boolean,
    sheetContext?: SheetMessageContext,
  ) {
    try {
      await this.googleSheets.appendTaskMessageRow({
        name,
        phone,
        message,
        taskName: sheetContext?.taskName,
        assignedByName: sheetContext?.assignedByName,
        tab: sheetContext?.tab,
        status: success ? "SENT" : "FAILED",
        sentAt: new Date(),
      });
    } catch {
      // already logged by GoogleSheetsService
    }
  }
}
