import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { CreateTaskDto, ProgressUpdateDto, TaskStatus, UpdateTaskDto } from "../shared-types";
import { PrismaService } from "../prisma/prisma.service";
import { AuthenticatedUser } from "../auth/types";
import { AllocationsService } from "../allocations/allocations.service";
import { NotificationsService } from "../notifications/notifications.service";

@Injectable()
export class TasksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly allocationsService: AllocationsService,
    private readonly notificationsService: NotificationsService,
  ) {}

  async create(dto: CreateTaskDto, user: AuthenticatedUser) {
    const assignee = await this.prisma.user.findUnique({ where: { id: dto.assignedToId } });
    if (!assignee) throw new NotFoundException("Assignee not found");
    if (assignee.parentUserId !== user.id && user.role !== "SUPER_ADMIN") {
      throw new ForbiddenException("You can only assign tasks to your own direct reports");
    }

    const task = await this.prisma.task.create({
      data: {
        campaignId: dto.campaignId,
        allocationId: dto.allocationId,
        name: dto.name,
        description: dto.description,
        assignedToId: dto.assignedToId,
        assignedById: user.id,
        deadline: dto.deadline,
        priority: dto.priority,
      },
    });

    await this.notificationsService.notify({
      userId: dto.assignedToId,
      type: "TASK_ASSIGNED",
      title: "New task assigned",
      message: `${task.name} — due ${task.deadline.toDateString()}`,
      relatedEntityType: "Task",
      relatedEntityId: task.id,
    });

    return task;
  }

  findMany(filters: { assignedToId?: string; status?: TaskStatus; campaignId?: string }) {
    return this.prisma.task.findMany({
      where: filters,
      include: { assignedTo: { select: { id: true, name: true } } },
      orderBy: { deadline: "asc" },
    });
  }

  async findById(id: string) {
    const task = await this.prisma.task.findUnique({
      where: { id },
      include: { progress: { orderBy: { createdAt: "desc" } }, attachments: true },
    });
    if (!task) throw new NotFoundException("Task not found");
    return task;
  }

  async update(id: string, dto: UpdateTaskDto) {
    await this.findById(id);
    return this.prisma.task.update({ where: { id }, data: dto as any });
  }

  /**
   * Cadre submits a cumulative progress snapshot. We diff against the
   * previous snapshot for this task and only propagate the delta up the
   * allocation tree, so re-submitting the same total never double-counts.
   */
  async submitProgress(taskId: string, dto: ProgressUpdateDto, user: AuthenticatedUser) {
    const task = await this.prisma.task.findUnique({ where: { id: taskId } });
    if (!task) throw new NotFoundException("Task not found");
    if (task.assignedToId !== user.id) {
      throw new ForbiddenException("You can only update progress on your own tasks");
    }

    const previous = await this.prisma.progressUpdate.findFirst({
      where: { taskId },
      orderBy: { createdAt: "desc" },
    });

    const metric = (u: { completedForms?: number | null; houseVisits?: number | null; meetingsConducted?: number | null; volunteersJoined?: number | null } | null) =>
      u?.completedForms ?? u?.houseVisits ?? u?.meetingsConducted ?? u?.volunteersJoined ?? 0;

    const previousValue = metric(previous);
    const newValue = metric(dto);
    const delta = newValue - previousValue;

    const progress = await this.prisma.progressUpdate.create({
      data: { ...dto, taskId, cadreId: user.id },
    });

    if (task.allocationId && delta !== 0) {
      await this.allocationsService.propagateAchievedDelta(task.allocationId, delta);
    }

    if (dto.completionPercentage >= 100) {
      await this.prisma.task.update({ where: { id: taskId }, data: { status: "COMPLETED" } });
    } else if (task.status === "PENDING") {
      await this.prisma.task.update({ where: { id: taskId }, data: { status: "IN_PROGRESS" } });
    }

    return progress;
  }
}
