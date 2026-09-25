import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { CampaignStatus, CreateCampaignDto, UpdateCampaignDto } from "../shared-types";
import { PrismaService } from "../prisma/prisma.service";
import { AuthenticatedUser } from "../auth/types";
import { NotificationsService } from "../notifications/notifications.service";
import { RegionsService } from "../regions/regions.service";

@Injectable()
export class CampaignsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
    private readonly regions: RegionsService,
  ) {}

  /**
   * Created by a Super Admin only (see CampaignsController). A campaign is
   * handed down: the Super Admin defines it and names the Admins, each of
   * whom accepts or declines it and then allocates its work to their own
   * Cadres.
   */
  async create(dto: CreateCampaignDto, user: AuthenticatedUser) {
    const adminIds = await this.resolveAdminIds(dto.adminIds ?? [], user, dto.regionIds ?? []);

    return this.prisma.campaign.create({
      data: {
        assignedAdmins: { create: adminIds.map((adminId) => ({ adminId })) },
        name: dto.name,
        description: dto.description,
        objective: dto.objective,
        category: dto.category,
        startDate: dto.startDate,
        endDate: dto.endDate,
        priority: dto.priority,
        bannerUrl: dto.bannerUrl,
        totalTarget: dto.totalTarget,
        totalBudget: dto.totalBudget,
        expectedVolunteers: dto.expectedVolunteers,
        requiredDocuments: dto.requiredDocuments,
        status: statusForDates(dto.startDate, dto.endDate),
        createdById: user.id,
      },
      include: { assignedAdmins: { include: { admin: { select: { id: true, name: true } } } } },
    });
  }

  /**
   * Validates the chosen Admins and guarantees the creator's own stake.
   *
   * Every id must belong to an active ADMIN — passing a Cadre's or a Super
   * Admin's id would create a row that no permission check ever honours, so
   * it's rejected loudly instead.
   */
  private async resolveAdminIds(
    requested: string[],
    user: AuthenticatedUser,
    regionIds: string[] = [],
  ): Promise<string[]> {
    const ids = new Set(requested);

    // Areas are the usual way in: whoever covers them is assigned. Resolved
    // at creation rather than stored as a rule, so a campaign's Admins stay
    // fixed even if someone is later moved to a different area — being
    // reassigned shouldn't silently drop you from work you already accepted.
    if (regionIds.length > 0) {
      for (const admin of await this.regions.adminsCovering(regionIds)) ids.add(admin.id);
    }

    // Kept as a safety net rather than live behaviour: creation is now
    // Super-Admin-only, so this branch shouldn't be reachable. If that ever
    // changes, an Admin who creates a campaign is still automatically one
    // of its responsible Admins rather than able to file work for others
    // and walk away.
    if (user.role === "ADMIN") ids.add(user.id);
    if (ids.size === 0) return [];

    const found = await this.prisma.user.findMany({
      where: { id: { in: [...ids] }, role: "ADMIN", isActive: true },
      select: { id: true },
    });
    if (found.length !== ids.size) {
      const valid = new Set(found.map((f) => f.id));
      const bad = [...ids].filter((id) => !valid.has(id));
      throw new BadRequestException(`Not an active Admin: ${bad.join(", ")}`);
    }
    return found.map((f) => f.id);
  }

  /**
   * Who may see a campaign at all, as a reusable `where` fragment.
   *
   * A Super Admin sees everything. Anyone else sees a campaign they created,
   * one they're an assigned Admin of, or one they are actually working —
   * that last clause matters: a Cadre allocated a task under a campaign, or
   * an Admin whose area is running its tasks, has to be able to open it.
   * Without it a Cadre could hold a task whose campaign 404s for them.
   */
  private visibilityFilter(user: AuthenticatedUser) {
    if (user.role === "SUPER_ADMIN") return {};
    const worksOnIt =
      user.role === "CADRE"
        ? { tasks: { some: { assignedToId: user.id } } }
        : { tasks: { some: { OR: [{ assignedById: user.id }, { assignedTo: { parentUserId: user.id } }] } } };

    return {
      OR: [{ createdById: user.id }, { assignedAdmins: { some: { adminId: user.id } } }, worksOnIt],
    };
  }

  /**
   * A Super Admin sees every campaign; everyone else sees the ones they
   * created, run, or are working on. Previously every campaign — including
   * budgets — was visible to anyone who asked.
   */
  findAll(filters: { status?: CampaignStatus; priority?: string }, user: AuthenticatedUser) {
    return this.prisma.campaign.findMany({
      where: {
        status: filters.status,
        priority: filters.priority as any,
        ...this.visibilityFilter(user),
      },
      include: { assignedAdmins: { include: { admin: { select: { id: true, name: true } } } } },
      orderBy: { createdAt: "desc" },
    });
  }

  async findById(id: string, user: AuthenticatedUser) {
    // The same visibility rule the list uses, applied as a filter rather
    // than re-derived in code below — the "is someone working on it" clause
    // needs a query, and two hand-written copies of this rule would drift.
    const campaign = await this.prisma.campaign.findFirst({
      where: { id, ...this.visibilityFilter(user) },
      include: {
        attachments: true,
        allocations: { where: { parentAllocationId: null } },
        assignedAdmins: { include: { admin: { select: { id: true, name: true } } } },
        // Shown in the Campaign Details header ("Created By"), and used by
        // CampaignDetailService for the first entry of the activity timeline.
        createdBy: { select: { id: true, name: true, role: true } },
        _count: { select: { tasks: true, expenses: true } },
      },
    });
    // 404 rather than 403 for a campaign outside the caller's remit: a 403
    // would confirm the id exists and turn this route into an enumerator.
    if (!campaign) throw new NotFoundException("Campaign not found");
    return campaign;
  }

  /**
   * An Admin's answer to being handed a campaign.
   *
   * Only the Admin themselves can answer, and only for their own
   * assignment — a Super Admin accepting on an Admin's behalf would defeat
   * the point of asking. Accepting is what unlocks allocating the
   * campaign's tasks to that Admin's Cadres (see TasksService).
   */
  async respondToAssignment(
    campaignId: string,
    dto: { status: "ACCEPTED" | "DECLINED"; note?: string },
    user: AuthenticatedUser,
  ) {
    if (user.role !== "ADMIN") {
      throw new ForbiddenException(
        "Only the Admin a campaign was assigned to can accept or decline it",
      );
    }

    const assignment = await this.prisma.campaignAdmin.findUnique({
      where: { campaignId_adminId: { campaignId, adminId: user.id } },
      include: { campaign: { select: { name: true, createdById: true } } },
    });
    // 404, not 403: an Admin who was never assigned shouldn't be able to
    // tell an existing campaign from a made-up id.
    if (!assignment) throw new NotFoundException("Campaign not found");

    // Answering again would quietly rewrite a decision the Super Admin has
    // already acted on. Reassigning is how a decline gets reversed.
    if (assignment.status !== "PENDING") {
      throw new BadRequestException(
        `You have already ${assignment.status === "ACCEPTED" ? "accepted" : "declined"} this campaign`,
      );
    }

    const updated = await this.prisma.campaignAdmin.update({
      where: { campaignId_adminId: { campaignId, adminId: user.id } },
      data: { status: dto.status, respondedAt: new Date(), responseNote: dto.note },
      include: { admin: { select: { id: true, name: true } } },
    });

    // The Super Admin handed this over and is waiting on an answer — a
    // decline nobody is told about is a campaign that silently stalls.
    await this.notificationsService.notify({
      userId: assignment.campaign.createdById,
      type: "NEW_CAMPAIGN",
      title: dto.status === "ACCEPTED" ? "Campaign accepted" : "Campaign declined",
      message:
        `${user.name} ${dto.status === "ACCEPTED" ? "accepted" : "declined"} "${assignment.campaign.name}"` +
        (dto.note ? ` — ${dto.note}` : ""),
      relatedEntityType: "Campaign",
      relatedEntityId: campaignId,
    });

    return updated;
  }

  /** Every campaign waiting on this Admin's answer. */
  async pendingAssignments(user: AuthenticatedUser) {
    if (user.role !== "ADMIN") return [];
    const rows = await this.prisma.campaignAdmin.findMany({
      where: { adminId: user.id, status: "PENDING" },
      include: {
        campaign: {
          select: {
            id: true,
            name: true,
            description: true,
            startDate: true,
            endDate: true,
            priority: true,
            totalTarget: true,
            createdBy: { select: { name: true } },
          },
        },
      },
      orderBy: { assignedAt: "desc" },
    });
    return rows.map((r) => ({ ...r.campaign, assignedAt: r.assignedAt }));
  }

  /**
   * Viewing a campaign and changing it are different rights. Anyone working
   * a campaign's tasks can now open it (see visibilityFilter), but editing
   * its dates, target and budget stays with the people who own it — the
   * Super Admin, its creator, or one of its assigned Admins.
   */
  private async assertCanEdit(id: string, user: AuthenticatedUser) {
    const campaign = await this.findById(id, user);
    if (user.role === "SUPER_ADMIN") return campaign;

    const owns =
      campaign.createdById === user.id || campaign.assignedAdmins.some((a) => a.adminId === user.id);
    if (!owns) {
      throw new ForbiddenException("Only this campaign's own Admins can change it");
    }
    return campaign;
  }

  async update(id: string, dto: UpdateCampaignDto, user: AuthenticatedUser) {
    await this.assertCanEdit(id, user);
    // Both are assignment inputs, not Campaign columns — they must not
    // reach prisma.update(), which would reject them as unknown fields.
    const { adminIds, regionIds, ...rest } = dto as UpdateCampaignDto & {
      adminIds?: string[];
      regionIds?: string[];
    };

    if (adminIds || regionIds) {
      // Replace the whole set — the UI sends the full selection, so a missing
      // id means "removed", not "left alone".
      const resolved = await this.resolveAdminIds(adminIds ?? [], user, regionIds ?? []);
      await this.prisma.$transaction([
        this.prisma.campaignAdmin.deleteMany({ where: { campaignId: id } }),
        this.prisma.campaignAdmin.createMany({
          data: resolved.map((adminId) => ({ campaignId: id, adminId })),
        }),
      ]);
    }

    return this.prisma.campaign.update({
      where: { id },
      data: rest as any,
      include: { assignedAdmins: { include: { admin: { select: { id: true, name: true } } } } },
    });
  }

  async setStatus(id: string, status: CampaignStatus, user: AuthenticatedUser) {
    await this.assertCanEdit(id, user);
    return this.prisma.campaign.update({ where: { id }, data: { status } });
  }

  /** Powers the Campaign Dashboard (active/upcoming/completed + totals + overall progress). */
  async dashboardSummary(user: AuthenticatedUser) {
    // Same visibility rule as the list: an Admin's totals cover their own
    // campaigns, not the organisation's whole budget.
    const scope = this.visibilityFilter(user);

    const [active, upcoming, completed, draft, campaigns] = await Promise.all([
      this.prisma.campaign.count({ where: { ...scope, status: "ACTIVE" } }),
      this.prisma.campaign.count({ where: { ...scope, status: "UPCOMING" } }),
      this.prisma.campaign.count({ where: { ...scope, status: "COMPLETED" } }),
      this.prisma.campaign.count({ where: { ...scope, status: "DRAFT" } }),
      this.prisma.campaign.findMany({
        where: scope,
        select: { totalTarget: true, totalBudget: true, id: true },
      }),
    ]);

    // Campaigns that declare no headline figure contribute nothing to the
    // rollup rather than being counted as zero-target campaigns.
    const totalTarget = campaigns.reduce((sum, c) => sum + (c.totalTarget ?? 0), 0);
    const totalBudget = campaigns.reduce((sum, c) => sum + Number(c.totalBudget ?? 0), 0);

    const rootAllocations = await this.prisma.targetAllocation.findMany({
      where: { campaignId: { in: campaigns.map((c) => c.id) } },
      select: { achievedCount: true, target: true },
    });
    const achieved = rootAllocations.reduce((sum, a) => sum + a.achievedCount, 0);
    const target = rootAllocations.reduce((sum, a) => sum + a.target, 0);
    const overallProgress = target > 0 ? Math.round((achieved / target) * 100) : 0;

    // `total` is counted here rather than left to the caller to add up.
    // The dashboard was summing active + upcoming + completed, which silently
    // omits DRAFT (and any status added later) — an organisation whose
    // campaigns were all drafts read "Total Campaigns: 0" while nine existed.
    return {
      active,
      upcoming,
      completed,
      draft,
      total: campaigns.length,
      totalTarget,
      totalBudget,
      overallProgress,
    };
  }
}

/**
 * A campaign's status from its own dates.
 *
 * Creation used to hardcode DRAFT, which was wrong in two ways: the form has
 * no save-as-draft step (submitting it produces a complete campaign, admins
 * and all), and nothing in the app ever moved a campaign off DRAFT — so every
 * campaign stayed there permanently and the dashboard, which counts only
 * ACTIVE ones, showed nothing however much work existed.
 *
 * DRAFT remains in the enum for a genuine half-finished campaign if that is
 * ever built; it is simply no longer what a finished one is called.
 */
export function statusForDates(startDate: Date, endDate: Date, now: Date = new Date()): CampaignStatus {
  // End-of-day so a campaign ending today is still running today, rather than
  // flipping to COMPLETED at midnight of its own last day.
  const end = new Date(endDate);
  end.setHours(23, 59, 59, 999);
  if (end < now) return "COMPLETED";
  if (startDate > now) return "UPCOMING";
  return "ACTIVE";
}
