import { Injectable } from "@nestjs/common";
import { CreateAnnouncementDto } from "../shared-types";
import { PrismaService } from "../prisma/prisma.service";
import { AuthenticatedUser } from "../auth/types";

@Injectable()
export class CommunicationService {
  constructor(private readonly prisma: PrismaService) {}

  async createAnnouncement(dto: CreateAnnouncementDto, user: AuthenticatedUser) {
    const announcement = await this.prisma.announcement.create({
      data: {
        campaignId: dto.campaignId,
        senderId: user.id,
        targetLevels: dto.targetLevels,
        targetRegionIds: dto.targetRegionIds,
        messageType: dto.messageType,
        content: dto.content,
        mediaUrl: dto.mediaUrl,
      },
    });

    // Fan-out to matching recipients is done asynchronously by a queue worker
    // (see src/queue) so this request returns immediately regardless of
    // audience size.
    return announcement;
  }

  findByCampaign(campaignId: string) {
    return this.prisma.announcement.findMany({
      where: { campaignId },
      orderBy: { createdAt: "desc" },
    });
  }
}
