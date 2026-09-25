import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { RegionsService } from "../regions/regions.service";
import { AiService } from "../ai/ai.service";
import { AuthenticatedUser } from "../auth/types";

type RegionNode = { id: string; name: string; type: string; parentId: string | null };

export interface TaskAnalyticsFilters {
  dateFrom?: string;
  dateTo?: string;
  districtId?: string;
  constituencyId?: string;
  status?: string;
  priority?: string;
  taskType?: "BULK" | "INDIVIDUAL";
}

type ScopedTask = {
  id: string;
  batchId: string | null;
  name: string;
  deadline: Date;
  status: string;
  priority: string;
  acknowledgment: string;
  whatsappStatus: string;
  createdAt: Date;
  completedAt: Date | null;
  assignedToId: string;
  assignedTo: { id: string; name: string; regionId: string };
  batch: { id: string; name: string } | null;
};

interface Summary {
  total: number;
  messagesSent: number;
  delivered: number;
  read: number;
  failed: number;
  responded: number;
  completed: number;
  overdue: number;
  pending: number;
  completionPct: number;
}

/**
 * Powers the GLOBAL "Communication & AI Insights" dashboard — every metric
 * here is computed directly from real Task rows (which already carry the
 * full allocation -> WhatsApp -> response -> completion lifecycle) across
 * every task accessible to the caller, never a single task. Scoped exactly
 * like AnalyticsService: org-wide for SUPER_ADMIN, the caller's own region
 * subtree for ADMIN — filters can only ever narrow that, never widen it
 * (see loadScopedTasks).
 */
@Injectable()
export class TaskAnalyticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly regionsService: RegionsService,
    private readonly aiService: AiService,
  ) {}

  private async scope(user: AuthenticatedUser) {
    const isSuperAdmin = user.role === "SUPER_ADMIN";
    const regionIds = isSuperAdmin ? undefined : await this.regionsService.descendantIds(user.regionId);
    return { isSuperAdmin, regionIds };
  }

  /**
   * The region set a query is allowed to touch: the caller's own authorized
   * subtree (undefined = SUPER_ADMIN, unrestricted), narrowed further by a
   * District/Constituency filter if one was given. A filter for a region outside
   * the caller's own scope intersects down to nothing rather than escaping
   * it — this is what makes the District/Constituency filters safe to trust from
   * the frontend without a second authorization layer.
   */
  private async allowedRegionIds(user: AuthenticatedUser, filters: TaskAnalyticsFilters): Promise<string[] | undefined> {
    const { regionIds } = await this.scope(user);
    const filterRegionId = filters.constituencyId ?? filters.districtId;
    if (!filterRegionId) return regionIds;

    const filterDescendants = await this.regionsService.descendantIds(filterRegionId);
    return regionIds ? regionIds.filter((id) => filterDescendants.includes(id)) : filterDescendants;
  }

  private async allRegionsById(): Promise<Map<string, RegionNode>> {
    const regions = await this.prisma.region.findMany({ select: { id: true, name: true, type: true, parentId: true } });
    return new Map(regions.map((r) => [r.id, r]));
  }

  private resolveHierarchyLabels(regionId: string | null | undefined, regionById: Map<string, RegionNode>) {
    const labels: { district: string | null; constituency: string | null } = { district: null, constituency: null };
    let current = regionId ? regionById.get(regionId) : undefined;
    while (current) {
      if (current.type === "DISTRICT") labels.district = current.name;
      else if (current.type === "CONSTITUENCY") labels.constituency = current.name;
      current = current.parentId ? regionById.get(current.parentId) : undefined;
    }
    return labels;
  }

  private async loadScopedTasks(user: AuthenticatedUser, filters: TaskAnalyticsFilters = {}): Promise<ScopedTask[]> {
    const regionIds = await this.allowedRegionIds(user, filters);

    const where: Record<string, unknown> = {};
    if (regionIds) where.assignedTo = { regionId: { in: regionIds } };
    if (filters.status) where.status = filters.status;
    if (filters.priority) where.priority = filters.priority;
    if (filters.taskType === "BULK") where.batchId = { not: null };
    if (filters.taskType === "INDIVIDUAL") where.batchId = null;
    if (filters.dateFrom || filters.dateTo) {
      const createdAt: Record<string, Date> = {};
      if (filters.dateFrom) createdAt.gte = new Date(filters.dateFrom);
      if (filters.dateTo) createdAt.lte = new Date(filters.dateTo);
      where.createdAt = createdAt;
    }

    return this.prisma.task.findMany({
      where,
      select: {
        id: true,
        batchId: true,
        name: true,
        deadline: true,
        status: true,
        priority: true,
        acknowledgment: true,
        whatsappStatus: true,
        createdAt: true,
        completedAt: true,
        assignedToId: true,
        assignedTo: { select: { id: true, name: true, regionId: true } },
        batch: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: "desc" },
    });
  }

  private summarize(tasks: ScopedTask[]): Summary {
    const total = tasks.length;
    const messagesSent = tasks.filter((t) => t.whatsappStatus === "SENT" || t.whatsappStatus === "DELIVERED" || t.whatsappStatus === "READ").length;
    const delivered = tasks.filter((t) => t.whatsappStatus === "DELIVERED" || t.whatsappStatus === "READ").length;
    const read = tasks.filter((t) => t.whatsappStatus === "READ").length;
    const failed = tasks.filter((t) => t.whatsappStatus === "FAILED").length;
    const responded = tasks.filter((t) => t.acknowledgment !== "AWAITING").length;
    const completed = tasks.filter((t) => t.status === "COMPLETED").length;
    const overdue = tasks.filter((t) => t.status === "OVERDUE").length;
    const pending = total - completed - overdue;
    return {
      total,
      messagesSent,
      delivered,
      read,
      failed,
      responded,
      completed,
      overdue,
      pending,
      completionPct: total > 0 ? Math.round((completed / total) * 100) : 0,
    };
  }

  private avgCompletionHours(tasks: ScopedTask[]): number | null {
    const completedWithTimes = tasks.filter((t) => t.status === "COMPLETED" && t.completedAt);
    if (completedWithTimes.length === 0) return null;
    const totalMs = completedWithTimes.reduce((s, t) => s + (t.completedAt!.getTime() - t.createdAt.getTime()), 0);
    return Math.round((totalMs / completedWithTimes.length / 3_600_000) * 10) / 10;
  }

  private taskUnitName(t: ScopedTask) {
    return t.batch?.name ?? t.name;
  }

  private buildTaskWise(tasks: ScopedTask[]) {
    const groups = new Map<string, ScopedTask[]>();
    for (const t of tasks) {
      const key = t.batchId ?? t.id;
      const arr = groups.get(key) ?? [];
      arr.push(t);
      groups.set(key, arr);
    }
    return Array.from(groups.entries())
      .map(([taskId, group]) => ({
        taskId,
        name: this.taskUnitName(group[0]),
        allocatedCadres: group.length,
        ...this.summarize(group),
      }))
      .sort((a, b) => b.total - a.total);
  }

  private buildCadreWise(tasks: ScopedTask[], regionById: Map<string, RegionNode>) {
    const byCadre = new Map<string, ScopedTask[]>();
    for (const t of tasks) {
      const arr = byCadre.get(t.assignedToId) ?? [];
      arr.push(t);
      byCadre.set(t.assignedToId, arr);
    }
    return Array.from(byCadre.entries())
      .map(([cadreId, group]) => {
        const summary = this.summarize(group);
        const labels = this.resolveHierarchyLabels(group[0].assignedTo.regionId, regionById);
        return {
          cadreId,
          name: group[0].assignedTo.name,
          district: labels.district,
          constituency: labels.constituency,
          tasksAssigned: summary.total,
          tasksCompleted: summary.completed,
          pending: summary.pending,
          overdue: summary.overdue,
          completionPct: summary.completionPct,
          avgCompletionHours: this.avgCompletionHours(group),
        };
      })
      .sort((a, b) => b.completionPct - a.completionPct);
  }

  private buildGroupedByLabel(tasks: ScopedTask[], regionById: Map<string, RegionNode>, level: "district" | "constituency") {
    const groups = new Map<string, ScopedTask[]>();
    const cadresByGroup = new Map<string, Set<string>>();
    for (const t of tasks) {
      const key = this.resolveHierarchyLabels(t.assignedTo.regionId, regionById)[level] ?? "Unknown";
      const arr = groups.get(key) ?? [];
      arr.push(t);
      groups.set(key, arr);
      const set = cadresByGroup.get(key) ?? new Set<string>();
      set.add(t.assignedToId);
      cadresByGroup.set(key, set);
    }
    return Array.from(groups.entries())
      .map(([name, group]) => ({
        name,
        cadres: cadresByGroup.get(name)?.size ?? 0,
        ...this.summarize(group),
      }))
      .sort((a, b) => b.completionPct - a.completionPct);
  }

  private async buildBundle(user: AuthenticatedUser, filters: TaskAnalyticsFilters = {}) {
    const [tasks, regionById] = await Promise.all([this.loadScopedTasks(user, filters), this.allRegionsById()]);
    return {
      tasks,
      overview: this.summarize(tasks),
      avgCompletionHours: this.avgCompletionHours(tasks),
      taskWise: this.buildTaskWise(tasks),
      cadreWise: this.buildCadreWise(tasks, regionById),
      constituencyWise: this.buildGroupedByLabel(tasks, regionById, "constituency").map(({ name, ...g }) => ({ constituency: name, ...g })),
      districtWise: this.buildGroupedByLabel(tasks, regionById, "district").map(({ name, ...g }) => ({ district: name, ...g })),
    };
  }

  /** The Admin's own authorized area name, for the dashboard header — null/org-wide for Super Admin. */
  async getScope(user: AuthenticatedUser) {
    if (user.role === "SUPER_ADMIN") return { isOrgWide: true, areaName: null, areaType: null };
    const region = await this.prisma.region.findUnique({ where: { id: user.regionId }, select: { name: true, type: true } });
    return { isOrgWide: false, areaName: region?.name ?? null, areaType: region?.type ?? null };
  }

  async getOverview(user: AuthenticatedUser, filters: TaskAnalyticsFilters = {}) {
    const { tasks, overview, avgCompletionHours } = await this.buildBundle(user, filters);
    const totalTasks = new Set(tasks.map((t) => t.batchId ?? t.id)).size;
    return {
      totalTasks,
      totalCadresAllocated: overview.total,
      messagesSent: overview.messagesSent,
      delivered: overview.delivered,
      read: overview.read,
      responded: overview.responded,
      completed: overview.completed,
      pending: overview.pending,
      overdue: overview.overdue,
      failedWhatsapp: overview.failed,
      completionPct: overview.completionPct,
      avgCompletionHours,
    };
  }

  /** Total/Active Cadres come from the User table directly, not derived from Task rows — an unallocated Cadre still counts. */
  async getCadreOverview(user: AuthenticatedUser, filters: TaskAnalyticsFilters = {}) {
    const regionIds = await this.allowedRegionIds(user, filters);
    const [allCadres, { cadreWise }] = await Promise.all([
      this.prisma.user.findMany({
        where: { role: "CADRE", ...(regionIds ? { regionId: { in: regionIds } } : {}) },
        select: { isActive: true },
      }),
      this.buildBundle(user, filters),
    ]);

    return {
      totalCadres: allCadres.length,
      activeCadres: allCadres.filter((c) => c.isActive).length,
      cadresWithTasks: cadreWise.length,
      cadresWithPendingTasks: cadreWise.filter((c) => c.pending > 0).length,
      cadresWithCompletedTasks: cadreWise.filter((c) => c.tasksCompleted > 0).length,
      avgCadreCompletionPct:
        cadreWise.length > 0 ? Math.round(cadreWise.reduce((s, c) => s + c.completionPct, 0) / cadreWise.length) : 0,
    };
  }

  async getTaskWiseAnalytics(user: AuthenticatedUser, filters: TaskAnalyticsFilters = {}) {
    return (await this.buildBundle(user, filters)).taskWise;
  }

  async getCadreAnalytics(user: AuthenticatedUser, filters: TaskAnalyticsFilters = {}) {
    return (await this.buildBundle(user, filters)).cadreWise;
  }

  async getConstituencyAnalytics(user: AuthenticatedUser, filters: TaskAnalyticsFilters = {}) {
    return (await this.buildBundle(user, filters)).constituencyWise;
  }

  /** Only meaningful when the caller's scope spans multiple Districts — a single-District Admin just sees one row, which is still correct. */
  async getDistrictAnalytics(user: AuthenticatedUser, filters: TaskAnalyticsFilters = {}) {
    return (await this.buildBundle(user, filters)).districtWise;
  }

  async getCharts(user: AuthenticatedUser, filters: TaskAnalyticsFilters = {}) {
    const { tasks, overview, cadreWise, constituencyWise } = await this.buildBundle(user, filters);

    const communicationFunnel = [
      { stage: "Allocated", count: overview.total },
      { stage: "Sent", count: overview.messagesSent },
      { stage: "Delivered", count: overview.delivered },
      { stage: "Read", count: overview.read },
      { stage: "Responded", count: overview.responded },
      { stage: "Completed", count: overview.completed },
    ];

    const priorityCounts = new Map<string, number>();
    for (const t of tasks) priorityCounts.set(t.priority, (priorityCounts.get(t.priority) ?? 0) + 1);

    const createdByDay = new Map<string, number>();
    const completedByDay = new Map<string, number>();
    for (const t of tasks) {
      const day = t.createdAt.toISOString().slice(0, 10);
      createdByDay.set(day, (createdByDay.get(day) ?? 0) + 1);
      if (t.completedAt) {
        const cDay = t.completedAt.toISOString().slice(0, 10);
        completedByDay.set(cDay, (completedByDay.get(cDay) ?? 0) + 1);
      }
    }
    const byDate = (m: Map<string, number>) =>
      Array.from(m.entries())
        .map(([date, count]) => ({ date, count }))
        .sort((a, b) => a.date.localeCompare(b.date));

    return {
      taskCompletion: [
        { name: "Completed", value: overview.completed },
        { name: "Pending", value: overview.pending },
        { name: "Overdue", value: overview.overdue },
      ],
      communicationFunnel,
      deliveryPct: overview.messagesSent > 0 ? Math.round((overview.delivered / overview.messagesSent) * 100) : 0,
      responsePct: overview.delivered > 0 ? Math.round((overview.responded / overview.delivered) * 100) : 0,
      completionByConstituency: constituencyWise.map((m) => ({ name: m.constituency, completionPct: m.completionPct })),
      cadrePerformance: cadreWise.slice(0, 10).map((c) => ({ name: c.name, completionPct: c.completionPct, completed: c.tasksCompleted, total: c.tasksAssigned })),
      overdueByConstituency: constituencyWise.filter((m) => m.overdue > 0).map((m) => ({ name: m.constituency, overdue: m.overdue })),
      tasksByPriority: Array.from(priorityCounts.entries()).map(([name, value]) => ({ name, value })),
      tasksCreatedOverTime: byDate(createdByDay),
      completionTrend: byDate(completedByDay),
    };
  }

  /**
   * Rule-based (no AI) actionable flags — deterministic and instant, unlike
   * the AI Insights section below. Each item carries real entity ids so the
   * frontend's action buttons (View / Follow Up / Send Reminder / Retry
   * WhatsApp) link to something real.
   */
  async getActionCenter(user: AuthenticatedUser, filters: TaskAnalyticsFilters = {}) {
    const { tasks, cadreWise } = await this.buildBundle(user, filters);
    const now = Date.now();
    const RISK_WINDOW_MS = 48 * 60 * 60 * 1000;

    const followUp = tasks
      .filter((t) => (t.whatsappStatus === "DELIVERED" || t.whatsappStatus === "READ") && t.acknowledgment === "AWAITING")
      .map((t) => ({ taskId: t.id, cadreId: t.assignedToId, cadreName: t.assignedTo.name, taskName: this.taskUnitName(t), deadline: t.deadline }));

    const atRisk = tasks
      .filter((t) => t.status !== "COMPLETED" && t.status !== "CANCELLED")
      .filter((t) => {
        const remaining = new Date(t.deadline).getTime() - now;
        return remaining > 0 && remaining <= RISK_WINDOW_MS;
      })
      .map((t) => ({ taskId: t.id, cadreId: t.assignedToId, cadreName: t.assignedTo.name, taskName: this.taskUnitName(t), deadline: t.deadline }));

    const whatsappFailures = tasks
      .filter((t) => t.whatsappStatus === "FAILED")
      .map((t) => ({ taskId: t.id, cadreId: t.assignedToId, cadreName: t.assignedTo.name, taskName: this.taskUnitName(t) }));

    const avgCompletionPct = cadreWise.length > 0 ? cadreWise.reduce((s, c) => s + c.completionPct, 0) / cadreWise.length : 0;
    const anomalies = cadreWise
      .filter((c) => c.tasksAssigned >= 3 && c.completionPct < avgCompletionPct * 0.5)
      .map((c) => ({ cadreId: c.cadreId, name: c.name, completionPct: c.completionPct, teamAvgCompletionPct: Math.round(avgCompletionPct) }));

    return { followUp, atRisk, whatsappFailures, anomalies };
  }

  async generateAiInsights(user: AuthenticatedUser, filters: TaskAnalyticsFilters = {}) {
    const { overview, avgCompletionHours, cadreWise, constituencyWise, districtWise } = await this.buildBundle(user, filters);
    const actionCenter = await this.getActionCenter(user, filters);

    const bundle = {
      overview: { ...overview, avgCompletionHours },
      topCadres: cadreWise.slice(0, 5),
      bottomCadres: [...cadreWise].sort((a, b) => a.completionPct - b.completionPct).slice(0, 5),
      topConstituencies: constituencyWise.slice(0, 5),
      bottomConstituencies: [...constituencyWise].sort((a, b) => a.completionPct - b.completionPct).slice(0, 5),
      districts: districtWise,
      tasksAtRisk: actionCenter.atRisk.slice(0, 10),
      whatsappFailures: actionCenter.whatsappFailures.slice(0, 10),
      cadresNeedingFollowUp: actionCenter.followUp.slice(0, 10),
      performanceAnomalies: actionCenter.anomalies,
    };

    return this.aiService.generateGlobalTaskInsights(bundle);
  }

  async askAi(user: AuthenticatedUser, question: string, filters: TaskAnalyticsFilters = {}) {
    const { overview, avgCompletionHours, cadreWise, constituencyWise, districtWise, taskWise } = await this.buildBundle(user, filters);
    const bundle = {
      overview: { ...overview, avgCompletionHours },
      cadres: cadreWise.slice(0, 30),
      constituencies: constituencyWise,
      districts: districtWise,
      tasks: taskWise.slice(0, 30),
    };
    const answer = await this.aiService.answerTaskQuestion(question, bundle);
    return { answer };
  }
}
