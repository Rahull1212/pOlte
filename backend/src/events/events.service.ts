import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { AddEventParticipantsDto, CreateEventDto, MarkAttendanceDto } from "../shared-types";
import { PrismaService } from "../prisma/prisma.service";
import { AuthenticatedUser } from "../auth/types";
import { RegionsService } from "../regions/regions.service";
import { NotificationsService } from "../notifications/notifications.service";

@Injectable()
export class EventsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly regionsService: RegionsService,
    private readonly notificationsService: NotificationsService,
  ) {}

  private async assertWithinScope(user: AuthenticatedUser, regionId: string) {
    if (user.role === "SUPER_ADMIN") return;
    const withinScope = await this.regionsService.isWithinScope(user.regionId, regionId);
    if (!withinScope) throw new ForbiddenException("Region is outside your area");
  }

  async create(dto: CreateEventDto, user: AuthenticatedUser) {
    await this.assertWithinScope(user, dto.regionId);
    const event = await this.prisma.event.create({
      data: {
        name: dto.name,
        description: dto.description,
        regionId: dto.regionId,
        startAt: dto.startAt,
        endAt: dto.endAt,
        createdById: user.id,
      },
    });

    // Everyone under this region hears about it, not just people explicitly
    // added via addParticipants() later — that call is for a formal
    // invite/attendance list, this is the area-wide "heads up" broadcast.
    const regionIds = await this.regionsService.descendantIds(dto.regionId);
    const cadres = await this.prisma.user.findMany({
      where: { regionId: { in: regionIds }, role: "CADRE", isActive: true },
      select: { id: true },
    });
    if (cadres.length > 0) {
      await this.notificationsService.notifyMany(
        cadres.map((c) => c.id),
        {
          type: "EVENT_INVITATION",
          title: `New event: ${event.name}`,
          message: `Happening ${new Date(event.startAt).toDateString()} in your area.`,
          relatedEntityType: "Event",
          relatedEntityId: event.id,
        },
      );
    }

    return event;
  }

  async findMany(user: AuthenticatedUser, filters: { regionId?: string } = {}) {
    if (filters.regionId) {
      await this.assertWithinScope(user, filters.regionId);
      return this.prisma.event.findMany({ where: { regionId: filters.regionId }, orderBy: { startAt: "desc" } });
    }

    const regionIds =
      user.role === "SUPER_ADMIN" ? undefined : await this.regionsService.descendantIds(user.regionId);

    return this.prisma.event.findMany({
      where: regionIds ? { regionId: { in: regionIds } } : undefined,
      orderBy: { startAt: "desc" },
    });
  }

  async findById(id: string) {
    const event = await this.prisma.event.findUnique({
      where: { id },
      include: { participants: { include: { user: { select: { id: true, name: true, role: true } } } } },
    });
    if (!event) throw new NotFoundException("Event not found");
    return event;
  }

  async addParticipants(eventId: string, dto: AddEventParticipantsDto, user: AuthenticatedUser) {
    const event = await this.findById(eventId);
    await this.assertWithinScope(user, event.regionId);

    await this.prisma.eventParticipant.createMany({
      data: dto.userIds.map((userId) => ({ eventId, userId })),
      skipDuplicates: true,
    });

    await this.notificationsService.notifyMany(dto.userIds, {
      type: "EVENT_INVITATION",
      title: "Event invitation",
      message: `You've been added to "${event.name}"`,
      relatedEntityType: "Event",
      relatedEntityId: eventId,
    });

    return this.findById(eventId);
  }

  async markAttendance(eventId: string, dto: MarkAttendanceDto, user: AuthenticatedUser) {
    const event = await this.findById(eventId);
    const isSelfCheckIn = dto.userId === user.id;
    if (!isSelfCheckIn) {
      await this.assertWithinScope(user, event.regionId);
    }

    // upsert, not update: self-check-in (e.g. via the WhatsApp flow) commonly
    // happens for a cadre who was never formally added as a participant —
    // "I saw the event and I'm marking myself attending" should still work.
    return this.prisma.eventParticipant.upsert({
      where: { eventId_userId: { eventId, userId: dto.userId } },
      create: {
        eventId,
        userId: dto.userId,
        attended: dto.attended,
        checkedInAt: dto.attended ? new Date() : null,
      },
      update: { attended: dto.attended, checkedInAt: dto.attended ? new Date() : null },
    });
  }

  /** Attendance rollup for the Event Reports feature. */
  async attendanceReport(eventId: string) {
    const event = await this.findById(eventId);
    const total = event.participants.length;
    const attended = event.participants.filter((p) => p.attended).length;
    return {
      eventId,
      eventName: event.name,
      totalInvited: total,
      totalAttended: attended,
      attendanceRate: total > 0 ? Math.round((attended / total) * 100) : 0,
      participants: event.participants,
    };
  }
}
