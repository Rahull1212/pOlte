import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { CreateTaskBatchDto, CreateTaskDto, ProgressUpdateDto, TaskStatus, UpdateTaskDto } from "../shared-types";
import { PrismaService } from "../prisma/prisma.service";
import { AuthenticatedUser } from "../auth/types";
import { AllocationsService } from "../allocations/allocations.service";
import { NotificationsService } from "../notifications/notifications.service";
import { RegionsService } from "../regions/regions.service";
import { AiService } from "../ai/ai.service";
import { WhatsAppApiService } from "../whatsapp-api/whatsapp-api.service";
import { FyxoWhatsAppService } from "../fyxo-whatsapp/fyxo-whatsapp.service";
import { FYXO_TEMPLATES } from "../fyxo-whatsapp/templates";

// The real approved "polios" template's only body variable is the Cadre's
// name — "Hi {{1}}, we have assigned a task to you please check" — the task
// itself is never in the message body; the Cadre gets it by tapping the
// template's built-in "Task Details" button instead (handled via the
// Fyxo webhook once its real button-tap payload has been inspected — not
// invented — see FyxoAgentJobsProcessor). taskName/deadline are unused here
// today but kept as params in case a future confirmed template needs them.
function taskAssignedTemplate(_taskName: string, _deadline: Date) {
  return {
    ...FYXO_TEMPLATES.TASK_ASSIGNED,
    variablesFor: (cadreName: string) => [cadreName],
  };
}

@Injectable()
export class TasksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly allocationsService: AllocationsService,
    private readonly notificationsService: NotificationsService,
    private readonly regionsService: RegionsService,
    private readonly aiService: AiService,
    private readonly whatsAppApi: WhatsAppApiService,
    private readonly fyxoWhatsApp: FyxoWhatsAppService,
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
      fyxoTemplate: taskAssignedTemplate(task.name, task.deadline),
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

    const cadres =
      dto.cadreIds && dto.cadreIds.length > 0
        ? await this.resolveNamedCadres(dto.cadreIds, user)
        : await this.resolveAreaCadres(dto.regionIds);
    if (cadres.length === 0) {
      throw new BadRequestException(
        dto.cadreIds && dto.cadreIds.length > 0
          ? "No active Cadres found among the selected Cadres"
          : "No active Cadres found in the selected area(s)",
      );
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

    const createdTasks = await this.prisma.$transaction(
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

    // Captured and persisted per Task below (not fired-and-forgotten) so a
    // later webhook-driven interaction — the "polios" template's Task
    // Details button — can be deterministically correlated back to exactly
    // this assignment via fyxoMessageId, the same way allocateToCadres()
    // does for a routed batch.
    const whatsappResults = await this.notificationsService.notifyMany(
      cadres.map((c) => c.id),
      {
        type: "TASK_ASSIGNED",
        title: "New task assigned",
        message: `${dto.name} — due ${dto.deadline.toDateString()}. Reply YES to accept or NO to decline.`,
        relatedEntityType: "Task",
        relatedEntityId: batch.id,
        fyxoTemplate: taskAssignedTemplate(dto.name, dto.deadline),
      },
    );

    const sentAt = new Date();
    await this.prisma.$transaction(
      createdTasks.map((t) => {
        const result = whatsappResults.get(t.assignedToId);
        const succeeded = result?.success ?? true;
        return this.prisma.task.update({
          where: { id: t.id },
          data: {
            whatsappStatus: succeeded ? "SENT" : "FAILED",
            whatsappSentAt: succeeded ? sentAt : null,
            whatsappMessageId: result?.channel === "META" ? result.messageId : undefined,
            fyxoMessageId: result?.channel === "FYXO" ? result.messageId : undefined,
            fyxoTemplateName: result?.channel === "FYXO" ? FYXO_TEMPLATES.TASK_ASSIGNED.name : undefined,
          },
        });
      }),
    );

    return { batch, cadreCount: cadres.length, awaitingAllocation: false };
  }

  /** Every active Cadre named directly, validated to be within the given Admin's own region scope. */
  private async resolveNamedCadres(cadreIds: string[], user: AuthenticatedUser) {
    const cadres = await this.prisma.user.findMany({
      where: { id: { in: cadreIds }, role: "CADRE", isActive: true },
      select: { id: true, regionId: true, name: true },
    });
    if (cadres.length !== cadreIds.length) {
      throw new BadRequestException("One or more selected Cadres could not be found or are inactive");
    }
    for (const cadre of cadres) {
      const withinScope = await this.regionsService.isWithinScope(user.regionId, cadre.regionId);
      if (!withinScope) {
        throw new ForbiddenException("One or more selected Cadres are outside your own area");
      }
    }
    return cadres;
  }

  /** Every active Cadre anywhere under the given area(s) (District/Mandal/Booth) — the broadcast resolution. */
  private async resolveAreaCadres(regionIds: string[]) {
    const descendantSets = await Promise.all(regionIds.map((id) => this.regionsService.descendantIds(id)));
    const scopedRegionIds = Array.from(new Set(descendantSets.flat()));
    return this.prisma.user.findMany({
      where: { role: "CADRE", isActive: true, regionId: { in: scopedRegionIds } },
      select: { id: true, regionId: true, name: true },
    });
  }

  /**
   * An Admin allocating a Super-Admin-routed batch (awaitingAllocation:
   * true) to their own Cadres — either by area (every active Cadre under
   * the selected area(s), same resolution as createBatch's broadcast) or by
   * hand-picking specific Cadres directly, or a mix of both. Skips anyone
   * already assigned under this batch (another Admin may have already
   * allocated an overlapping area), creates Task rows for the rest, and
   * sends the same WhatsApp YES/NO notification a directly-created task
   * would.
   */
  async allocateToCadres(batchId: string, input: { regionIds: string[]; cadreIds: string[] }, user: AuthenticatedUser) {
    if (user.role !== "ADMIN") {
      throw new ForbiddenException("Only Admins allocate tasks to Cadres");
    }

    const batch = await this.prisma.taskBatch.findUnique({ where: { id: batchId } });
    if (!batch) throw new NotFoundException("Task not found");
    if (!batch.awaitingAllocation) {
      throw new BadRequestException("This task does not require allocation");
    }

    // A region — whether picked directly, or the home region of a
    // hand-picked Cadre — must be inside both the Admin's own scope and the
    // batch's original target area.
    const assertRegionEligible = async (regionId: string) => {
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
    };

    const existingAssignees = await this.prisma.task.findMany({ where: { batchId }, select: { assignedToId: true } });
    const alreadyAssigned = new Set(existingAssignees.map((t) => t.assignedToId));

    const cadreMap = new Map<string, { id: string; regionId: string; name: string }>();

    if (input.regionIds.length > 0) {
      for (const regionId of input.regionIds) {
        await assertRegionEligible(regionId);
      }
      const areaCadres = await this.resolveAreaCadres(input.regionIds);
      for (const c of areaCadres) {
        if (!alreadyAssigned.has(c.id)) cadreMap.set(c.id, c);
      }
    }

    if (input.cadreIds.length > 0) {
      const namedCadres = await this.resolveNamedCadres(input.cadreIds, user);
      for (const c of namedCadres) {
        if (alreadyAssigned.has(c.id) || cadreMap.has(c.id)) continue;
        await assertRegionEligible(c.regionId);
        cadreMap.set(c.id, c);
      }
    }

    const cadres = Array.from(cadreMap.values());
    if (cadres.length === 0) {
      throw new BadRequestException("No new active Cadres found for the selected area(s)/Cadre(s)");
    }

    const createdTasks = await this.prisma.$transaction(
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

    // notifyMany reports per-Cadre WhatsApp success/failure — persisted onto
    // each Task row so a partial failure is visible and retryable rather
    // than silently lost (see retryWhatsapp()).
    const whatsappResults = await this.notificationsService.notifyMany(
      cadres.map((c) => c.id),
      {
        type: "TASK_ASSIGNED",
        title: "New task assigned",
        message: `${batch.name} — due ${batch.deadline.toDateString()}. Reply YES to accept or NO to decline.`,
        relatedEntityType: "Task",
        relatedEntityId: batch.id,
        fyxoTemplate: taskAssignedTemplate(batch.name, batch.deadline),
      },
    );

    const now = new Date();
    await this.prisma.$transaction(
      createdTasks.map((t) => {
        const result = whatsappResults.get(t.assignedToId);
        const succeeded = result?.success ?? true;
        return this.prisma.task.update({
          where: { id: t.id },
          data: {
            whatsappStatus: succeeded ? "SENT" : "FAILED",
            whatsappSentAt: succeeded ? now : null,
            whatsappMessageId: result?.channel === "META" ? result.messageId : undefined,
            fyxoMessageId: result?.channel === "FYXO" ? result.messageId : undefined,
            fyxoTemplateName: result?.channel === "FYXO" ? FYXO_TEMPLATES.TASK_ASSIGNED.name : undefined,
          },
        });
      }),
    );
    const whatsappFailedCount = createdTasks.filter((t) => whatsappResults.get(t.assignedToId)?.success === false).length;

    await this.notificationsService.notify({
      userId: batch.createdById,
      type: "TASK_ALLOCATED",
      title: "Task allocated to Cadres",
      message: `${user.name} allocated "${batch.name}" to ${cadres.length} Cadre${cadres.length === 1 ? "" : "s"}.`,
      relatedEntityType: "Task",
      relatedEntityId: batch.id,
    });

    return {
      cadreCount: cadres.length,
      whatsappFailedCount,
      allocated: createdTasks.map((t) => ({
        taskId: t.id,
        cadreId: t.assignedToId,
        name: cadres.find((c) => c.id === t.assignedToId)?.name ?? "",
        whatsappStatus: whatsappResults.get(t.assignedToId)?.success === false ? ("FAILED" as const) : ("SENT" as const),
      })),
    };
  }

  /**
   * Re-sends the WhatsApp assignment message for one already-allocated
   * Task, for when the original send failed (whatsappStatus: FAILED).
   * Goes straight through WhatsAppApiService/FyxoWhatsAppService rather than
   * NotificationsService.notify() so it gets the real send outcome back
   * (notify() swallows that) and doesn't create a duplicate in-app
   * notification bell entry for what's just a delivery retry. Retries on
   * whichever channel the original send used — a task with a fyxoMessageId
   * already set went out via Fyxo, so the retry does too.
   */
  async retryWhatsapp(taskId: string, user: AuthenticatedUser) {
    const task = await this.prisma.task.findUnique({
      where: { id: taskId },
      include: { assignedTo: { select: { id: true, name: true, phone: true, regionId: true } } },
    });
    if (!task) throw new NotFoundException("Task not found");
    await this.assertVisible([task.assignedTo.regionId], user);

    if (task.fyxoMessageId !== null) {
      const idempotencyKey = `assignment-${task.id}-${FYXO_TEMPLATES.TASK_ASSIGNED.name}-retry-${Date.now()}`;
      const result = await this.fyxoWhatsApp.sendTemplateMessage({
        to: task.assignedTo.phone,
        templateName: FYXO_TEMPLATES.TASK_ASSIGNED.name,
        templateLanguage: FYXO_TEMPLATES.TASK_ASSIGNED.language,
        // The approved "polios" template's only body variable is the
        // Cadre's name — see taskAssignedTemplate()'s doc comment.
        variables: [task.assignedTo.name],
        idempotencyKey,
      });
      return this.prisma.task.update({
        where: { id: taskId },
        data: {
          whatsappStatus: result.success ? "SENT" : "FAILED",
          whatsappSentAt: result.success ? new Date() : task.whatsappSentAt,
          fyxoMessageId: result.messageId ?? task.fyxoMessageId,
          fyxoTemplateName: FYXO_TEMPLATES.TASK_ASSIGNED.name,
        },
      });
    }

    const message = `*New task assigned*\n${task.name} — due ${task.deadline.toDateString()}. Reply YES to accept or NO to decline.\n\n(Reply MENU to open PoliOS)`;
    const result = await this.whatsAppApi.sendText(task.assignedTo.phone, message);

    return this.prisma.task.update({
      where: { id: taskId },
      data: {
        whatsappStatus: result.success ? "SENT" : "FAILED",
        whatsappSentAt: result.success ? new Date() : task.whatsappSentAt,
        whatsappMessageId: result.messageId ?? task.whatsappMessageId,
      },
    });
  }

  /**
   * Applies a delivered/read/failed status callback from Meta's WhatsApp
   * webhook (see WhatsAppWebhookController + whatsapp-payload.types.ts),
   * correlated back to the Task whose outbound send produced this message
   * id. A status this app doesn't track (e.g. "sent", already recorded at
   * send time) or one that can't be correlated (simulated sends have no
   * real messageId) is a silent no-op, not an error — Meta shouldn't see a
   * failure for something outside this app's control.
   */
  async handleWhatsappStatusUpdate(messageId: string, status: string, timestampSeconds?: string): Promise<boolean> {
    const task = await this.prisma.task.findFirst({ where: { whatsappMessageId: messageId } });
    if (!task) return false;
    const at = timestampSeconds ? new Date(Number(timestampSeconds) * 1000) : new Date();
    return this.applyDeliveryStatus(task.id, status, at, task.deliveredAt);
  }

  /**
   * Same idea as handleWhatsappStatusUpdate, for a status callback arriving
   * from Fyxo's webhook (message.sent/delivered/read/failed events)
   * correlated via fyxoMessageId instead of Meta's wamid — see
   * FyxoAgentWebhookController.
   */
  async handleFyxoStatusUpdate(fyxoMessageId: string, eventType: string, at: Date = new Date()): Promise<boolean> {
    const task = await this.prisma.task.findFirst({ where: { fyxoMessageId } });
    if (!task) return false;
    const status = eventType.replace(/^message\./, ""); // "message.delivered" -> "delivered"
    return this.applyDeliveryStatus(task.id, status, at, task.deliveredAt);
  }

  private async applyDeliveryStatus(taskId: string, status: string, at: Date, currentDeliveredAt: Date | null): Promise<boolean> {
    const data: Record<string, unknown> = {};
    if (status === "delivered") {
      data.whatsappStatus = "DELIVERED";
      data.deliveredAt = at;
    } else if (status === "read") {
      data.whatsappStatus = "READ";
      data.readAt = at;
      if (!currentDeliveredAt) data.deliveredAt = at; // can coalesce delivered+read; don't leave delivery unset
    } else if (status === "failed") {
      data.whatsappStatus = "FAILED";
    } else {
      return false;
    }

    await this.prisma.task.update({ where: { id: taskId }, data });
    return true;
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

    const pending = await this.findPendingAllocationBatchesForAdmin(user);
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

  /** Every awaitingAllocation TaskBatch this Admin still has an eligible unallocated Cadre for — shared by listPendingAllocation() and listTasks(). */
  private async findPendingAllocationBatchesForAdmin(user: AuthenticatedUser) {
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
    return pending;
  }

  /**
   * True if this batch still belongs on the Admin's pending-allocation
   * radar: their scope overlaps the batch's target area, AND their slice
   * isn't fully allocated yet. "Fully allocated" specifically means every
   * *currently existing* eligible Cadre already has a Task — if zero
   * eligible Cadres exist at all (none added to this area yet), that does
   * NOT count as done; the batch stays visible so the Admin can see it's
   * routed to them and act once Cadres exist, rather than it silently
   * vanishing with no trace beyond the original notification. This also
   * matters when scopes nest — e.g. a District Admin's scope contains a
   * Mandal Admin's: once the Mandal Admin allocates their Cadres, the batch
   * must stay pending for the District Admin if other Mandals in the
   * District still need allocating, and only actually drop off once every
   * eligible Cadre anywhere in scope has been allocated.
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

    const totalEligibleCadres = await this.prisma.user.count({
      where: { role: "CADRE", isActive: true, regionId: { in: eligibleRegionIds } },
    });
    if (totalEligibleCadres === 0) return true;

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
   * Removes one Cadre from a task-creation unit (a single row inside a
   * batch, or the only assignee on a legacy single-assignee Task) without
   * touching anyone else on it or deleting anything — reuses the existing
   * CANCELLED status (declared in the schema, never actually set by any
   * code path until now) rather than a hard delete, so their WhatsApp
   * delivery/acknowledgment/progress history for this task stays on the
   * record. The row still appears in the Assigned Members list, badged as
   * removed; it just drops out of the batch's rollup status/progress/count
   * (see summarizeStatus() and listTasks()).
   */
  async removeAssignee(taskId: string, user: AuthenticatedUser) {
    if (user.role === "CADRE") {
      throw new ForbiddenException("Cadres cannot remove task assignments");
    }

    const task = await this.prisma.task.findUnique({
      where: { id: taskId },
      include: { assignedTo: { select: { id: true, name: true, regionId: true } } },
    });
    if (!task) throw new NotFoundException("Task not found");
    await this.assertVisible([task.assignedTo.regionId], user);

    if (task.status === "CANCELLED") {
      throw new BadRequestException(`${task.assignedTo.name} has already been removed from this task`);
    }

    return this.prisma.task.update({
      where: { id: taskId },
      data: { status: "CANCELLED", needsReassignment: false },
    });
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

  /**
   * Explicit "Start Task" deterministic action (button-driven, never routed
   * through an LLM — see the spec's "button actions must be deterministic"
   * rule). Moves an ACCEPTED task from PENDING to IN_PROGRESS before any
   * progress % has been submitted. submitProgress() already flips
   * PENDING->IN_PROGRESS as a side effect of the first progress update, so
   * this is a no-op (not an error) if a Cadre skips straight to reporting
   * progress instead of tapping Start first.
   */
  async startAssignment(taskId: string, user: AuthenticatedUser) {
    const task = await this.prisma.task.findUnique({ where: { id: taskId } });
    if (!task) throw new NotFoundException("Task not found");
    if (task.assignedToId !== user.id) {
      throw new ForbiddenException("You can only start your own tasks");
    }
    if (task.acknowledgment !== "ACCEPTED") {
      throw new BadRequestException("Accept this task before starting it");
    }
    if (task.status === "PENDING") {
      return this.prisma.task.update({ where: { id: taskId }, data: { status: "IN_PROGRESS" } });
    }
    return task;
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
      await this.prisma.task.update({
        where: { id: taskId },
        data: { status: "COMPLETED", completedAt: task.completedAt ?? new Date() },
      });
    } else if (task.status === "PENDING") {
      await this.prisma.task.update({ where: { id: taskId }, data: { status: "IN_PROGRESS" } });
    }

    return progress;
  }

  private progressPct(t: { status: TaskStatus; progress: { completionPercentage: number }[] }) {
    return t.progress[0]?.completionPercentage ?? (t.status === "COMPLETED" ? 100 : 0);
  }

  private async allRegionsById(): Promise<Map<string, { id: string; name: string; type: string; parentId: string | null }>> {
    const regions = await this.prisma.region.findMany({ select: { id: true, name: true, type: true, parentId: true } });
    return new Map(regions.map((r) => [r.id, r]));
  }

  /** Walks a region's parent chain to find its Mandal ancestor (or itself, if it already is one). */
  private resolveMandalLabel(
    regionId: string | null | undefined,
    regionById: Map<string, { id: string; name: string; type: string; parentId: string | null }>,
  ): string | null {
    let current = regionId ? regionById.get(regionId) : undefined;
    while (current) {
      if (current.type === "MANDAL") return current.name;
      current = current.parentId ? regionById.get(current.parentId) : undefined;
    }
    return null;
  }

  // A Cadre removed from a task (see removeAssignee()) leaves their Task row
  // in place as CANCELLED, for history — but it should drop out of the
  // batch's overall rollup status rather than counting as, say, "pending"
  // forever. Only if every member has been removed does the batch itself
  // summarize as CANCELLED.
  private summarizeStatus(tasks: { status: TaskStatus; needsReassignment: boolean }[]): string {
    const active = tasks.filter((t) => t.status !== "CANCELLED");
    if (active.length === 0) return tasks.length > 0 ? "CANCELLED" : "PENDING";
    if (active.some((t) => t.needsReassignment)) return "NEEDS_ATTENTION";
    if (active.every((t) => t.status === "COMPLETED")) return "COMPLETED";
    if (active.some((t) => t.status === "OVERDUE")) return "OVERDUE";
    if (active.some((t) => t.status === "IN_PROGRESS" || t.status === "PENDING")) {
      return active.some((t) => t.status === "IN_PROGRESS") ? "IN_PROGRESS" : "PENDING";
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

    // Batches routed to Admins that still have an unallocated eligible Cadre
    // somewhere in scope — they may have zero Task rows (nothing allocated
    // yet by anyone) or some already allocated by another overlapping Admin,
    // so they'd otherwise be invisible or incomplete on this list. A Super
    // Admin sees every batch they personally created that's still pending
    // anyone's allocation; an Admin sees every batch routed into their own
    // area that they (or a nested Admin) haven't finished allocating.
    let emptyAwaitingBatches: { id: string; name: string; targetRegionIds: string[]; deadline: Date; priority: string; createdAt: Date }[] = [];
    if (user.role === "SUPER_ADMIN") {
      emptyAwaitingBatches = await this.prisma.taskBatch.findMany({
        where: { awaitingAllocation: true, createdById: user.id, tasks: { none: {} } },
        select: { id: true, name: true, targetRegionIds: true, deadline: true, priority: true, createdAt: true },
        orderBy: { createdAt: "desc" },
      });
    } else if (user.role === "ADMIN") {
      const pending = await this.findPendingAllocationBatchesForAdmin(user);
      // A batch this Admin has already partially allocated (e.g. one Mandal
      // done, another still pending) has real Task rows in their scope, so
      // it already appears via batchGroups above — showing it again here
      // too would duplicate the row. Only surface the ones with nothing
      // allocated in this Admin's scope yet.
      emptyAwaitingBatches = pending
        .filter((b) => !batchGroups.has(b.id))
        .map((b) => ({
          id: b.id,
          name: b.name,
          targetRegionIds: b.targetRegionIds,
          deadline: b.deadline,
          priority: b.priority,
          createdAt: b.createdAt,
        }));
    }

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
      // A removed Cadre (status: CANCELLED — see removeAssignee()) stays in
      // the underlying batch for history, but shouldn't count toward "how
      // many people" or drag down the average progress of who's actually
      // still on it.
      const active = group.filter((t) => t.status !== "CANCELLED");
      return {
        id: batchId,
        isBatch: true,
        name: b.name,
        districts,
        assignedCount: active.length,
        assignedNames: active.map((t) => t.assignedTo.name),
        deadline: b.deadline,
        priority: b.priority,
        status: this.summarizeStatus(group),
        progressPct: active.length > 0 ? Math.round(active.reduce((s, t) => s + this.progressPct(t), 0) / active.length) : 0,
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
          taskId: t.id,
          name: t.assignedTo.name,
          area: `${t.assignedTo.region.name} (${t.assignedTo.region.type})`,
          whatsappStatus: t.whatsappStatus,
          fyxoTemplateName: t.fyxoTemplateName,
          status: t.status,
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
        {
          id: task.assignedTo.id,
          taskId: task.id,
          name: task.assignedTo.name,
          area: `${task.assignedTo.region.name} (${task.assignedTo.region.type})`,
          whatsappStatus: task.whatsappStatus,
          fyxoTemplateName: task.fyxoTemplateName,
          status: task.status,
        },
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
      whatsappStatus: string;
      whatsappSentAt: Date | null;
      deliveredAt: Date | null;
      readAt: Date | null;
      completedAt: Date | null;
      createdAt: Date;
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

    // A removed Cadre (status: CANCELLED — see removeAssignee()) stays in
    // `tasks` for the per-Cadre breakdown and activity timeline below (real
    // history, shown as such), but is excluded from every rollup KPI here
    // so removing someone doesn't silently drag down "average progress" or
    // inflate "total assigned" with people no longer actually on the task.
    const activeTasks = tasks.filter((t) => t.status !== "CANCELLED");
    const cancelled = tasks.length - activeTasks.length;

    const whatsappSent = activeTasks.filter((t) => t.whatsappStatus === "SENT" || t.whatsappStatus === "DELIVERED" || t.whatsappStatus === "READ").length;
    const whatsappDelivered = activeTasks.filter((t) => t.whatsappStatus === "DELIVERED" || t.whatsappStatus === "READ").length;
    const whatsappRead = activeTasks.filter((t) => t.whatsappStatus === "READ").length;
    const whatsappFailed = activeTasks.filter((t) => t.whatsappStatus === "FAILED").length;
    const responded = activeTasks.filter((t) => t.acknowledgment !== "AWAITING").length;

    const kpis = {
      totalAssigned: activeTasks.length,
      cancelled,
      accepted: activeTasks.filter((t) => t.acknowledgment === "ACCEPTED").length,
      declined: activeTasks.filter((t) => t.acknowledgment === "DECLINED").length,
      noResponse: activeTasks.filter((t) => t.acknowledgment === "AWAITING").length,
      needsReassignment: activeTasks.filter((t) => t.needsReassignment).length,
      pending: activeTasks.filter((t) => t.status === "PENDING").length,
      inProgress: activeTasks.filter((t) => t.status === "IN_PROGRESS").length,
      completed: activeTasks.filter((t) => t.status === "COMPLETED").length,
      overdue: activeTasks.filter((t) => t.status === "OVERDUE").length,
      avgProgressPct:
        activeTasks.length > 0 ? Math.round(activeTasks.reduce((s, t) => s + this.progressPct(t), 0) / activeTasks.length) : 0,
      whatsappSent,
      whatsappDelivered,
      whatsappRead,
      whatsappFailed,
      responded,
    };

    // "At least reached this stage" funnel, in lifecycle order — each stage
    // count is real (derived from the same Task fields as the KPIs above),
    // not estimated.
    const progressFunnel = [
      { stage: "Allocated", count: activeTasks.length },
      { stage: "WhatsApp Sent", count: whatsappSent },
      { stage: "Delivered", count: whatsappDelivered },
      { stage: "Read", count: whatsappRead },
      { stage: "Responded", count: responded },
      { stage: "In Progress", count: activeTasks.filter((t) => t.status === "IN_PROGRESS" || t.status === "COMPLETED").length },
      { stage: "Completed", count: activeTasks.filter((t) => t.status === "COMPLETED").length },
    ];

    const regionById = await this.allRegionsById();

    const cadres = tasks.map((t) => {
      const lastActivityAt = [t.whatsappSentAt, t.deliveredAt, t.readAt, t.acknowledgedAt, t.completedAt, t.progress[0]?.createdAt]
        .filter((d): d is Date => d instanceof Date)
        .sort((a, b) => b.getTime() - a.getTime())[0];
      return {
        taskId: t.id,
        name: t.assignedTo.name,
        area: `${t.assignedTo.region.name} (${t.assignedTo.region.type})`,
        mandal: this.resolveMandalLabel(t.assignedTo.regionId, regionById),
        status: t.status,
        acknowledgment: t.acknowledgment,
        acknowledgedAt: t.acknowledgedAt,
        needsReassignment: t.needsReassignment,
        progressPct: this.progressPct(t),
        whatsappStatus: t.whatsappStatus,
        whatsappSentAt: t.whatsappSentAt,
        lastActivityAt: lastActivityAt ?? null,
      };
    });

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

    // Every real event across every Cadre on this task, newest first — the
    // Activity Timeline. Built entirely from existing timestamp fields, not
    // a separate activity-log table.
    type TimelineEvent = { type: string; cadreName: string; at: Date; detail?: string };
    const timeline: TimelineEvent[] = [];
    for (const t of tasks) {
      timeline.push({ type: "ALLOCATED", cadreName: t.assignedTo.name, at: t.createdAt });
      if (t.whatsappSentAt) timeline.push({ type: "WHATSAPP_SENT", cadreName: t.assignedTo.name, at: t.whatsappSentAt });
      if (t.deliveredAt) timeline.push({ type: "WHATSAPP_DELIVERED", cadreName: t.assignedTo.name, at: t.deliveredAt });
      if (t.readAt) timeline.push({ type: "WHATSAPP_READ", cadreName: t.assignedTo.name, at: t.readAt });
      if (t.acknowledgedAt) {
        timeline.push({ type: "RESPONDED", cadreName: t.assignedTo.name, at: t.acknowledgedAt, detail: t.acknowledgment });
      }
      for (const p of t.progress) {
        timeline.push({ type: "PROGRESS_UPDATE", cadreName: t.assignedTo.name, at: p.createdAt, detail: `${p.completionPercentage}%` });
      }
      if (t.completedAt) timeline.push({ type: "COMPLETED", cadreName: t.assignedTo.name, at: t.completedAt });
    }
    timeline.sort((a, b) => b.at.getTime() - a.at.getTime());

    return { id, isBatch, name, remarks, kpis, cadres, dailyProgress, progressFunnel, timeline: timeline.slice(0, 50) };
  }

  /**
   * Generates the "AI Task Insights" (current performance/completion),
   * "Risks" (deadline risk, WhatsApp failures, non-responders, delays), and
   * "Follow-up requirements" sections from the real dashboard bundle above —
   * persisted only for batches (AIInsight.taskBatchId), since that's the
   * only real fan-out data this app currently has; a legacy single-assignee
   * task still gets a live analysis, just not saved for later.
   */
  async generateInsights(id: string, user: AuthenticatedUser) {
    const dashboard = await this.getTaskDashboard(id, user);
    const { insight, risks, followUp } = await this.aiService.generateTaskInsight({
      name: dashboard.name,
      kpis: dashboard.kpis,
      progressFunnel: dashboard.progressFunnel,
      cadres: dashboard.cadres.map((c) => ({
        name: c.name,
        status: c.status,
        acknowledgment: c.acknowledgment,
        whatsappStatus: c.whatsappStatus,
        progressPct: c.progressPct,
      })),
    });

    if (dashboard.isBatch) {
      await this.prisma.$transaction([
        this.prisma.aIInsight.create({ data: { taskBatchId: id, type: "SUMMARY", content: insight } }),
        this.prisma.aIInsight.create({ data: { taskBatchId: id, type: "RISK", content: risks } }),
        this.prisma.aIInsight.create({ data: { taskBatchId: id, type: "RECOMMENDATION", content: followUp } }),
      ]);
    }

    return { insight, risks, followUp, generatedAt: new Date() };
  }

  async getSavedInsights(id: string) {
    const rows = await this.prisma.aIInsight.findMany({
      where: { taskBatchId: id },
      orderBy: { generatedAt: "desc" },
    });
    const insight = rows.find((r) => r.type === "SUMMARY");
    const risks = rows.find((r) => r.type === "RISK");
    const followUp = rows.find((r) => r.type === "RECOMMENDATION");
    if (!insight && !risks && !followUp) return null;
    return {
      insight: insight?.content ?? "",
      risks: risks?.content ?? "",
      followUp: followUp?.content ?? "",
      generatedAt: insight?.generatedAt ?? risks?.generatedAt ?? followUp?.generatedAt,
    };
  }

  /**
   * "Ask AI" scoped to exactly one task — reuses the same dashboard bundle
   * and the same generic AiService.answerTaskQuestion() as the org-wide Task
   * Communication dashboard's Ask AI, just fed a single-task bundle instead
   * of an org/area-wide one. getTaskDashboard() already enforces that the
   * caller is authorized to see this task.
   */
  async askAboutTask(id: string, question: string, user: AuthenticatedUser) {
    const dashboard = await this.getTaskDashboard(id, user);
    const bundle = {
      name: dashboard.name,
      remarks: dashboard.remarks,
      kpis: dashboard.kpis,
      progressFunnel: dashboard.progressFunnel,
      cadres: dashboard.cadres,
      dailyProgress: dashboard.dailyProgress,
    };
    const answer = await this.aiService.answerTaskQuestion(question, bundle);
    return { answer };
  }
}
