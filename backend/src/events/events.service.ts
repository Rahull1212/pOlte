import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { AddEventParticipantsDto, CreateEventDto, MarkAttendanceDto, UpdateEventRsvpDto } from "../shared-types";
import { PrismaService } from "../prisma/prisma.service";
import { AuthenticatedUser } from "../auth/types";
import { RegionsService } from "../regions/regions.service";
import { NotificationsService } from "../notifications/notifications.service";

type RegionNode = { id: string; name: string; type: string; parentId: string | null };

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

  /** UPCOMING / ONGOING / COMPLETED, purely time-derived — never stored, so it's always accurate as of "now". */
  private computeStatus(startAt: Date, endAt: Date | null): string {
    const now = new Date();
    const effectiveEnd = endAt ?? startAt;
    if (now < startAt) return "UPCOMING";
    if (now > effectiveEnd) return "COMPLETED";
    return "ONGOING";
  }

  /** Walks a region's parent chain to find its District/Constituency/Polling Station ancestors (or itself). */
  private resolveHierarchyLabels(regionId: string | null | undefined, regionById: Map<string, RegionNode>) {
    const labels: { district: string | null; constituency: string | null; booth: string | null } = {
      district: null,
      constituency: null,
      booth: null,
    };
    let current = regionId ? regionById.get(regionId) : undefined;
    while (current) {
      if (current.type === "DISTRICT") labels.district = current.name;
      else if (current.type === "CONSTITUENCY") labels.constituency = current.name;
      else if (current.type === "BOOTH") labels.booth = current.name;
      current = current.parentId ? regionById.get(current.parentId) : undefined;
    }
    return labels;
  }

  private async allRegionsById(): Promise<Map<string, RegionNode>> {
    const regions = await this.prisma.region.findMany({ select: { id: true, name: true, type: true, parentId: true } });
    return new Map(regions.map((r) => [r.id, r]));
  }

  async create(dto: CreateEventDto, user: AuthenticatedUser) {
    await this.assertWithinScope(user, dto.regionId);
    const event = await this.prisma.event.create({
      data: {
        name: dto.name,
        description: dto.description,
        objective: dto.objective,
        location: dto.location,
        organizer: dto.organizer,
        instructions: dto.instructions,
        remarks: dto.remarks,
        expectedAttendees: dto.expectedAttendees,
        attachmentUrls: dto.attachmentUrls,
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

  /** Main Events list: a clean row per event, region-scoped — no dashboard-level analytics here. */
  async listEvents(user: AuthenticatedUser, filters: { regionId?: string } = {}) {
    let where: { regionId?: string | { in: string[] } } | undefined;
    if (filters.regionId) {
      await this.assertWithinScope(user, filters.regionId);
      where = { regionId: filters.regionId };
    } else {
      const regionIds = user.role === "SUPER_ADMIN" ? undefined : await this.regionsService.descendantIds(user.regionId);
      where = regionIds ? { regionId: { in: regionIds } } : undefined;
    }

    const events = await this.prisma.event.findMany({
      where,
      include: { participants: { select: { attended: true } } },
      orderBy: { startAt: "desc" },
    });

    const regionById = await this.allRegionsById();

    return events.map((e) => {
      const labels = this.resolveHierarchyLabels(e.regionId, regionById);
      return {
        id: e.id,
        name: e.name,
        description: e.description,
        regionId: e.regionId,
        location: e.location,
        district: labels.district,
        startAt: e.startAt,
        endAt: e.endAt,
        status: this.computeStatus(e.startAt, e.endAt),
        invitedCount: e.participants.length,
        attendedCount: e.participants.filter((p) => p.attended).length,
        createdAt: e.createdAt,
      };
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

  /** Full detail for the Event Details page. */
  async getEventDetail(id: string) {
    const event = await this.prisma.event.findUnique({
      where: { id },
      include: {
        createdBy: { select: { name: true } },
        participants: {
          include: { user: { select: { id: true, name: true, region: { select: { name: true, type: true } } } } },
        },
      },
    });
    if (!event) throw new NotFoundException("Event not found");

    const regionById = await this.allRegionsById();
    const labels = this.resolveHierarchyLabels(event.regionId, regionById);

    return {
      id: event.id,
      name: event.name,
      startAt: event.startAt,
      endAt: event.endAt,
      location: event.location,
      objective: event.objective,
      description: event.description,
      organizer: event.organizer,
      district: labels.district,
      constituency: labels.constituency,
      pollingStation: labels.booth,
      expectedAttendees: event.expectedAttendees,
      assignedMembers: event.participants.map((p) => ({
        id: p.user.id,
        name: p.user.name,
        area: `${p.user.region.name} (${p.user.region.type})`,
        rsvpStatus: p.rsvpStatus,
        attended: p.attended,
        checkedInAt: p.checkedInAt,
      })),
      instructions: event.instructions,
      remarks: event.remarks,
      attachmentUrls: event.attachmentUrls,
      createdByName: event.createdBy.name,
      createdAt: event.createdAt,
      status: this.computeStatus(event.startAt, event.endAt),
    };
  }

  /**
   * The Event Dashboard: every KPI computed from this event's real
   * EventParticipant rows — invitations, RSVP responses, and check-ins —
   * scoped to exactly one event, never the whole org.
   */
  async getEventDashboard(id: string) {
    const event = await this.prisma.event.findUnique({
      where: { id },
      include: {
        participants: {
          include: {
            user: { select: { id: true, name: true, regionId: true, region: { select: { name: true, type: true } } } },
          },
        },
      },
    });
    if (!event) throw new NotFoundException("Event not found");

    const participants = event.participants;
    const totalInvited = participants.length;
    const confirmed = participants.filter((p) => p.rsvpStatus === "CONFIRMED").length;
    const declined = participants.filter((p) => p.rsvpStatus === "DECLINED").length;
    const noResponse = participants.filter((p) => p.rsvpStatus === "PENDING").length;
    const attended = participants.filter((p) => p.attended).length;
    const notAttended = totalInvited - attended;
    const checkedIn = participants.filter((p) => p.checkedInAt !== null).length;
    const pendingCheckIn = totalInvited - checkedIn;
    const lateArrivals = participants.filter((p) => p.checkedInAt && p.checkedInAt > event.startAt).length;
    const attendancePct = totalInvited > 0 ? Math.round((attended / totalInvited) * 100) : 0;

    const regionById = await this.allRegionsById();

    const districtMap = new Map<string, { invited: number; attended: number }>();
    const constituencyMap = new Map<string, { invited: number; attended: number }>();
    for (const p of participants) {
      const labels = this.resolveHierarchyLabels(p.user.regionId, regionById);
      const dKey = labels.district ?? "Unknown";
      const mKey = labels.constituency ?? "Unknown";
      const dEntry = districtMap.get(dKey) ?? { invited: 0, attended: 0 };
      dEntry.invited += 1;
      if (p.attended) dEntry.attended += 1;
      districtMap.set(dKey, dEntry);
      const mEntry = constituencyMap.get(mKey) ?? { invited: 0, attended: 0 };
      mEntry.invited += 1;
      if (p.attended) mEntry.attended += 1;
      constituencyMap.set(mKey, mEntry);
    }
    const districtWise = Array.from(districtMap.entries()).map(([district, v]) => ({
      district,
      invited: v.invited,
      attended: v.attended,
      attendancePct: v.invited > 0 ? Math.round((v.attended / v.invited) * 100) : 0,
    }));
    const constituencyWise = Array.from(constituencyMap.entries()).map(([constituency, v]) => ({
      constituency,
      invited: v.invited,
      attended: v.attended,
      attendancePct: v.invited > 0 ? Math.round((v.attended / v.invited) * 100) : 0,
    }));

    const memberWise = participants.map((p) => ({
      userId: p.user.id,
      name: p.user.name,
      area: `${p.user.region.name} (${p.user.region.type})`,
      rsvpStatus: p.rsvpStatus,
      attended: p.attended,
      checkedInAt: p.checkedInAt,
    }));

    const byDay = new Map<string, number>();
    for (const p of participants) {
      if (!p.checkedInAt) continue;
      const day = p.checkedInAt.toISOString().slice(0, 10);
      byDay.set(day, (byDay.get(day) ?? 0) + 1);
    }
    const attendanceTrend = Array.from(byDay.entries())
      .map(([date, count]) => ({ date, checkedIn: count }))
      .sort((a, b) => a.date.localeCompare(b.date));

    return {
      id: event.id,
      name: event.name,
      remarks: event.remarks,
      kpis: {
        totalInvited,
        confirmed,
        declined,
        noResponse,
        attended,
        notAttended,
        attendancePct,
        checkedIn,
        pendingCheckIn,
        lateArrivals,
      },
      districtWise,
      constituencyWise,
      memberWise,
      attendanceTrend,
    };
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

  /** Records a participant's RSVP response (Confirmed/Declined) ahead of the event. */
  async updateRsvp(eventId: string, dto: UpdateEventRsvpDto, user: AuthenticatedUser) {
    const event = await this.findById(eventId);
    const isSelf = dto.userId === user.id;
    if (!isSelf) {
      await this.assertWithinScope(user, event.regionId);
    }

    return this.prisma.eventParticipant.upsert({
      where: { eventId_userId: { eventId, userId: dto.userId } },
      create: { eventId, userId: dto.userId, rsvpStatus: dto.rsvpStatus },
      update: { rsvpStatus: dto.rsvpStatus },
    });
  }

  /** Attendance rollup for the legacy Event Reports widget. */
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
