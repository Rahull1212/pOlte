import { Injectable } from "@nestjs/common";
import { NotificationType } from "../shared-types";
import { PrismaService } from "../prisma/prisma.service";
import { WhatsAppApiService } from "../whatsapp-api/whatsapp-api.service";

@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly whatsAppApi: WhatsAppApiService,
  ) {}

  async notify(input: {
    userId: string;
    type: NotificationType;
    title: string;
    message: string;
    relatedEntityType?: string;
    relatedEntityId?: string;
  }) {
    const notification = await this.prisma.notification.create({ data: input });
    await this.pushToWhatsApp(input.userId, input.title, input.message);
    return notification;
  }

  async notifyMany(
    userIds: string[],
    input: Omit<Parameters<NotificationsService["notify"]>[0], "userId">,
  ) {
    const result = await this.prisma.notification.createMany({
      data: userIds.map((userId) => ({ ...input, userId })),
    });
    await Promise.all(userIds.map((userId) => this.pushToWhatsApp(userId, input.title, input.message)));
    return result;
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
   * the web portal to see their notification bell.
   */
  private async pushToWhatsApp(userId: string, title: string, message: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { phone: true, role: true },
    });
    if (!user || user.role !== "CADRE") return;
    await this.whatsAppApi.sendText(user.phone, `*${title}*\n${message}\n\n(Reply MENU to open PoliOS)`);
  }
}
