import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuthenticatedUser } from "../auth/types";
import { RegionsService } from "../regions/regions.service";
import { CampaignsService } from "./campaigns.service";

/**
 * Everything the Campaign Details page shows, drilling Campaign -> Task ->
 * Cadre.
 *
 * Every method starts by calling CampaignsService.findById(), which 404s a
 * campaign the caller may not see — so visibility is decided once, in one
 * place, rather than being re-derived (and possibly re-derived wrongly) per
 * endpoint. Task-level rows are then narrowed again by region for anyone
 * who isn't a Super Admin, matching what AnalyticsService already does.
 *
 * A note on numbers: PoliOS has no per-Cadre numeric target. A Task row IS
 * the per-Cadre allocation record, and it carries a status plus
 * ProgressUpdate rows, not a quota. Targets live on TargetAllocation
 * (Campaign -> Region -> owner). So "target/achieved" here is read from the
 * TargetAllocation a task is linked to, and per-Cadre progress is the
 * latest ProgressUpdate.completionPercentage. Nothing is invented to fill
 * a column — a task with no allocation reports null, and the UI shows "—".
 */
@Injectable()
export class CampaignDetailService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly regionsService: RegionsService,
    private readonly campaigns: CampaignsService,
  ) {}

  /** Region ids a non-Super-Admin may see, or undefined for unrestricted. */
  private async scopedRegionIds(user: AuthenticatedUser) {
    if (user.role === "SUPER_ADMIN") return undefined;
    return this.regionsService.descendantIds(user.regionId);
  }

  /**
   * A Cadre only ever sees their own work, an Admin sees their area's, a
   * Super Admin sees everything. Expressed as a Task `where` fragment so
   * every query below narrows identically.
   */
  private async taskScope(user: AuthenticatedUser) {
    if (user.role === "CADRE") return { assignedToId: user.id };
    const regionIds = await this.scopedRegionIds(user);
    return regionIds ? { assignedTo: { regionId: { in: regionIds } } } : {};
  }

  // ============================================================
  // OVERVIEW — header, KPI cards, progress bars
  // ============================================================

  async overview(campaignId: string, user: AuthenticatedUser) {
    const campaign = await this.campaigns.findById(campaignId, user);
    const scope = await this.taskScope(user);
    const regionIds = await this.scopedRegionIds(user);

    const [statusCounts, cadreRows, allocations, spentAgg, pendingExpenses] = await Promise.all([
      this.prisma.task.groupBy({
        by: ["status"],
        where: { campaignId, ...scope },
        _count: true,
      }),
      // Distinct Cadres across the campaign's tasks — the same person on
      // three tasks is one Cadre, not three.
      this.prisma.task.findMany({
        where: { campaignId, ...scope },
        select: { assignedToId: true },
        distinct: ["assignedToId"],
      }),
      this.prisma.targetAllocation.findMany({
        where:
          user.role === "SUPER_ADMIN"
            ? { campaignId, parentAllocationId: null }
            : { campaignId, regionId: { in: regionIds } },
        select: { target: true, achievedCount: true, allocatedBudget: true },
      }),
      this.prisma.targetAllocation.aggregate({
        where: user.role === "SUPER_ADMIN" ? { campaignId } : { campaignId, regionId: { in: regionIds } },
        _sum: { spentBudget: true },
      }),
      this.prisma.expenseRequest.aggregate({
        where: { campaignId, approvalStatus: "PENDING" },
        _sum: { amount: true },
      }),
    ]);

    const count = (status: string) => statusCounts.find((s) => s.status === status)?._count ?? 0;
    const totalTasks = statusCounts.reduce((sum, s) => sum + s._count, 0);
    const completedTasks = count("COMPLETED");

    const target = allocations.reduce((s, a) => s + a.target, 0);
    const achieved = allocations.reduce((s, a) => s + a.achievedCount, 0);
    // Falls back to the campaign's own headline budget when nothing has been
    // allocated down the hierarchy yet — otherwise a campaign with a budget
    // but no allocations would report ₹0 of ₹0.
    const allocatedBudget =
      allocations.reduce((s, a) => s + Number(a.allocatedBudget), 0) ||
      Number(campaign.totalBudget ?? 0);
    const spentBudget = Number(spentAgg._sum.spentBudget ?? 0);

    return {
      campaign: {
        id: campaign.id,
        name: campaign.name,
        description: campaign.description,
        objective: campaign.objective,
        category: campaign.category,
        status: campaign.status,
        priority: campaign.priority,
        startDate: campaign.startDate,
        endDate: campaign.endDate,
        totalTarget: campaign.totalTarget,
        totalBudget: campaign.totalBudget === null ? null : Number(campaign.totalBudget),
        expectedVolunteers: campaign.expectedVolunteers,
        requiredDocuments: campaign.requiredDocuments,
        bannerUrl: campaign.bannerUrl,
        createdAt: campaign.createdAt,
        createdBy: campaign.createdBy ? { id: campaign.createdBy.id, name: campaign.createdBy.name } : null,
        assignedAdmins: campaign.assignedAdmins.map((a) => ({
          id: a.admin.id,
          name: a.admin.name,
          status: a.status,
        })),
        // The viewer's own assignment, so the page can show an accept /
        // decline banner without the frontend re-deriving who it belongs to.
        myAssignment:
          campaign.assignedAdmins
            .filter((a) => a.adminId === user.id)
            .map((a) => ({
              status: a.status,
              respondedAt: a.respondedAt,
              responseNote: a.responseNote,
            }))[0] ?? null,
      },
      summary: {
        totalTasks,
        completedTasks,
        inProgressTasks: count("IN_PROGRESS"),
        pendingTasks: count("PENDING"),
        overdueTasks: count("OVERDUE"),
        cancelledTasks: count("CANCELLED"),
        cadreCount: cadreRows.length,
        // Target numbers come from TargetAllocation. Zero means nobody has
        // allocated a target yet, which is different from a target of zero —
        // the UI distinguishes them.
        target,
        achieved,
        hasTargets: allocations.length > 0,
        allocatedBudget,
        spentBudget,
        pendingApprovalBudget: Number(pendingExpenses._sum.amount ?? 0),
      },
      progress: {
        targetAchievementPct: target > 0 ? Math.round((achieved / target) * 100) : 0,
        taskCompletionPct: totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0,
        budgetUsedPct: allocatedBudget > 0 ? Math.round((spentBudget / allocatedBudget) * 100) : 0,
      },
    };
  }

  // ============================================================
  // TASKS — one row per task batch, not per Cadre
  // ============================================================

  /**
   * A "task" to a user is the thing they created once and sent to many
   * Cadres — a TaskBatch. The Task table holds one row *per Cadre*, so
   * listing it raw would show the same task a dozen times. Rows are grouped
   * back by batch here, with standalone (batch-less) tasks kept as-is.
   */
  async tasks(campaignId: string, user: AuthenticatedUser) {
    await this.campaigns.findById(campaignId, user);
    const scope = await this.taskScope(user);

    const rows = await this.prisma.task.findMany({
      where: { campaignId, ...scope },
      include: {
        assignedTo: { select: { id: true, name: true, region: { select: { name: true, type: true } } } },
        assignedBy: { select: { id: true, name: true } },
        batch: { select: { id: true, name: true, description: true, objective: true, createdAt: true } },
        allocation: { select: { target: true, achievedCount: true } },
        pollingStation: { select: { name: true, parent: { select: { name: true } } } },
        progress: { orderBy: { createdAt: "desc" }, take: 1, select: { completionPercentage: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    // Batches whose Task rows haven't been created yet (created, not yet
    // allocated). Without these a freshly-created task is invisible on the
    // campaign it was filed against, which reads as if it failed to save.
    const unallocated = await this.prisma.taskBatch.findMany({
      where: { campaignId, awaitingAllocation: true, tasks: { none: {} } },
      select: {
        id: true,
        name: true,
        description: true,
        deadline: true,
        priority: true,
        createdAt: true,
        createdBy: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    const groups = new Map<string, typeof rows>();
    for (const row of rows) {
      const key = row.batchId ?? row.id;
      groups.set(key, [...(groups.get(key) ?? []), row]);
    }

    const grouped = [...groups.entries()].map(([key, members]) => {
      const first = members[0];
      const areas = [...new Set(members.map((m) => m.assignedTo.region.name))];
      const progressValues = members.map((m) => m.progress[0]?.completionPercentage ?? 0);

      return {
        id: key,
        isBatch: Boolean(first.batchId),
        // Every Cadre's row in a batch shares the batch's own id — that is
        // what the Task Details drawer is opened with.
        taskIds: members.map((m) => m.id),
        name: first.batch?.name ?? first.name,
        description: first.batch?.description ?? first.description,
        status: this.rollUpStatus(members.map((m) => m.status)),
        priority: first.priority,
        assignedBy: first.assignedBy,
        cadreCount: members.length,
        areas,
        pollingStation: first.pollingStation
          ? {
              name: first.pollingStation.name,
              constituency: first.pollingStation.parent?.name ?? null,
            }
          : null,
        // Null, not 0, when no TargetAllocation is linked — "no target set"
        // and "a target of zero" are different things.
        target: first.allocation?.target ?? null,
        achieved: first.allocation?.achievedCount ?? null,
        progressPct: progressValues.length
          ? Math.round(progressValues.reduce((s, v) => s + v, 0) / progressValues.length)
          : 0,
        completedCount: members.filter((m) => m.status === "COMPLETED").length,
        deadline: first.deadline,
        createdAt: first.batch?.createdAt ?? first.createdAt,
        awaitingAllocation: false,
      };
    });

    const pending = unallocated
      .filter((b) => !groups.has(b.id))
      .map((b) => ({
        id: b.id,
        isBatch: true,
        taskIds: [] as string[],
        name: b.name,
        description: b.description,
        status: "AWAITING_ALLOCATION",
        priority: b.priority,
        assignedBy: b.createdBy,
        cadreCount: 0,
        areas: [] as string[],
        pollingStation: null,
        target: null,
        achieved: null,
        progressPct: 0,
        completedCount: 0,
        deadline: b.deadline,
        createdAt: b.createdAt,
        awaitingAllocation: true,
      }));

    return [...pending, ...grouped].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
  }

  /**
   * One status for a batch sent to many Cadres. Deliberately pessimistic:
   * anything overdue makes the whole batch overdue, and it only reads
   * COMPLETED once every Cadre is done — a batch that looks finished while
   * half its Cadres haven't reported is the misleading case worth avoiding.
   */
  private rollUpStatus(statuses: string[]): string {
    const live = statuses.filter((s) => s !== "CANCELLED");
    if (live.length === 0) return "CANCELLED";
    if (live.includes("OVERDUE")) return "OVERDUE";
    if (live.every((s) => s === "COMPLETED")) return "COMPLETED";
    if (live.some((s) => s === "IN_PROGRESS" || s === "COMPLETED")) return "IN_PROGRESS";
    return "PENDING";
  }

  // ============================================================
  // CADRES — everyone working this campaign
  // ============================================================

  async cadres(campaignId: string, user: AuthenticatedUser) {
    await this.campaigns.findById(campaignId, user);
    const scope = await this.taskScope(user);

    const rows = await this.prisma.task.findMany({
      where: { campaignId, ...scope },
      select: {
        status: true,
        createdAt: true,
        assignedTo: {
          select: {
            id: true,
            name: true,
            phone: true,
            region: { select: { name: true, type: true } },
          },
        },
        progress: { orderBy: { createdAt: "desc" }, take: 1, select: { completionPercentage: true } },
      },
    });

    const byCadre = new Map<string, {
      id: string;
      name: string;
      phone: string;
      area: string;
      areaType: string;
      taskCount: number;
      completedCount: number;
      progressTotal: number;
      firstAssignedAt: Date;
    }>();

    for (const row of rows) {
      const cadre = row.assignedTo;
      const entry = byCadre.get(cadre.id) ?? {
        id: cadre.id,
        name: cadre.name,
        phone: cadre.phone,
        area: cadre.region.name,
        areaType: cadre.region.type,
        taskCount: 0,
        completedCount: 0,
        progressTotal: 0,
        firstAssignedAt: row.createdAt,
      };
      entry.taskCount += 1;
      if (row.status === "COMPLETED") entry.completedCount += 1;
      entry.progressTotal += row.progress[0]?.completionPercentage ?? 0;
      if (row.createdAt < entry.firstAssignedAt) entry.firstAssignedAt = row.createdAt;
      byCadre.set(cadre.id, entry);
    }

    return [...byCadre.values()]
      .map(({ progressTotal, ...c }) => ({
        ...c,
        avgProgressPct: c.taskCount > 0 ? Math.round(progressTotal / c.taskCount) : 0,
      }))
      .sort((a, b) => b.taskCount - a.taskCount || a.name.localeCompare(b.name));
  }

  // ============================================================
  // COMMUNICATION — WhatsApp delivery for this campaign's tasks
  // ============================================================

  async communication(campaignId: string, user: AuthenticatedUser) {
    await this.campaigns.findById(campaignId, user);
    const scope = await this.taskScope(user);

    const taskIds = (
      await this.prisma.task.findMany({ where: { campaignId, ...scope }, select: { id: true } })
    ).map((t) => t.id);

    if (taskIds.length === 0) {
      return { total: 0, sent: 0, delivered: 0, read: 0, failed: 0, pending: 0, lastSentAt: null, templates: [], recent: [] };
    }

    const [byStatus, byTemplate, recent] = await Promise.all([
      this.prisma.taskMessageLog.groupBy({
        by: ["status"],
        where: { taskId: { in: taskIds } },
        _count: true,
      }),
      this.prisma.taskMessageLog.groupBy({
        by: ["templateName"],
        where: { taskId: { in: taskIds } },
        _count: true,
      }),
      this.prisma.taskMessageLog.findMany({
        where: { taskId: { in: taskIds } },
        orderBy: { sentAt: "desc" },
        take: 20,
        select: {
          id: true,
          cadreName: true,
          cadrePhone: true,
          taskName: true,
          templateName: true,
          status: true,
          kind: true,
          failureReason: true,
          providerMessageId: true,
          sentAt: true,
        },
      }),
    ]);

    const count = (status: string) => byStatus.find((s) => s.status === status)?._count ?? 0;

    return {
      total: byStatus.reduce((s, r) => s + r._count, 0),
      // SENT is the provider accepting it; DELIVERED/READ are later stages
      // of the same send, counted separately so the funnel is readable.
      sent: count("SENT"),
      delivered: count("DELIVERED"),
      read: count("READ"),
      failed: count("FAILED"),
      pending: count("PENDING"),
      lastSentAt: recent[0]?.sentAt ?? null,
      templates: byTemplate
        .filter((t) => t.templateName)
        .map((t) => ({ name: t.templateName!, count: t._count })),
      recent,
    };
  }

  // ============================================================
  // ACTIVITY — assembled, because there is no single event table
  // ============================================================

  /**
   * PoliOS records no unified activity stream, so the timeline is built
   * from the facts that ARE recorded: when tasks and batches were created,
   * when Cadres acknowledged, when progress was reported, when WhatsApp
   * messages went out, and whatever AuditLog holds for this campaign.
   * Everything here is a real stored timestamp — nothing is inferred.
   */
  async activity(campaignId: string, user: AuthenticatedUser) {
    const campaign = await this.campaigns.findById(campaignId, user);
    const scope = await this.taskScope(user);

    const tasks = await this.prisma.task.findMany({
      where: { campaignId, ...scope },
      select: {
        id: true,
        name: true,
        createdAt: true,
        acknowledgedAt: true,
        acknowledgment: true,
        completedAt: true,
        whatsappSentAt: true,
        batch: { select: { id: true, name: true, createdAt: true, createdBy: { select: { name: true } } } },
        assignedTo: { select: { name: true } },
        assignedBy: { select: { name: true } },
        progress: {
          orderBy: { createdAt: "desc" },
          select: { completionPercentage: true, createdAt: true, cadre: { select: { name: true } } },
        },
      },
    });

    const events: { at: Date; type: string; title: string; detail: string | null; actor: string | null }[] = [];

    events.push({
      at: campaign.createdAt,
      type: "CAMPAIGN_CREATED",
      title: "Campaign created",
      detail: campaign.name,
      actor: campaign.createdBy?.name ?? null,
    });

    // One "created"/"allocated" entry per batch rather than per Cadre row —
    // a batch sent to 12 Cadres is one action, not twelve.
    const seenBatches = new Set<string>();
    for (const task of tasks) {
      if (task.batch && !seenBatches.has(task.batch.id)) {
        seenBatches.add(task.batch.id);
        events.push({
          at: task.batch.createdAt,
          type: "TASK_CREATED",
          title: "Task created",
          detail: task.batch.name,
          actor: task.batch.createdBy?.name ?? null,
        });
        const members = tasks.filter((t) => t.batch?.id === task.batch!.id);
        events.push({
          at: members.reduce((min, m) => (m.createdAt < min ? m.createdAt : min), members[0].createdAt),
          type: "TASK_ALLOCATED",
          title: `Allocated to ${members.length} Cadre${members.length === 1 ? "" : "s"}`,
          detail: task.batch.name,
          actor: task.assignedBy?.name ?? null,
        });
      } else if (!task.batch) {
        events.push({
          at: task.createdAt,
          type: "TASK_CREATED",
          title: "Task assigned",
          detail: `${task.name} → ${task.assignedTo.name}`,
          actor: task.assignedBy?.name ?? null,
        });
      }

      if (task.whatsappSentAt) {
        events.push({
          at: task.whatsappSentAt,
          type: "MESSAGE_SENT",
          title: "WhatsApp notification sent",
          detail: `${task.name} → ${task.assignedTo.name}`,
          actor: null,
        });
      }
      if (task.acknowledgedAt) {
        events.push({
          at: task.acknowledgedAt,
          type: "TASK_ACKNOWLEDGED",
          title: task.acknowledgment === "ACCEPTED" ? "Task accepted" : "Task declined",
          detail: task.name,
          actor: task.assignedTo.name,
        });
      }
      for (const update of task.progress) {
        events.push({
          at: update.createdAt,
          type: "PROGRESS_UPDATED",
          title: `Progress updated: ${update.completionPercentage}%`,
          detail: task.name,
          actor: update.cadre?.name ?? task.assignedTo.name,
        });
      }
      if (task.completedAt) {
        events.push({
          at: task.completedAt,
          type: "TASK_COMPLETED",
          title: "Task completed",
          detail: `${task.name} → ${task.assignedTo.name}`,
          actor: task.assignedTo.name,
        });
      }
    }

    const audit = await this.prisma.auditLog.findMany({
      where: { entityType: "Campaign", entityId: campaignId },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: { action: true, createdAt: true, user: { select: { name: true } } },
    });
    for (const entry of audit) {
      events.push({
        at: entry.createdAt,
        type: "AUDIT",
        title: entry.action,
        detail: null,
        actor: entry.user?.name ?? null,
      });
    }

    return events.sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, 200);
  }

  // ============================================================
  // ATTACHMENTS
  // ============================================================

  async attachments(campaignId: string, user: AuthenticatedUser) {
    await this.campaigns.findById(campaignId, user);
    const scope = await this.taskScope(user);

    const [campaignFiles, taskFiles, batches] = await Promise.all([
      this.prisma.campaignAttachment.findMany({ where: { campaignId } }),
      this.prisma.taskAttachment.findMany({
        where: { task: { campaignId, ...scope } },
        select: {
          id: true,
          url: true,
          fileType: true,
          createdAt: true,
          task: { select: { name: true, assignedBy: { select: { name: true } } } },
        },
      }),
      this.prisma.taskBatch.findMany({
        where: { campaignId },
        select: { name: true, attachmentUrls: true, createdAt: true, createdBy: { select: { name: true } } },
      }),
    ]);

    const fromUrl = (url: string) => {
      const name = url.split("/").pop() ?? url;
      return { name, type: (name.split(".").pop() ?? "file").toUpperCase() };
    };

    return [
      ...campaignFiles.map((f) => ({
        id: f.id,
        url: f.url,
        name: fromUrl(f.url).name,
        fileType: f.fileType,
        source: "Campaign",
        // CampaignAttachment records no uploader — the column doesn't exist,
        // so this is null rather than a guess at who it was.
        uploadedBy: null as string | null,
        uploadedAt: f.uploadedAt as Date | null,
      })),
      ...taskFiles.map((f) => ({
        id: f.id,
        url: f.url,
        name: fromUrl(f.url).name,
        fileType: f.fileType,
        source: f.task.name,
        uploadedBy: f.task.assignedBy?.name ?? null,
        uploadedAt: f.createdAt,
      })),
      // TaskBatch keeps plain URLs rather than rows, so these have no id of
      // their own — the url is unique enough to key a list on.
      ...batches.flatMap((b) =>
        b.attachmentUrls.map((url) => ({
          id: url,
          url,
          name: fromUrl(url).name,
          fileType: fromUrl(url).type,
          source: b.name,
          uploadedBy: b.createdBy?.name ?? null,
          uploadedAt: b.createdAt,
        })),
      ),
    ];
  }
}
