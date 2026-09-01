import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { CreateTaskBatchDto, CreateTaskDto, ProgressUpdateDto, TaskStatus, UpdateTaskDto } from "../shared-types";
import { PrismaService } from "../prisma/prisma.service";
import { AuthenticatedUser } from "../auth/types";
import { AllocationsService } from "../allocations/allocations.service";
import { NotificationsService } from "../notifications/notifications.service";
import { RegionsService } from "../regions/regions.service";
import { AiService } from "../ai/ai.service";

@Injectable()
export class TasksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly allocationsService: AllocationsService,
    private readonly notificationsService: NotificationsService,
    private readonly regionsService: RegionsService,
    private readonly aiService: AiService,
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
      message: `${task.name} — due ${task.deadline.toDateString()}. Reply YES to accept or NO to decline.`,
      relatedEntityType: "Task",
      relatedEntityId: task.id,
    });

    return task;
  }

  /**
   * One "Create Task" submission fans out to every active Cadre under the
   * selected District(s)/Mandal(s)/Booth(s) — one Task row per resolved
   * Cadre, grouped under a TaskBatch. Reuses the exact same Task/
   * ProgressUpdate/WhatsApp-notification machinery as a single-assignee
   * task; nothing about how a Cadre completes or is notified about a task
   * changes, only how many get created and assigned in one action.
   *
   * A SUPER_ADMIN's batch is the one exception: it does NOT fan out to
   * Cadres immediately. It's routed to whichever Admins cover the selected
   * area(s) (awaitingAllocation: true, zero Task rows) — each Admin reviews
   * it and allocates it to their own Cadres via allocateToCadres(), which is
   * what actually creates the Task rows and sends the WhatsApp messages. An
   * ADMIN creating a task still goes straight to Cadres, unchanged.
   */
  async createBatch(dto: CreateTaskBatchDto, user: AuthenticatedUser) {
    if (user.role !== "SUPER_ADMIN") {
      for (const regionId of dto.regionIds) {
        const withinScope = await this.regionsService.isWithinScope(user.regionId, regionId);
        if (!withinScope) {
          throw new ForbiddenException("One or more selected areas are outside your own area");
        }
      }
    }

    if (user.role === "SUPER_ADMIN") {
      const batch = await this.prisma.taskBatch.create({
        data: {
          name: dto.name,
          objective: dto.objective,
          description: dto.description,
          additionalDetails: dto.additionalDetails,
          remarks: dto.remarks,
          deadline: dto.deadline,
          priority: dto.priority,
          campaignId: dto.campaignId,
          targetRegionIds: dto.regionIds,
          attachmentUrls: dto.attachmentUrls,
          createdById: user.id,
          awaitingAllocation: true,
        },
      });

      const admins = await this.findAdminsForRegions(dto.regionIds);
      if (admins.length > 0) {
        await this.notificationsService.notifyMany(
          admins.map((a) => a.id),
          {
            type: "TASK_PENDING_ALLOCATION",
            title: "Task awaiting your allocation",
            message: `"${dto.name}" was routed to your area — review it and allocate it to your Cadres.`,
            relatedEntityType: "Task",
            relatedEntityId: batch.id,
          },
        );
      }

      return { batch, cadreCount: 0, awaitingAllocation: true };
    }

    const descendantSets = await Promise.all(dto.regionIds.map((id) => this.regionsService.descendantIds(id)));
    const scopedRegionIds = Array.from(new Set(descendantSets.flat()));

    const cadres = await this.prisma.user.findMany({
      where: { role: "CADRE", isActive: true, regionId: { in: scopedRegionIds } },
      select: { id: true },
    });
    if (cadres.length === 0) {
      throw new BadRequestException("No active Cadres found in the selected area(s)");
    }

    const batch = await this.prisma.taskBatch.create({
      data: {
        name: dto.name,
        objective: dto.objective,
        description: dto.description,
        additionalDetails: dto.additionalDetails,
        remarks: dto.remarks,
        deadline: dto.deadline,
        priority: dto.priority,
        campaignId: dto.campaignId,
        targetRegionIds: dto.regionIds,
        attachmentUrls: dto.attachmentUrls,
        createdById: user.id,
      },
    });

    await this.prisma.$transaction(
      cadres.map((cadre) =>
        this.prisma.task.create({
          data: {
            batchId: batch.id,
            campaignId: dto.campaignId,
            name: dto.name,
            objective: dto.objective,
            description: dto.description,
            additionalDetails: dto.additionalDetails,
            remarks: dto.remarks,
            assignedToId: cadre.id,
            assignedById: user.id,
            deadline: dto.deadline,
            priority: dto.priority,
          },
        }),
      ),
    );

    await this.notificationsService.notifyMany(
      cadres.map((c) => c.id),
      {
        type: "TASK_ASSIGNED",
        title: "New task assigned",
        message: `${dto.name} — due ${dto.deadline.toDateString()}. Reply YES to accept or NO to decline.`,
        relatedEntityType: "Task",
        relatedEntityId: batch.id,
      },
    );

    return { batch, cadreCount: cadres.length, awaitingAllocation: false };
  }

  /**
   * An Admin allocating a Super-Admin-routed batch (awaitingAllocation:
   * true) to their own Cadres. Resolves every active Cadre under the
   * selected area(s) — same resolution as createBatch — skipping anyone
   * already assigned under this batch (another Admin may have already
   * allocated an overlapping area), creates their Task rows, and sends the
   * same WhatsApp YES/NO notification a directly-created task would.
   */
  async allocateToCadres(batchId: string, regionIds: string[], user: AuthenticatedUser) {
    if (user.role !== "ADMIN") {
      throw new ForbiddenException("Only Admins allocate tasks to Cadres");
    }

    const batch = await this.prisma.taskBatch.findUnique({ where: { id: batchId } });
    if (!batch) throw new NotFoundException("Task not found");
    if (!batch.awaitingAllocation) {
      throw new BadRequestException("This task does not require allocation");
    }

    for (const regionId of regionIds) {
      const withinAdminScope = await this.regionsService.isWithinScope(user.regionId, regionId);
      if (!withinAdminScope) {
        throw new ForbiddenException("One or more selected areas are outside your own area");
      }
      const relatesToTarget = await Promise.all(
        batch.targetRegionIds.map(
          async (t) =>
            (await this.regionsService.isWithinScope(t, regionId)) || (await this.regionsService.isWithinScope(regionId, t)),
        ),
      );
      if (!relatesToTarget.some(Boolean)) {
        throw new ForbiddenException("Selected areas must be within this task's original target area(s)");
      }
    }

    const descendantSets = await Promise.all(regionIds.map((id) => this.regionsService.descendantIds(id)));
    const scopedRegionIds = Array.from(new Set(descendantSets.flat()));

    const existingAssignees = await this.prisma.task.findMany({ where: { batchId }, select: { assignedToId: true } });
    const alreadyAssigned = existingAssignees.map((t) => t.assignedToId);

    const cadres = await this.prisma.user.findMany({
      where: { role: "CADRE", isActive: true, regionId: { in: scopedRegionIds }, id: { notIn: alreadyAssigned } },
      select: { id: true },
    });
    if (cadres.length === 0) {
      throw new BadRequestException("No new active Cadres found in the selected area(s)");
    }

    await this.prisma.$transaction(
      cadres.map((cadre) =>
        this.prisma.task.create({
          data: {
            batchId: batch.id,
            campaignId: batch.campaignId,
            name: batch.name,
            objective: batch.objective,
            description: batch.description,
            additionalDetails: batch.additionalDetails,
            remarks: batch.remarks,
            assignedToId: cadre.id,
            assignedById: user.id,
            deadline: batch.deadline,
            priority: batch.priority,
          },
        }),
      ),
    );

    await this.notificationsService.notifyMany(
      cadres.map((c) => c.id),
      {
        type: "TASK_ASSIGNED",
        title: "New task assigned",
        message: `${batch.name} — due ${batch.deadline.toDateString()}. Reply YES to accept or NO to decline.`,
        relatedEntityType: "Task",
        relatedEntityId: batch.id,
      },
    );

    await this.notificationsService.notify({
      userId: batch.createdById,
      type: "TASK_ALLOCATED",
      title: "Task allocated to Cadres",
      message: `${user.name} allocated "${batch.name}" to ${cadres.length} Cadre${cadres.length === 1 ? "" : "s"}.`,
      relatedEntityType: "Task",
      relatedEntityId: batch.id,
    });

    return { cadreCount: cadres.length };
  }

  /**
   * Every task-creation unit a Super Admin routed to Admins (awaitingAllocation:
   * true) that still has at least one active Cadre, within both this Admin's
   * own region scope AND the batch's original target area, who hasn't been
   * allocated a Task yet. Using "still has an unallocated eligible Cadre"
   * rather than "this Admin hasn't allocated anyone" matters when scopes
   * nest — e.g. a District Admin's scope contains a Mandal Admin's: once the
   * Mandal Admin allocates their Cadres, the batch must stay pending for the
   * District Admin if other Mandals in the District still need allocating,
   * and only actually drop off once no eligible Cadre is left anywhere.
   */
  async listPendingAllocation(user: AuthenticatedUser) {
    if (user.role !== "ADMIN") return [];

    const adminScopeIds = new Set(await this.regionsService.descendantIds(user.regionId));

    const batches = await this.prisma.taskBatch.findMany({
      where: { awaitingAllocation: true },
      include: {
        createdBy: { select: { name: true } },
        tasks: { select: { assignedToId: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    const pending: typeof batches = [];
    for (const b of batches) {
      const hasUnallocated = await this.hasUnallocatedEligibleCadre(b, user.regionId, adminScopeIds);
      if (hasUnallocated) pending.push(b);
    }
    if (pending.length === 0) return [];

    const allTargetRegionIds = Array.from(new Set(pending.flatMap((b) => b.targetRegionIds)));
    const regions = await this.prisma.region.findMany({
      where: { id: { in: allTargetRegionIds } },
      select: { id: true, name: true, type: true },
    });
    const regionMap = new Map(regions.map((r) => [r.id, r]));

    return pending.map((b) => ({
      id: b.id,
      name: b.name,
      objective: b.objective,
      description: b.description,
      districts: b.targetRegionIds
        .map((id) => regionMap.get(id))
        .filter((r): r is NonNullable<typeof r> => Boolean(r))
        .map((r) => `${r.name} (${r.type})`),
      deadline: b.deadline,
      priority: b.priority,
      createdByName: b.createdBy.name,
      createdAt: b.createdAt,
    }));
  }

  /**
   * True if there's still at least one active Cadre, within both this
   * Admin's own region scope and the batch's original target area, who
   * hasn't been allocated a Task yet under this batch. This is what
   * actually decides whether the Admin still has an allocation action
   * available — not just "have they allocated anyone yet" — so it stays
   * true for a broader-scoped Admin even after a narrower nested Admin has
   * allocated their own slice.
   */
  private async hasUnallocatedEligibleCadre(
    batch: { targetRegionIds: string[]; tasks: { assignedToId: string }[] },
    adminRegionId: string,
    adminScopeIds: Set<string>,
  ): Promise<boolean> {
    const targetDescendantSets = await Promise.all(batch.targetRegionIds.map((id) => this.regionsService.descendantIds(id)));
    const targetScope = new Set(targetDescendantSets.flat());
    const eligibleRegionIds = Array.from(adminScopeIds).filter((id) => targetScope.has(id));
    if (eligibleRegionIds.length === 0) return false;

    const unallocatedCadre = await this.prisma.user.findFirst({
      where: {
        role: "CADRE",
        isActive: true,
        regionId: { in: eligibleRegionIds },
        id: { notIn: batch.tasks.map((t) => t.assignedToId) },
      },
      select: { id: true },
    });
    return Boolean(unallocatedCadre);
  }

  /** True if any of targetRegionIds is inside the Admin's scope, or the Admin's own region is inside one of them. */
  private async targetOverlapsAdminScope(
    targetRegionIds: string[],
    adminRegionId: string,
    adminScopeIds: Set<string>,
  ): Promise<boolean> {
    if (targetRegionIds.some((t) => adminScopeIds.has(t))) return true;
    const targetDescendantSets = await Promise.all(targetRegionIds.map((id) => this.regionsService.descendantIds(id)));
    return targetDescendantSets.some((set) => set.includes(adminRegionId));
  }

  /** Every active Admin whose own region scope overlaps any of the given target region(s). */
  private async findAdminsForRegions(targetRegionIds: string[]): Promise<{ id: string }[]> {
    const admins = await this.prisma.user.findMany({
      where: { role: "ADMIN", isActive: true },
      select: { id: true, regionId: true },
    });

    const targetDescendantSets = await Promise.all(targetRegionIds.map((id) => this.regionsService.descendantIds(id)));
    const targetScope = new Set(targetDescendantSets.flat());

    const matches: { id: string }[] = [];
    for (const admin of admins) {
      if (targetScope.has(admin.regionId)) {
        matches.push({ id: admin.id });
        continue;
      }
      const adminDescendants = await this.regionsService.descendantIds(admin.regionId);
      if (targetRegionIds.some((t) => adminDescendants.includes(t))) {
        matches.push({ id: admin.id });
      }
    }
    return matches;
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
   * A Cadre accepts or declines a task assigned to them — via the web, or
   * (the primary path) replying YES/NO on WhatsApp. Declining flags the
   * task for reassignment and immediately notifies whoever assigned it,
   * rather than silently sitting unactioned.
   */
  async acknowledge(taskId: string, acknowledgment: "ACCEPTED" | "DECLINED", user: AuthenticatedUser) {
    const task = await this.prisma.task.findUnique({ where: { id: taskId } });
    if (!task) throw new NotFoundException("Task not found");
    if (task.assignedToId !== user.id) {
      throw new ForbiddenException("You can only respond to your own tasks");
    }

    const updated = await this.prisma.task.update({
      where: { id: taskId },
      data: {
        acknowledgment,
        acknowledgedAt: new Date(),
        needsReassignment: acknowledgment === "DECLINED",
      },
    });

    if (acknowledgment === "DECLINED") {
      await this.notificationsService.notify({
        userId: task.assignedById,
        type: "TASK_DECLINED",
        title: "Task declined",
        message: `${user.name} declined "${task.name}" — it needs reassignment.`,
        relatedEntityType: "Task",
        relatedEntityId: task.id,
      });
    }

    return updated;
  }

  /** Every Task currently awaiting a YES/NO response from this Cadre, most recent first. */
  findAwaitingAcknowledgment(cadreId: string) {
    return this.prisma.task.findMany({
      where: { assignedToId: cadreId, acknowledgment: "AWAITING" },
      orderBy: { createdAt: "desc" },
    });
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

  private progressPct(t: { status: TaskStatus; progress: { completionPercentage: number }[] }) {
    return t.progress[0]?.completionPercentage ?? (t.status === "COMPLETED" ? 100 : 0);
  }

  private summarizeStatus(tasks: { status: TaskStatus; needsReassignment: boolean }[]): string {
    if (tasks.some((t) => t.needsReassignment)) return "NEEDS_ATTENTION";
    if (tasks.every((t) => t.status === "COMPLETED")) return "COMPLETED";
    if (tasks.some((t) => t.status === "OVERDUE")) return "OVERDUE";
    if (tasks.some((t) => t.status === "IN_PROGRESS" || t.status === "PENDING")) {
      return tasks.some((t) => t.status === "IN_PROGRESS") ? "IN_PROGRESS" : "PENDING";
    }
    return "PENDING";
  }

  /** Admin sees a task only if at least one assignee falls within their own region subtree. */
  private async assertVisible(assigneeRegionIds: string[], user: AuthenticatedUser) {
    if (user.role === "SUPER_ADMIN") return;
    const scoped = new Set(await this.regionsService.descendantIds(user.regionId));
    if (!assigneeRegionIds.some((id) => scoped.has(id))) {
      throw new ForbiddenException("This task is outside your area");
    }
  }

  /**
   * A TaskBatch has no assignees at all while awaitingAllocation and
   * un-allocated — assertVisible's assignee-based check can't apply, so an
   * Admin instead needs the original target area to overlap their own scope
   * (same rule as listPendingAllocation). Once at least one Cadre has been
   * allocated, falls back to the normal assignee-based check.
   */
  private async assertBatchVisible(
    batch: { targetRegionIds: string[]; tasks: { assignedTo: { regionId: string } }[] },
    user: AuthenticatedUser,
  ) {
    if (user.role === "SUPER_ADMIN") return;
    if (batch.tasks.length > 0) {
      await this.assertVisible(batch.tasks.map((t) => t.assignedTo.regionId), user);
      return;
    }
    const adminScopeIds = new Set(await this.regionsService.descendantIds(user.regionId));
    const overlaps = await this.targetOverlapsAdminScope(batch.targetRegionIds, user.regionId, adminScopeIds);
    if (!overlaps) {
      throw new ForbiddenException("This task is outside your area");
    }
  }

  /**
   * The main Tasks page: every task-creation unit (a bulk TaskBatch, or a
   * legacy single-assignee Task never part of a batch) as one row, region-
   * scoped to the caller.
   */
  async listTasks(user: AuthenticatedUser) {
    const regionIds = user.role === "SUPER_ADMIN" ? undefined : await this.regionsService.descendantIds(user.regionId);

    const tasks = await this.prisma.task.findMany({
      where: regionIds ? { assignedTo: { regionId: { in: regionIds } } } : undefined,
      include: {
        assignedTo: { select: { name: true, region: { select: { name: true, type: true } } } },
        batch: { select: { id: true, name: true, deadline: true, priority: true, createdAt: true, targetRegionIds: true } },
        progress: { orderBy: { createdAt: "desc" }, take: 1 },
      },
      orderBy: { createdAt: "desc" },
    });

    const batchGroups = new Map<string, typeof tasks>();
    const individual: typeof tasks = [];
    for (const t of tasks) {
      if (t.batchId && t.batch) {
        const arr = batchGroups.get(t.batchId) ?? [];
        arr.push(t);
        batchGroups.set(t.batchId, arr);
      } else {
        individual.push(t);
      }
    }

    // Batches this Super Admin routed to Admins that no one has allocated a
    // Cadre from yet — they have zero Task rows, so they'd otherwise be
    // invisible on this list entirely. Once an Admin allocates the first
    // Cadre, the batch has Task rows and shows up through the grouping
    // above instead, so this only ever surfaces the still-fully-pending ones.
    const emptyAwaitingBatches =
      user.role === "SUPER_ADMIN"
        ? await this.prisma.taskBatch.findMany({
            where: { awaitingAllocation: true, createdById: user.id, tasks: { none: {} } },
            select: { id: true, name: true, targetRegionIds: true, deadline: true, priority: true, createdAt: true },
            orderBy: { createdAt: "desc" },
          })
        : [];

    const allTargetRegionIds = Array.from(
      new Set([
        ...Array.from(batchGroups.values()).flatMap((g) => g[0].batch!.targetRegionIds),
        ...emptyAwaitingBatches.flatMap((b) => b.targetRegionIds),
      ]),
    );
    const regions = await this.prisma.region.findMany({
      where: { id: { in: allTargetRegionIds } },
      select: { id: true, name: true, type: true },
    });
    const regionMap = new Map(regions.map((r) => [r.id, r]));

    const awaitingRows = emptyAwaitingBatches.map((b) => ({
      id: b.id,
      isBatch: true,
      name: b.name,
      districts: b.targetRegionIds
        .map((id) => regionMap.get(id))
        .filter((r): r is NonNullable<typeof r> => Boolean(r))
        .map((r) => `${r.name} (${r.type})`),
      assignedCount: 0,
      assignedNames: [] as string[],
      deadline: b.deadline,
      priority: b.priority,
      status: "AWAITING_ALLOCATION",
      progressPct: 0,
      createdAt: b.createdAt,
    }));

    const batchRows = Array.from(batchGroups.entries()).map(([batchId, group]) => {
      const b = group[0].batch!;
      const districts = b.targetRegionIds
        .map((id) => regionMap.get(id))
        .filter((r): r is NonNullable<typeof r> => Boolean(r))
        .map((r) => `${r.name} (${r.type})`);
      return {
        id: batchId,
        isBatch: true,
        name: b.name,
        districts,
        assignedCount: group.length,
        assignedNames: group.map((t) => t.assignedTo.name),
        deadline: b.deadline,
        priority: b.priority,
        status: this.summarizeStatus(group),
        progressPct: Math.round(group.reduce((s, t) => s + this.progressPct(t), 0) / group.length),
        createdAt: b.createdAt,
      };
    });

    const individualRows = individual.map((t) => ({
      id: t.id,
      isBatch: false,
      name: t.name,
      districts: [`${t.assignedTo.region.name} (${t.assignedTo.region.type})`],
      assignedCount: 1,
      assignedNames: [t.assignedTo.name],
      deadline: t.deadline,
      priority: t.priority,
      status: this.summarizeStatus([t]),
      progressPct: this.progressPct(t),
      createdAt: t.createdAt,
    }));

    return [...batchRows, ...awaitingRows, ...individualRows].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
  }

  /** Full detail for one task-creation unit — a TaskBatch, or (fallback) a single legacy Task. */
  async getTaskDetail(id: string, user: AuthenticatedUser) {
    const batch = await this.prisma.taskBatch.findUnique({
      where: { id },
      include: {
        createdBy: { select: { name: true } },
        tasks: {
          include: { assignedTo: { select: { id: true, name: true, regionId: true, region: { select: { name: true, type: true } } } } },
        },
      },
    });

    if (batch) {
      await this.assertBatchVisible(batch, user);

      const regions = await this.prisma.region.findMany({
        where: { id: { in: batch.targetRegionIds } },
        select: { name: true, type: true },
      });

      // "Can I still allocate this?" is admin-specific, not just "has anyone
      // allocated yet" — a broader-scoped Admin can still have eligible
      // Cadres left even after a narrower nested Admin has allocated theirs.
      const canAllocate =
        user.role === "ADMIN" && batch.awaitingAllocation
          ? await this.hasUnallocatedEligibleCadre(
              batch,
              user.regionId,
              new Set(await this.regionsService.descendantIds(user.regionId)),
            )
          : false;

      return {
        id: batch.id,
        isBatch: true,
        awaitingAllocation: canAllocate,
        name: batch.name,
        objective: batch.objective,
        description: batch.description,
        additionalDetails: batch.additionalDetails,
        remarks: batch.remarks,
        districts: regions.filter((r) => r.type === "DISTRICT").map((r) => r.name),
        mandals: regions.filter((r) => r.type === "MANDAL").map((r) => r.name),
        booths: regions.filter((r) => r.type === "BOOTH").map((r) => r.name),
        assignedMembers: batch.tasks.map((t) => ({
          id: t.assignedTo.id,
          name: t.assignedTo.name,
          area: `${t.assignedTo.region.name} (${t.assignedTo.region.type})`,
        })),
        deadline: batch.deadline,
        priority: batch.priority,
        attachmentUrls: batch.attachmentUrls,
        createdByName: batch.createdBy.name,
        createdAt: batch.createdAt,
        currentStatus: batch.awaitingAllocation && batch.tasks.length === 0 ? "AWAITING_ALLOCATION" : this.summarizeStatus(batch.tasks),
      };
    }

    const task = await this.prisma.task.findUnique({
      where: { id },
      include: {
        assignedTo: { select: { id: true, name: true, regionId: true, region: { select: { name: true, type: true } } } },
        assignedBy: { select: { name: true } },
        attachments: true,
      },
    });
    if (!task) throw new NotFoundException("Task not found");
    await this.assertVisible([task.assignedTo.regionId], user);

    return {
      id: task.id,
      isBatch: false,
      awaitingAllocation: false,
      name: task.name,
      objective: task.objective,
      description: task.description,
      additionalDetails: task.additionalDetails,
      remarks: task.remarks,
      districts: task.assignedTo.region.type === "DISTRICT" ? [task.assignedTo.region.name] : [],
      mandals: task.assignedTo.region.type === "MANDAL" ? [task.assignedTo.region.name] : [],
      booths: task.assignedTo.region.type === "BOOTH" ? [task.assignedTo.region.name] : [],
      assignedMembers: [
        { id: task.assignedTo.id, name: task.assignedTo.name, area: `${task.assignedTo.region.name} (${task.assignedTo.region.type})` },
      ],
      deadline: task.deadline,
      priority: task.priority,
      attachmentUrls: task.attachments.map((a) => a.url),
      createdByName: task.assignedBy.name,
      createdAt: task.createdAt,
      currentStatus: this.summarizeStatus([task]),
    };
  }

  /**
   * The Task Dashboard: KPIs, per-cadre ("WhatsApp Responses") breakdown,
   * and a day-by-day progress trend built from real ProgressUpdate rows —
   * scoped to exactly one task-creation unit, never the whole org.
   */
  async getTaskDashboard(id: string, user: AuthenticatedUser) {
    const batch = await this.prisma.taskBatch.findUnique({
      where: { id },
      include: {
        tasks: {
          include: {
            assignedTo: { select: { id: true, name: true, regionId: true, region: { select: { name: true, type: true } } } },
            progress: { orderBy: { createdAt: "desc" } },
          },
        },
      },
    });

    let tasks: {
      id: string;
      status: TaskStatus;
      acknowledgment: string;
      acknowledgedAt: Date | null;
      needsReassignment: boolean;
      assignedTo: { id: string; name: string; regionId: string; region: { name: string; type: string } };
      progress: { completionPercentage: number; createdAt: Date }[];
    }[];
    let name: string;
    let remarks: string | null;
    let isBatch: boolean;

    if (batch) {
      await this.assertBatchVisible(batch, user);
      tasks = batch.tasks;
      name = batch.name;
      remarks = batch.remarks;
      isBatch = true;
    } else {
      const task = await this.prisma.task.findUnique({
        where: { id },
        include: {
          assignedTo: { select: { id: true, name: true, regionId: true, region: { select: { name: true, type: true } } } },
          progress: { orderBy: { createdAt: "desc" } },
        },
      });
      if (!task) throw new NotFoundException("Task not found");
      await this.assertVisible([task.assignedTo.regionId], user);
      tasks = [task];
      name = task.name;
      remarks = task.remarks;
      isBatch = false;
    }

    const kpis = {
      totalAssigned: tasks.length,
      accepted: tasks.filter((t) => t.acknowledgment === "ACCEPTED").length,
      declined: tasks.filter((t) => t.acknowledgment === "DECLINED").length,
      noResponse: tasks.filter((t) => t.acknowledgment === "AWAITING").length,
      needsReassignment: tasks.filter((t) => t.needsReassignment).length,
      pending: tasks.filter((t) => t.status === "PENDING").length,
      inProgress: tasks.filter((t) => t.status === "IN_PROGRESS").length,
      completed: tasks.filter((t) => t.status === "COMPLETED").length,
      overdue: tasks.filter((t) => t.status === "OVERDUE").length,
      avgProgressPct:
        tasks.length > 0 ? Math.round(tasks.reduce((s, t) => s + this.progressPct(t), 0) / tasks.length) : 0,
    };

    const cadres = tasks.map((t) => ({
      taskId: t.id,
      name: t.assignedTo.name,
      area: `${t.assignedTo.region.name} (${t.assignedTo.region.type})`,
      status: t.status,
      acknowledgment: t.acknowledgment,
      acknowledgedAt: t.acknowledgedAt,
      needsReassignment: t.needsReassignment,
      progressPct: this.progressPct(t),
    }));

    const byDay = new Map<string, { count: number; sumPct: number }>();
    for (const t of tasks) {
      for (const p of t.progress) {
        const day = p.createdAt.toISOString().slice(0, 10);
        const entry = byDay.get(day) ?? { count: 0, sumPct: 0 };
        entry.count += 1;
        entry.sumPct += p.completionPercentage;
        byDay.set(day, entry);
      }
    }
    const dailyProgress = Array.from(byDay.entries())
      .map(([date, v]) => ({ date, updatesSubmitted: v.count, avgCompletionPct: Math.round(v.sumPct / v.count) }))
      .sort((a, b) => a.date.localeCompare(b.date));

    return { id, isBatch, name, remarks, kpis, cadres, dailyProgress };
  }

  /**
   * Generates the "AI Task Insights" + "Follow-up requirements" sections
   * from the real dashboard bundle above — persisted only for batches
   * (AIInsight.taskBatchId), since that's the only real fan-out data this
   * app currently has; a legacy single-assignee task still gets a live
   * analysis, just not saved for later.
   */
  async generateInsights(id: string, user: AuthenticatedUser) {
    const dashboard = await this.getTaskDashboard(id, user);
    const { insight, followUp } = await this.aiService.generateTaskInsight({
      name: dashboard.name,
      kpis: dashboard.kpis,
      cadres: dashboard.cadres.map((c) => ({ name: c.name, status: c.status, acknowledgment: c.acknowledgment, progressPct: c.progressPct })),
    });

    if (dashboard.isBatch) {
      await this.prisma.$transaction([
        this.prisma.aIInsight.create({ data: { taskBatchId: id, type: "SUMMARY", content: insight } }),
        this.prisma.aIInsight.create({ data: { taskBatchId: id, type: "RECOMMENDATION", content: followUp } }),
      ]);
    }

    return { insight, followUp, generatedAt: new Date() };
  }

  async getSavedInsights(id: string) {
    const rows = await this.prisma.aIInsight.findMany({
      where: { taskBatchId: id },
      orderBy: { generatedAt: "desc" },
    });
    const insight = rows.find((r) => r.type === "SUMMARY");
    const followUp = rows.find((r) => r.type === "RECOMMENDATION");
    if (!insight && !followUp) return null;
    return { insight: insight?.content ?? "", followUp: followUp?.content ?? "", generatedAt: insight?.generatedAt ?? followUp?.generatedAt };
  }
}
