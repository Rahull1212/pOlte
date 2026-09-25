import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { TasksService } from "../tasks/tasks.service";
import { NotificationsService } from "../notifications/notifications.service";
import { AuthenticatedUser } from "../auth/types";

/**
 * The Cadre Agent's tool implementations (Part 8 of the spec). Every method
 * takes the CURRENT AUTHENTICATED CADRE as `user` and closes over it for
 * every ownership check — the LLM only ever supplies a taskId (or nothing),
 * never a userId/cadreId, so there is no code path by which one Cadre's
 * agent session can read or modify another Cadre's assignments. Ownership
 * itself is enforced twice: once here (return a safe error object instead
 * of throwing, so the agent can explain it to the Cadre) and again inside
 * TasksService's own methods (acknowledge/submitProgress/startAssignment
 * already throw ForbiddenException on mismatch) as a second, independent
 * layer.
 *
 * No new business logic lives here — every tool is a thin, scope-checked
 * wrapper around TasksService, which remains the single source of truth for
 * the assignment lifecycle.
 */
@Injectable()
export class CadreToolsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tasksService: TasksService,
    private readonly notificationsService: NotificationsService,
  ) {}

  private async ownedTask(taskId: string, user: AuthenticatedUser) {
    const task = await this.prisma.task.findUnique({ where: { id: taskId } });
    if (!task || task.assignedToId !== user.id) return null;
    return task;
  }

  async getMyProfile(user: AuthenticatedUser) {
    const u = await this.prisma.user.findUnique({
      where: { id: user.id },
      select: { name: true, phone: true, region: { select: { name: true, type: true } } },
    });
    if (!u) return { error: "Profile not found." };
    return { name: u.name, phone: u.phone, area: `${u.region.name} (${u.region.type})` };
  }

  async getMyAssignments(user: AuthenticatedUser, includeCompleted = false) {
    const tasks = await this.tasksService.findMany({ assignedToId: user.id }, user);
    const filtered = includeCompleted ? tasks : tasks.filter((t) => t.status !== "COMPLETED" && t.status !== "CANCELLED");
    return filtered.map((t) => ({
      taskId: t.id,
      name: t.name,
      status: t.status,
      priority: t.priority,
      deadline: t.deadline,
      acknowledgment: t.acknowledgment,
    }));
  }

  async getAssignmentDetails(taskId: string, user: AuthenticatedUser) {
    const task = await this.ownedTask(taskId, user);
    if (!task) return { error: "Assignment not found, or it isn't yours." };
    return {
      taskId: task.id,
      name: task.name,
      objective: task.objective,
      description: task.description,
      deadline: task.deadline,
      priority: task.priority,
      status: task.status,
      acknowledgment: task.acknowledgment,
    };
  }

  async getAssignmentProgress(taskId: string, user: AuthenticatedUser) {
    const task = await this.ownedTask(taskId, user);
    if (!task) return { error: "Assignment not found, or it isn't yours." };
    const latest = await this.prisma.progressUpdate.findFirst({ where: { taskId }, orderBy: { createdAt: "desc" } });
    return {
      taskId,
      status: task.status,
      completionPercentage: latest?.completionPercentage ?? (task.status === "COMPLETED" ? 100 : 0),
    };
  }

  async acceptAssignment(taskId: string, user: AuthenticatedUser) {
    const task = await this.ownedTask(taskId, user);
    if (!task) return { error: "Assignment not found, or it isn't yours." };
    await this.tasksService.acknowledge(taskId, "ACCEPTED", user);
    return { success: true, message: "Assignment accepted." };
  }

  async declineAssignment(taskId: string, user: AuthenticatedUser) {
    const task = await this.ownedTask(taskId, user);
    if (!task) return { error: "Assignment not found, or it isn't yours." };
    await this.tasksService.acknowledge(taskId, "DECLINED", user);
    return { success: true, message: "Assignment declined. Your Admin has been notified." };
  }

  async startAssignment(taskId: string, user: AuthenticatedUser) {
    try {
      await this.tasksService.startAssignment(taskId, user);
      return { success: true, message: "Assignment started." };
    } catch (err) {
      return { error: (err as Error).message };
    }
  }

  async submitAssignment(taskId: string, completionPercentage: number, user: AuthenticatedUser) {
    const task = await this.ownedTask(taskId, user);
    if (!task) return { error: "Assignment not found, or it isn't yours." };
    if (completionPercentage < 0 || completionPercentage > 100) {
      return { error: "completionPercentage must be between 0 and 100." };
    }
    await this.tasksService.submitProgress(taskId, { completionPercentage, photos: [], videos: [] }, user);
    return { success: true, message: `Progress updated to ${completionPercentage}%.` };
  }

  /** "I can't complete this today" / "I'm traveling" / "I have an emergency" — notifies the Admin who assigned it rather than silently leaving the task stalled. */
  async raiseAssignmentException(taskId: string, reason: string, user: AuthenticatedUser) {
    const task = await this.ownedTask(taskId, user);
    if (!task) return { error: "Assignment not found, or it isn't yours." };
    await this.notificationsService.notify({
      userId: task.assignedById,
      type: "TASK_DECLINED",
      title: "Cadre reported an issue",
      message: `${user.name} reported an issue with "${task.name}": ${reason}`,
      relatedEntityType: "Task",
      relatedEntityId: task.id,
    });
    return { success: true, message: "Your Admin has been notified." };
  }

  async getMyTaskHistory(user: AuthenticatedUser, sinceDays?: number) {
    const tasks = await this.tasksService.findMany({ assignedToId: user.id, status: "COMPLETED" }, user);
    const cutoff = sinceDays ? new Date(Date.now() - sinceDays * 86400000) : null;
    const filtered = cutoff ? tasks.filter((t) => t.completedAt && t.completedAt >= cutoff) : tasks;
    return filtered.map((t) => ({ taskId: t.id, name: t.name, completedAt: t.completedAt }));
  }

  async getTaskInstructions(taskId: string, user: AuthenticatedUser) {
    const task = await this.ownedTask(taskId, user);
    if (!task) return { error: "Assignment not found, or it isn't yours." };
    return {
      taskId,
      objective: task.objective,
      description: task.description,
      remarks: task.remarks,
    };
  }
}
