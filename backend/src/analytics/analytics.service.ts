import { Injectable } from "@nestjs/common";
import { RegionType } from "../shared-types";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  async campaignProgress(campaignId: string) {
    const [allocations, tasks, expenses] = await Promise.all([
      this.prisma.targetAllocation.findMany({
        where: { campaignId, parentAllocationId: null },
        select: { target: true, achievedCount: true, allocatedBudget: true, spentBudget: true },
      }),
      this.prisma.task.groupBy({ by: ["status"], where: { campaignId }, _count: true }),
      this.prisma.expenseRequest.aggregate({
        where: { campaignId, approvalStatus: "PENDING" },
        _sum: { amount: true },
      }),
    ]);

    const target = allocations.reduce((s, a) => s + a.target, 0);
    const achieved = allocations.reduce((s, a) => s + a.achievedCount, 0);
    const allocatedBudget = allocations.reduce((s, a) => s + Number(a.allocatedBudget), 0);
    const spentBudget = allocations.reduce((s, a) => s + Number(a.spentBudget), 0);

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
  async regionProgress(campaignId: string, regionType: RegionType) {
    const allocations = await this.prisma.targetAllocation.findMany({
      where: { campaignId, region: { type: regionType } },
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

  async topPerformers(campaignId: string, level: "district" | "cadre") {
    if (level === "district") {
      return this.regionProgress(campaignId, "DISTRICT").then((rows) => rows.slice(0, 5));
    }

    const cadres = await this.prisma.user.findMany({
      where: { role: "CADRE", tasksAssignedTo: { some: { campaignId } } },
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

  async pendingAndOverdue(campaignId: string) {
    const [pending, overdue] = await Promise.all([
      this.prisma.task.findMany({ where: { campaignId, status: "PENDING" } }),
      this.prisma.task.findMany({ where: { campaignId, status: "OVERDUE" } }),
    ]);
    return { pending, overdue };
  }
}
