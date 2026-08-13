import { Injectable } from "@nestjs/common";
import { RegionType } from "../shared-types";
import { PrismaService } from "../prisma/prisma.service";
import { RegionsService } from "../regions/regions.service";
import { AuthenticatedUser } from "../auth/types";

@Injectable()
export class AnalyticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly regionsService: RegionsService,
  ) {}

  /**
   * SUPER_ADMIN sees the whole org, no filter. ADMIN is scoped to their own
   * region subtree — `regionIds` is used two ways below: the exact
   * `regionId` for rows whose achievedCount already rolls up a whole
   * subtree (TargetAllocation via propagateAchievedDelta), and the full
   * descendant set for rows that don't roll up (spentBudget, tasks,
   * grievances, expenses).
   */
  private async scope(user: AuthenticatedUser) {
    const isSuperAdmin = user.role === "SUPER_ADMIN";
    const regionIds = isSuperAdmin ? undefined : await this.regionsService.descendantIds(user.regionId);
    return { isSuperAdmin, regionIds };
  }

  async campaignProgress(campaignId: string, user: AuthenticatedUser) {
    const { isSuperAdmin, regionIds } = await this.scope(user);

    const [topAllocations, spentAgg, tasks, expenses] = await Promise.all([
      this.prisma.targetAllocation.findMany({
        where: isSuperAdmin
          ? { campaignId, parentAllocationId: null }
          : { campaignId, regionId: user.regionId },
        select: { target: true, achievedCount: true, allocatedBudget: true },
      }),
      this.prisma.targetAllocation.aggregate({
        where: isSuperAdmin ? { campaignId } : { campaignId, regionId: { in: regionIds } },
        _sum: { spentBudget: true },
      }),
      this.prisma.task.groupBy({
        by: ["status"],
        where: isSuperAdmin ? { campaignId } : { campaignId, assignedTo: { regionId: { in: regionIds } } },
        _count: true,
      }),
      this.prisma.expenseRequest.aggregate({
        where: isSuperAdmin
          ? { campaignId, approvalStatus: "PENDING" }
          : { campaignId, approvalStatus: "PENDING", submittedBy: { regionId: { in: regionIds } } },
        _sum: { amount: true },
      }),
    ]);

    const target = topAllocations.reduce((s, a) => s + a.target, 0);
    const achieved = topAllocations.reduce((s, a) => s + a.achievedCount, 0);
    const allocatedBudget = topAllocations.reduce((s, a) => s + Number(a.allocatedBudget), 0);
    const spentBudget = Number(spentAgg._sum.spentBudget ?? 0);

    const taskCounts = Object.fromEntries(tasks.map((t) => [t.status, t._count]));

    return {
      targetAchievementPct: target > 0 ? Math.round((achieved / target) * 100) : 0,
      budgetUtilizationPct: allocatedBudget > 0 ? Math.round((spentBudget / allocatedBudget) * 100) : 0,
      totalTasks: tasks.reduce((s, t) => s + t._count, 0),
      completedTasks: taskCounts.COMPLETED ?? 0,
      overdueTasks: taskCounts.OVERDUE ?? 0,
      pendingApprovalBudget: Number(expenses._sum.amount ?? 0),
    };
  }

  /** District/Mandal/Booth progress bars, ranked best-to-worst by achievement %. */
  async regionProgress(campaignId: string, regionType: RegionType, user: AuthenticatedUser) {
    const { isSuperAdmin, regionIds } = await this.scope(user);

    const allocations = await this.prisma.targetAllocation.findMany({
      where: isSuperAdmin
        ? { campaignId, region: { type: regionType } }
        : { campaignId, region: { type: regionType, id: { in: regionIds } } },
      include: { region: true },
    });

    return allocations
      .map((a) => ({
        regionId: a.regionId,
        regionName: a.region.name,
        target: a.target,
        achieved: a.achievedCount,
        achievementPct: a.target > 0 ? Math.round((a.achievedCount / a.target) * 100) : 0,
        allocatedBudget: Number(a.allocatedBudget),
        spentBudget: Number(a.spentBudget),
      }))
      .sort((a, b) => b.achievementPct - a.achievementPct);
  }

  async topPerformers(campaignId: string, level: "district" | "cadre", user: AuthenticatedUser) {
    if (level === "district") {
      return this.regionProgress(campaignId, "DISTRICT", user).then((rows) => rows.slice(0, 5));
    }

    const { isSuperAdmin, regionIds } = await this.scope(user);
    const cadres = await this.prisma.user.findMany({
      where: {
        role: "CADRE",
        tasksAssignedTo: { some: { campaignId } },
        ...(isSuperAdmin ? {} : { regionId: { in: regionIds } }),
      },
      select: {
        id: true,
        name: true,
        tasksAssignedTo: {
          where: { campaignId },
          select: { status: true },
        },
      },
    });

    return cadres
      .map((c) => ({
        id: c.id,
        name: c.name,
        completed: c.tasksAssignedTo.filter((t) => t.status === "COMPLETED").length,
        total: c.tasksAssignedTo.length,
      }))
      .sort((a, b) => b.completed - a.completed)
      .slice(0, 10);
  }

  async pendingAndOverdue(campaignId: string, user: AuthenticatedUser) {
    const { isSuperAdmin, regionIds } = await this.scope(user);
    const regionFilter = isSuperAdmin ? {} : { assignedTo: { regionId: { in: regionIds } } };

    const [pending, overdue] = await Promise.all([
      this.prisma.task.findMany({ where: { campaignId, status: "PENDING", ...regionFilter } }),
      this.prisma.task.findMany({ where: { campaignId, status: "OVERDUE", ...regionFilter } }),
    ]);
    return { pending, overdue };
  }

  /**
   * One consolidated payload for the dashboard: target/budget progress,
   * task and grievance health, pending expenses, and each active campaign's
   * progress — all scoped to the caller (org-wide for SUPER_ADMIN, own
   * region subtree for ADMIN) — plus a role-specific comparison section
   * (region leaderboard for SUPER_ADMIN, rank-among-siblings + cadre
   * leaderboard for ADMIN).
   */
  async overview(user: AuthenticatedUser) {
    const { isSuperAdmin, regionIds } = await this.scope(user);

    const topAllocWhere = isSuperAdmin
      ? { campaign: { status: "ACTIVE" as const }, parentAllocationId: null }
      : { campaign: { status: "ACTIVE" as const }, regionId: user.regionId };

    const [topAllocations, spentAgg, taskGroups, grievanceGroups, pendingExpenseAgg, campaigns] = await Promise.all([
      this.prisma.targetAllocation.findMany({
        where: topAllocWhere,
        select: { campaignId: true, target: true, achievedCount: true, allocatedBudget: true },
      }),
      this.prisma.targetAllocation.aggregate({
        where: isSuperAdmin
          ? { campaign: { status: "ACTIVE" } }
          : { campaign: { status: "ACTIVE" }, regionId: { in: regionIds } },
        _sum: { spentBudget: true },
      }),
      this.prisma.task.groupBy({
        by: ["status"],
        where: isSuperAdmin ? {} : { assignedTo: { regionId: { in: regionIds } } },
        _count: true,
      }),
      this.prisma.grievance.groupBy({
        by: ["status"],
        where: isSuperAdmin ? {} : { regionId: { in: regionIds } },
        _count: true,
      }),
      this.prisma.expenseRequest.aggregate({
        where: isSuperAdmin
          ? { approvalStatus: "PENDING" }
          : { approvalStatus: "PENDING", submittedBy: { regionId: { in: regionIds } } },
        _sum: { amount: true },
        _count: true,
      }),
      this.prisma.campaign.findMany({
        where: isSuperAdmin
          ? { status: "ACTIVE" }
          : { status: "ACTIVE", allocations: { some: { regionId: user.regionId } } },
        select: { id: true, name: true, status: true, priority: true },
      }),
    ]);

    const target = topAllocations.reduce((s, a) => s + a.target, 0);
    const achieved = topAllocations.reduce((s, a) => s + a.achievedCount, 0);
    const allocatedBudget = topAllocations.reduce((s, a) => s + Number(a.allocatedBudget), 0);
    const spentBudget = Number(spentAgg._sum.spentBudget ?? 0);

    const taskCounts = Object.fromEntries(taskGroups.map((t) => [t.status, t._count]));
    const totalTasks = taskGroups.reduce((s, t) => s + t._count, 0);
    const completedTasks = taskCounts.COMPLETED ?? 0;
    const overdueTasks = taskCounts.OVERDUE ?? 0;

    const grievanceCounts = Object.fromEntries(grievanceGroups.map((g) => [g.status, g._count]));
    const totalGrievances = grievanceGroups.reduce((s, g) => s + g._count, 0);
    const openGrievances = (grievanceCounts.OPEN ?? 0) + (grievanceCounts.IN_PROGRESS ?? 0);
    const resolvedGrievances = grievanceCounts.RESOLVED ?? 0;

    const progressByCampaign = new Map<string, { target: number; achieved: number }>();
    for (const a of topAllocations) {
      const entry = progressByCampaign.get(a.campaignId) ?? { target: 0, achieved: 0 };
      entry.target += a.target;
      entry.achieved += a.achievedCount;
      progressByCampaign.set(a.campaignId, entry);
    }

    const campaignsWithProgress = campaigns.map((c) => {
      const p = progressByCampaign.get(c.id);
      const progressPct = p && p.target > 0 ? Math.round((p.achieved / p.target) * 100) : 0;
      return { id: c.id, name: c.name, status: c.status, priority: c.priority, progressPct };
    });

    const result: Record<string, unknown> = {
      targetAchievementPct: target > 0 ? Math.round((achieved / target) * 100) : 0,
      totalTarget: target,
      totalAchieved: achieved,
      budgetUtilizationPct: allocatedBudget > 0 ? Math.round((spentBudget / allocatedBudget) * 100) : 0,
      totalAllocatedBudget: allocatedBudget,
      totalSpentBudget: spentBudget,
      taskCompletionPct: totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0,
      totalTasks,
      completedTasks,
      overdueTasks,
      openGrievances,
      totalGrievances,
      grievanceResolutionPct: totalGrievances > 0 ? Math.round((resolvedGrievances / totalGrievances) * 100) : 0,
      pendingExpenses: { count: pendingExpenseAgg._count, amount: Number(pendingExpenseAgg._sum.amount ?? 0) },
      campaigns: campaignsWithProgress,
    };

    if (isSuperAdmin) {
      result.regionLeaderboard = await this.regionLeaderboard();
    } else {
      result.myRegionRank = await this.regionRank(user.regionId);
      result.cadreLeaderboard = await this.cadreLeaderboard(regionIds ?? []);
    }

    return result;
  }

  /** Best/worst 3 districts org-wide, by achievement % across active campaigns. */
  private async regionLeaderboard() {
    const rows = await this.prisma.targetAllocation.findMany({
      where: { campaign: { status: "ACTIVE" }, region: { type: "DISTRICT" } },
      include: { region: true },
    });

    const byRegion = new Map<string, { name: string; target: number; achieved: number }>();
    for (const r of rows) {
      const entry = byRegion.get(r.regionId) ?? { name: r.region.name, target: 0, achieved: 0 };
      entry.target += r.target;
      entry.achieved += r.achievedCount;
      byRegion.set(r.regionId, entry);
    }

    const ranked = Array.from(byRegion.entries())
      .map(([regionId, v]) => ({
        regionId,
        regionName: v.name,
        achievementPct: v.target > 0 ? Math.round((v.achieved / v.target) * 100) : 0,
      }))
      .sort((a, b) => b.achievementPct - a.achievementPct);

    return {
      top: ranked.slice(0, 3),
      bottom: ranked.length > 3 ? ranked.slice(-3).reverse() : [],
    };
  }

  /** Where an Admin's own region ranks among its siblings (same parent), by achievement %. */
  private async regionRank(regionId: string) {
    const region = await this.prisma.region.findUnique({ where: { id: regionId } });
    if (!region?.parentId) return null;

    const siblings = await this.prisma.region.findMany({ where: { parentId: region.parentId } });
    const rows = await this.prisma.targetAllocation.findMany({
      where: { campaign: { status: "ACTIVE" }, regionId: { in: siblings.map((s) => s.id) } },
      select: { regionId: true, target: true, achievedCount: true },
    });

    const byRegion = new Map<string, { target: number; achieved: number }>();
    for (const r of rows) {
      const entry = byRegion.get(r.regionId) ?? { target: 0, achieved: 0 };
      entry.target += r.target;
      entry.achieved += r.achievedCount;
      byRegion.set(r.regionId, entry);
    }

    const ranked = siblings
      .map((s) => {
        const v = byRegion.get(s.id) ?? { target: 0, achieved: 0 };
        return { regionId: s.id, achievementPct: v.target > 0 ? Math.round((v.achieved / v.target) * 100) : 0 };
      })
      .sort((a, b) => b.achievementPct - a.achievementPct);

    const rank = ranked.findIndex((r) => r.regionId === regionId) + 1;
    return { rank, of: ranked.length, regionName: region.name };
  }

  /** Cadre completion leaderboard within an Admin's own region subtree, across all campaigns. */
  private async cadreLeaderboard(regionIds: string[]) {
    const cadres = await this.prisma.user.findMany({
      where: { role: "CADRE", regionId: { in: regionIds } },
      select: {
        id: true,
        name: true,
        tasksAssignedTo: { select: { status: true } },
      },
    });

    return cadres
      .map((c) => ({
        id: c.id,
        name: c.name,
        completed: c.tasksAssignedTo.filter((t) => t.status === "COMPLETED").length,
        total: c.tasksAssignedTo.length,
      }))
      .sort((a, b) => b.completed - a.completed)
      .slice(0, 10);
  }
}
