import { Injectable } from "@nestjs/common";
import { NotificationType } from "../shared-types";
import { PrismaService } from "../prisma/prisma.service";
import { WhatsAppApiService } from "../whatsapp-api/whatsapp-api.service";
import { FyxoWhatsAppService } from "../fyxo-whatsapp/fyxo-whatsapp.service";

// Personalized per recipient (the Cadre's own name is always variables[0]),
// so notifyMany takes a function rather than a fixed array.
export interface FyxoTemplateSpec {
  name: string;
  language: string;
  variablesFor: (recipientName: string) => string[];
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
  ) {}

  async notify(input: {
    userId: string;
    type: NotificationType;
    title: string;
    message: string;
    relatedEntityType?: string;
    relatedEntityId?: string;
    fyxoTemplate?: FyxoTemplateSpec;
  }) {
    const { fyxoTemplate, ...notificationData } = input;
    const notification = await this.prisma.notification.create({ data: notificationData });
    await this.pushToWhatsApp(input.userId, input.title, input.message, fyxoTemplate, input.relatedEntityId);
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
    const { fyxoTemplate, ...notificationData } = input;
    await this.prisma.notification.createMany({
      data: userIds.map((userId) => ({ ...notificationData, userId })),
    });
    const results = await Promise.all(
      userIds.map(
        async (userId) =>
          [userId, await this.pushToWhatsApp(userId, input.title, input.message, fyxoTemplate, input.relatedEntityId)] as const,
      ),
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
    title: string,
    message: string,
    fyxoTemplate?: FyxoTemplateSpec,
    relatedEntityId?: string,
  ): Promise<WhatsAppPushOutcome | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, phone: true, role: true },
    });
    if (!user || user.role !== "CADRE") return null;

    if (fyxoTemplate && this.fyxoWhatsApp.isConfigured) {
      const idempotencyKey = `assignment-${relatedEntityId ?? user.id}-${fyxoTemplate.name}`;
      const result = await this.fyxoWhatsApp.sendTemplateMessage({
        to: user.phone,
        templateName: fyxoTemplate.name,
        templateLanguage: fyxoTemplate.language,
        variables: fyxoTemplate.variablesFor(user.name),
        idempotencyKey,
      });
      return { ...result, channel: "FYXO" };
    }

    const result = await this.whatsAppApi.sendText(user.phone, `*${title}*\n${message}\n\n(Reply MENU to open PoliOS)`);
    return { ...result, channel: "META" };
  }
}
