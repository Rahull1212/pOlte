import { ForbiddenException, Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuthenticatedUser } from "../auth/types";
import { UsersService } from "./users.service";
import { RegionsService } from "../regions/regions.service";

/**
 * One Admin's work at a glance, for a Super Admin reviewing them.
 *
 * Super Admin only. This deliberately reports on somebody else's
 * performance — who reports to them, what they've handed out, whether their
 * messages are landing — which is a supervisory view, not something an
 * Admin should be able to pull on a peer.
 *
 * Every number is counted from real rows. Where a thing genuinely isn't
 * recorded it is reported as null rather than zero, because "no data" and
 * "none" read very differently to someone deciding whether an Admin is
 * pulling their weight.
 */
@Injectable()
export class UserDashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
    private readonly regions: RegionsService,
  ) {}

  async build(userId: string, requester: AuthenticatedUser) {
    if (requester.role !== "SUPER_ADMIN") {
      throw new ForbiddenException("Only a Super Admin can view another user's dashboard");
    }

    // Reuses the scoped lookup, so a missing id still 404s consistently.
    const user = await this.users.findByIdVisibleTo(userId, requester);

    const [directReports, areaCadres, taskCounts, campaigns, messageCounts, recentTasks] = await Promise.all([
      this.prisma.user.groupBy({
        by: ["isActive"],
        where: { parentUserId: userId },
        _count: true,
      }),
      // Everyone in their area, which is usually a wider number than their
      // direct reports — an Admin covering a Constituency is answerable for
      // its Cadres whether or not each one reports to them personally.
      this.regions
        .descendantIds(user.regionId)
        .then((ids) =>
          this.prisma.user.count({ where: { role: "CADRE", isActive: true, regionId: { in: ids } } }),
        ),
      this.prisma.task.groupBy({
        by: ["status"],
        where: { assignedById: userId },
        _count: true,
      }),
      this.prisma.campaignAdmin.findMany({
        where: { adminId: userId },
        select: {
          status: true,
          assignedAt: true,
          respondedAt: true,
          campaign: { select: { id: true, name: true, status: true } },
        },
        orderBy: { assignedAt: "desc" },
      }),
      this.prisma.taskMessageLog.groupBy({
        by: ["status"],
        where: { assignedById: userId },
        _count: true,
      }),
      this.prisma.task.findMany({
        where: { assignedById: userId },
        orderBy: { createdAt: "desc" },
        take: 10,
        select: {
          id: true,
          name: true,
          status: true,
          priority: true,
          deadline: true,
          createdAt: true,
          assignedTo: { select: { id: true, name: true } },
          campaign: { select: { id: true, name: true } },
        },
      }),
    ]);

    const taskCount = (status: string) => taskCounts.find((t) => t.status === status)?._count ?? 0;
    const totalTasks = taskCounts.reduce((sum, t) => sum + t._count, 0);
    const messageCount = (status: string) => messageCounts.find((m) => m.status === status)?._count ?? 0;
    const totalMessages = messageCounts.reduce((sum, m) => sum + m._count, 0);

    return {
      user: {
        id: user.id,
        name: user.name,
        phone: user.phone,
        email: user.email,
        role: user.role,
        isActive: user.isActive,
        createdAt: user.createdAt,
        lastLoginAt: user.lastLoginAt,
        region: user.region,
        createdBy: user.parent ? { id: user.parent.id, name: user.parent.name } : null,
      },
      team: {
        directReports: directReports.reduce((sum, r) => sum + r._count, 0),
        activeDirectReports: directReports.find((r) => r.isActive)?._count ?? 0,
        cadresInArea: areaCadres,
      },
      tasks: {
        total: totalTasks,
        pending: taskCount("PENDING"),
        inProgress: taskCount("IN_PROGRESS"),
        completed: taskCount("COMPLETED"),
        overdue: taskCount("OVERDUE"),
        cancelled: taskCount("CANCELLED"),
        completionPct: totalTasks > 0 ? Math.round((taskCount("COMPLETED") / totalTasks) * 100) : 0,
      },
      campaigns: campaigns.map((c) => ({
        id: c.campaign.id,
        name: c.campaign.name,
        campaignStatus: c.campaign.status,
        assignmentStatus: c.status,
        assignedAt: c.assignedAt,
        respondedAt: c.respondedAt,
      })),
      messages: {
        total: totalMessages,
        // SENT is the provider accepting it; DELIVERED/READ are later stages
        // of the same send, kept separate so the funnel is readable.
        sent: messageCount("SENT"),
        delivered: messageCount("DELIVERED"),
        read: messageCount("READ"),
        failed: messageCount("FAILED"),
      },
      recentTasks,
    };
  }
}
