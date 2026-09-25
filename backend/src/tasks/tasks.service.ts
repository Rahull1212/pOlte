import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { CreateTaskBatchDto, CreateTaskDto, ProgressUpdateDto, TaskStatus, UpdateTaskDto } from "../shared-types";
import { PrismaService } from "../prisma/prisma.service";
import { AuthenticatedUser } from "../auth/types";
import { AllocationsService } from "../allocations/allocations.service";
import { NotificationsService, MessageContext } from "../notifications/notifications.service";
import { RegionsService } from "../regions/regions.service";
import { AiService } from "../ai/ai.service";
import { WhatsAppApiService } from "../whatsapp-api/whatsapp-api.service";
import { FyxoWhatsAppService } from "../fyxo-whatsapp/fyxo-whatsapp.service";
import { FYXO_TEMPLATES, renderFyxoBody, TEMPLATE_VARIABLE_ORDER, taskButtonPayloads } from "../fyxo-whatsapp/templates";
import { MessageLogService } from "../message-log/message-log.service";
import { MessageTemplatesService } from "../message-templates/message-templates.service";

/**
 * Which existing message-log statuses an incoming delivery event is allowed
 * to overwrite. The WhatsApp lifecycle only moves forward — sent, delivered,
 * read — but the webhooks reporting it can arrive in any order, so each
 * event may only overwrite a status at or below its own stage.
 *
 * FAILED is the exception: it can replace a still-in-flight SENT, but never
 * a DELIVERED or READ. Once a message has demonstrably arrived, a late
 * failure report is stale, not news.
 */
const OVERWRITABLE_BY: Record<string, string[]> = {
  SENT: ["PENDING", "QUEUED", "SENT"],
  DELIVERED: ["PENDING", "QUEUED", "SENT", "DELIVERED"],
  READ: ["PENDING", "QUEUED", "SENT", "DELIVERED", "READ"],
  FAILED: ["PENDING", "QUEUED", "SENT", "FAILED"],
};

// Every task-assignment template's only body variable is the Cadre's name —
// the approved "polios" one reads "Hi {{1}}, we have assigned a task to you
// please check". The task itself is never in the message body; the Cadre
// gets it by tapping the template's built-in "Task Details" button instead
// (handled via the Fyxo webhook once its real button-tap payload has been
// inspected — not invented — see FyxoAgentJobsProcessor).
//
// Which template that is depends on who created the task: a Super Admin's
// own, or the individual Admin's (MessageTemplatesService.resolveFor),
// falling back to the shared "polios" default when none is assigned. All of
// them are assumed to share this one-variable shape — a per-Admin template
// with a different variable count would need its own handling here.
function taskAssignedTemplate(owner: TemplateOwnerFields, task?: TemplateTaskContext, variableCount = 1) {
  const template = MessageTemplatesService.resolveFor(owner);
  return {
    ...template,
    variablesFor: (cadreName: string) =>
      buildTemplateVariables(variableCount, cadreName, task, owner.fyxoTemplateVariables, template.name),
  };
}

/**
 * Fills exactly as many variables as the template declares, in the order
 * WhatsApp templates conventionally read (and as the integration guide's own
 * task_assigned example does): who, what, when.
 *
 *   {{1}} the Cadre's name      {{2}} the task name      {{3}} the deadline
 *
 * The count has to match the template exactly or Fyxo rejects the send with a
 * 400 before anything reaches Meta (§5), which is why it's driven by the
 * synced catalogue rather than assumed. Anything beyond the third slot gets
 * an em dash: a template that needs more than this has data PoliOS doesn't
 * know about, and padding is far better than a hard failure for every send.
 *
 * Values are single-line by necessity — §5: "A value cannot contain a line
 * break. Meta rejects the whole send." Hence the task NAME, never its
 * description.
 */
function buildTemplateVariables(
  count: number,
  cadreName: string,
  task?: TemplateTaskContext,
  mapping?: string[],
  templateName?: string,
): string[] {
  const value = (source: string): string => {
    switch (source) {
      case "CADRE_NAME":
        return cadreName;
      case "CAMPAIGN_NAME":
        return task?.campaignName ?? "—";
      case "TASK_NAME":
        return task?.name ?? "your task";
      case "DEADLINE":
        return task ? task.deadline.toLocaleDateString("en-IN", { day: "numeric", month: "short" }) : "—";
      case "PRIORITY":
        return task?.priority ? task.priority.charAt(0) + task.priority.slice(1).toLowerCase() : "—";
      case "ASSIGNED_BY":
        return task?.assignedByName ?? "—";
      default:
        return "—";
    }
  };

  // Resolved per SLOT, not all-or-nothing. The owner's own mapping wins
  // wherever it names a source; any slot it doesn't reach falls back to the
  // template's declared order (TEMPLATE_VARIABLE_ORDER — task_assigned reads
  // who/campaign/what/when, not the conventional who/what/when), and only
  // then to the generic default.
  //
  // All-or-nothing is what produced "Campaign: — Task: — Due Date: —": an
  // owner whose mapping was saved as a single ["CADRE_NAME"] back when their
  // template took one variable kept that mapping after being moved to a
  // four-variable template, and a mapping shorter than the template silently
  // blanked every remaining slot. A partial mapping now fills what it
  // specifies and lets the template's own order cover the rest.
  const declared = (templateName ? TEMPLATE_VARIABLE_ORDER[templateName] : undefined) ?? DEFAULT_VARIABLE_ORDER;
  const sources = Array.from(
    { length: Math.max(1, count) },
    (_, i) => mapping?.[i] || declared[i] || "",
  );
  return sources.map((source) => flattenForTemplate(value(source)));
}

const DEFAULT_VARIABLE_ORDER = ["CADRE_NAME", "TASK_NAME", "DEADLINE"];

export interface TemplateTaskContext {
  name: string;
  deadline: Date;
  priority?: string;
  assignedByName?: string;
  /** Fills {{2}} of task_assigned_v2; "—" for a task with no campaign. */
  campaignName?: string;
}

// Line breaks in a variable make Meta reject the entire send (§5), so they're
// flattened to spaces here rather than trusted not to appear.
function flattenForTemplate(value: string): string {
  return value.replace(/\s+/g, " ").trim() || "—";
}

// The template-owning columns on a User row — whoever created the task.
type TemplateOwnerFields = {
  fyxoTemplateName: string | null;
  fyxoTemplateLanguage: string | null;
  fyxoTemplateBody: string | null;
  fyxoTemplateVariables?: string[];
};

// Everything the sheet log and the template resolver need about a task's
// creator, in one reusable Prisma select.
const TEMPLATE_OWNER_SELECT = {
  name: true,
  role: true,
  fyxoTemplateName: true,
  fyxoTemplateLanguage: true,
  fyxoTemplateBody: true,
  fyxoTemplateVariables: true,
} as const;

@Injectable()
export class TasksService {
  private readonly logger = new Logger(TasksService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly allocationsService: AllocationsService,
    private readonly notificationsService: NotificationsService,
    private readonly regionsService: RegionsService,
    private readonly aiService: AiService,
    private readonly whatsAppApi: WhatsAppApiService,
    private readonly fyxoWhatsApp: FyxoWhatsAppService,
    private readonly messageLog: MessageLogService,
    private readonly messageTemplates: MessageTemplatesService,
  ) {}

  /**
   * Which sheet tab a task's messages are logged to, and the extra columns
   * that go with them.
   *
   * The tab follows whoever CREATED the task, not who sent the message:
   *   - Super Admin created it (an Admin then allocates it) -> the connected
   *     default tab, so the Super Admin sees their own tasks in one place
   *     with the allocating Admin named in the "Assigned By" column.
   *   - An Admin created it themselves -> that Admin's own tab, created on
   *     first send, so each Admin's independent work is separated out.
   * Either way it's the same Super-Admin-connected spreadsheet.
   */
  private messageContext(
    taskName: string,
    _createdBy: { name: string; role: string },
    assignedByName: string,
    assignedById?: string,
    taskIdFor?: (recipientUserId: string) => string | undefined,
  ): MessageContext {
    return { taskName, assignedByName, assignedById, taskIdFor };
  }

  /**
   * messageContext() for an already-created Task row. A Task always has an
   * assigner but not always a batch (create() makes single tasks directly),
   * so a batch-less task falls back to its assigner as the creator — which
   * for a directly-created task is the same person anyway.
   */
  private taskMessageContext(task: {
    id: string;
    name: string;
    assignedById: string;
    assignedBy: { name: string; role: string };
    batch: { createdBy: { name: string; role: string } } | null;
  }): MessageContext {
    return this.messageContext(
      task.name,
      task.batch?.createdBy ?? task.assignedBy,
      task.assignedBy.name,
      task.assignedById,
      // One Task row, one recipient — the id is fixed for this send.
      () => task.id,
    );
  }

  /**
   * Mirrors an outbound task WhatsApp message into the Google Sheet log.
   * Sends routed through NotificationsService are logged there instead (see
   * its logToSheet) — this covers the two paths that call Fyxo/Meta
   * directly: retryWhatsapp() and sendCompletionCheck(). Never throws; the
   * sheet is a reporting side-channel, not part of the send's success.
   */
  private async logMessage(
    cadre: { id: string; name: string; phone: string },
    message: string,
    result: { success: boolean; messageId?: string },
    context: MessageContext,
    kind: "RETRY" | "COMPLETION_CHECK",
    taskId: string,
    templateName?: string,
    // Recorded so a Resend from the Message Log repeats this exact message.
    variables?: string[],
  ) {
    try {
      await this.messageLog.record({
        cadreId: cadre.id,
        cadreName: cadre.name,
        cadrePhone: cadre.phone,
        message,
        taskId,
        taskName: context.taskName,
        assignedById: context.assignedById,
        assignedByName: context.assignedByName,
        kind,
        templateName,
        variables,
        channel: kind === "RETRY" && !templateName ? "META" : "FYXO",
        success: result.success,
        providerMessageId: result.messageId,
      });
    } catch {
      // already logged by MessageLogService
    }
  }

  /**
   * Creates one task and hands it straight to a Cadre — no batch, no
   * allocation step. Open to a Super Admin and to an Admin anywhere in
   * their own area, which is the check that matters: an Admin who covers a
   * Constituency is responsible for every Cadre in it, not only the ones
   * reporting directly to them.
   */
  async create(dto: CreateTaskDto, user: AuthenticatedUser) {
    const assignee = await this.prisma.user.findUnique({ where: { id: dto.assignedToId } });
    if (!assignee) throw new NotFoundException("Assignee not found");
    if (user.role !== "SUPER_ADMIN") {
      const withinScope = await this.regionsService.isWithinScope(user.regionId, assignee.regionId);
      if (!withinScope) {
        throw new ForbiddenException("That Cadre is outside your own area");
      }
    }

    const pollingStationId = await this.resolvePollingStation(dto.pollingStationId, user);

    const task = await this.prisma.task.create({
      data: {
        campaignId: await this.assertCampaignUsable(dto.campaignId, user),
        allocationId: dto.allocationId,
        pollingStationId,
        name: dto.name,
        description: dto.description,
        assignedToId: dto.assignedToId,
        assignedById: user.id,
        deadline: dto.deadline,
        priority: dto.priority,
      },
    });

    // A directly-created task has no batch, so its creator *is* its
    // assigner — that's whose template and sheet tab it uses.
    const creator = await this.prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: TEMPLATE_OWNER_SELECT,
    });

    // {{2}} of a four-variable template. Without it the Cadre reads
    // "Campaign: —" on a task that does belong to a campaign.
    const campaign = task.campaignId
      ? await this.prisma.campaign.findUnique({ where: { id: task.campaignId }, select: { name: true } })
      : null;

    await this.notificationsService.notify({
      userId: dto.assignedToId,
      type: "TASK_ASSIGNED",
      title: "New task assigned",
      message: `${task.name} — due ${task.deadline.toDateString()}. Reply YES to accept or NO to decline.`,
      relatedEntityType: "Task",
      relatedEntityId: task.id,
      fyxoTemplate: taskAssignedTemplate(
        creator,
        {
          name: task.name,
          deadline: task.deadline,
          priority: task.priority,
          assignedByName: user.name,
          campaignName: campaign?.name,
        },
        await this.messageTemplates.variableCountFor(MessageTemplatesService.resolveFor(creator).name),
      ),
      messageContext: this.messageContext(task.name, creator, user.name, user.id),
    });

    return task;
  }

  /**
   * Creates a TaskBatch — the task record itself — without sending anything
   * to any Cadre yet. Allocation (picking which Cadres, actually sending the
   * WhatsApp messages) is always a deliberate follow-up step via
   * allocateToCadres(), for a SUPER_ADMIN's batch *and* an ADMIN's own,
   * consistently — creating a task no longer implicitly fans it out.
   *
   * A SUPER_ADMIN's batch has no Cadres of their own, so it's routed by
   * notifying whichever Admins cover the selected area(s); an ADMIN's own
   * batch is routed the same way (findAdminsForRegions naturally includes
   * themselves, alongside any broader-scoped Admin over the same area), so
   * it shows up on their own Pending Allocation list as a reminder — see
   * listTasks()/listPendingAllocation(), which already treat "awaiting
   * allocation" uniformly regardless of who created the batch.
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

    const batch = await this.prisma.taskBatch.create({
      data: {
        name: dto.name,
        objective: dto.objective,
        description: dto.description,
        remarks: dto.remarks,
        deadline: dto.deadline,
        priority: dto.priority,
        campaignId: await this.assertCampaignUsable(dto.campaignId, user),
        pollingStationId: await this.resolvePollingStation(dto.pollingStationId, user),
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
          message: `"${dto.name}" was created and is ready to allocate to your Cadres.`,
          relatedEntityType: "Task",
          relatedEntityId: batch.id,
        },
      );
    }

    return { batch, cadreCount: 0, awaitingAllocation: true };
  }

  /**
   * Validates an official location: it must be a Polling Station (the leaf
   * of the ECI hierarchy) and, for an Admin, inside their own area. Higher
   * levels are rejected rather than accepted-and-ignored — a task recorded
   * against "Khairatabad" with no station is not an official location, and
   * silently keeping it would make the four ECI fields on the task look
   * complete when they aren't.
   */
  private async resolvePollingStation(pollingStationId: string | undefined, user: AuthenticatedUser) {
    if (!pollingStationId) return undefined;

    const station = await this.prisma.region.findUnique({
      where: { id: pollingStationId },
      select: { id: true, type: true },
    });
    if (!station) throw new BadRequestException("Polling Station not found");
    if (station.type !== "BOOTH") {
      throw new BadRequestException("Select a Polling Station, not a State, District or Constituency");
    }
    if (user.role !== "SUPER_ADMIN") {
      const withinScope = await this.regionsService.isWithinScope(user.regionId, station.id);
      if (!withinScope) throw new ForbiddenException("That Polling Station is outside your own area");
    }
    return station.id;
  }

  /**
   * Validates the campaign a task is being filed under: it must exist, and
   * an Admin may only file against a campaign they run or created. Returns
   * the id so callers can inline it, or undefined for an unlinked task.
   */
  private async assertCampaignUsable(campaignId: string | undefined, user: AuthenticatedUser) {
    if (!campaignId) return undefined;

    const campaign = await this.prisma.campaign.findUnique({
      where: { id: campaignId },
      select: {
        id: true,
        name: true,
        createdById: true,
        assignedAdmins: { select: { adminId: true, status: true } },
      },
    });
    if (!campaign) throw new BadRequestException("Campaign not found");
    if (user.role === "SUPER_ADMIN") return campaign.id;

    const assignment = campaign.assignedAdmins.find((a) => a.adminId === user.id);
    const isCreator = campaign.createdById === user.id;
    if (!assignment && !isCreator) {
      throw new ForbiddenException("You are not one of that campaign's Admins");
    }

    // Being handed a campaign isn't the same as taking it on. An Admin who
    // hasn't accepted may read the campaign, but filing work against it —
    // and so putting it in front of their Cadres — waits on their answer.
    // The creator is exempt: an Admin who made the campaign themselves has
    // nobody to accept it from.
    if (assignment && !isCreator && assignment.status !== "ACCEPTED") {
      throw new ForbiddenException(
        assignment.status === "DECLINED"
          ? `You declined "${campaign.name}", so you cannot assign work under it.`
          : `Accept "${campaign.name}" before assigning work under it.`,
      );
    }
    return campaign.id;
  }

  /**
   * The five official Election Commission fields for a task, resolved from
   * its Polling Station by walking up the hierarchy. Kept derived rather
   * than copied onto the Task so a station corrected in the area tree is
   * corrected everywhere at once, and the AC/District/State can never be
   * out of step with the station they belong to.
   */
  private async officialLocation(pollingStationId: string | null | undefined) {
    if (!pollingStationId) return null;

    const station = await this.prisma.region.findUnique({
      where: { id: pollingStationId },
      select: {
        name: true,
        number: true,
        type: true,
        parent: {
          select: {
            name: true,
            number: true,
            parent: { select: { name: true, parent: { select: { name: true } } } },
          },
        },
      },
    });
    // Anything above a station has no official station number, and walking
    // its parents would label a District as a Constituency. Better to say
    // "not recorded" than to show four fields that are quietly wrong.
    if (!station || station.type !== "BOOTH") return null;

    const constituency = station.parent;
    const district = constituency?.parent;
    return {
      state: district?.parent?.name ?? null,
      district: district?.name ?? null,
      assemblyConstituency: constituency?.name ?? null,
      assemblyConstituencyNo: constituency?.number ?? null,
      pollingStationNo: station.number,
      pollingStationName: station.name,
    };
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

  /** Every active Cadre anywhere under the given area(s) (District/Constituency/Booth) — the broadcast resolution. */
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
    if (user.role === "CADRE") {
      throw new ForbiddenException("Only Super Admins and Admins allocate tasks to Cadres");
    }

    const batch = await this.prisma.taskBatch.findUnique({
      where: { id: batchId },
      // createdBy drives both which template goes out (taskAssignedTemplate)
      // and which sheet tab it's logged to (messageContext) — the same owner
      // for both, deliberately.
      include: { createdBy: { select: TEMPLATE_OWNER_SELECT } },
    });
    if (!batch) throw new NotFoundException("Task not found");
    if (!batch.awaitingAllocation) {
      throw new BadRequestException("This task does not require allocation");
    }

    // The gate that matters: allocating is the moment a campaign's work
    // actually reaches Cadres. An Admin who hasn't accepted the campaign
    // this batch belongs to cannot push it out to their people, however the
    // batch was created or who routed it to them.
    await this.assertCampaignUsable(batch.campaignId ?? undefined, user);

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
            // Each Cadre's row carries the batch's official location, so a
            // Cadre asking "where?" over WhatsApp is answered from their own
            // Task rather than having to walk back up to the batch.
            pollingStationId: batch.pollingStationId,
            name: batch.name,
            objective: batch.objective,
            description: batch.description,
            remarks: batch.remarks,
            assignedToId: cadre.id,
            assignedById: user.id,
            deadline: batch.deadline,
            priority: batch.priority,
          },
        }),
      ),
    );

    // Each Cadre's own Task id, so the "Task Details" tap comes back to us as
    // `reference` identifying exactly that assignment (API.md §5/§11) rather
    // than just "somebody with this phone number tapped".
    const taskIdByCadre = new Map(createdTasks.map((t) => [t.assignedToId, t.id]));

    const resolvedName = MessageTemplatesService.resolveFor(batch.createdBy).name;
    const variableCount = await this.messageTemplates.variableCountFor(resolvedName);
    // {{2}} of task_assigned_v2. Looked up once for the whole batch — every
    // task in it shares the batch's campaign.
    const campaign = batch.campaignId
      ? await this.prisma.campaign.findUnique({ where: { id: batch.campaignId }, select: { name: true } })
      : null;
    const allocationTemplate = {
      ...taskAssignedTemplate(
        batch.createdBy,
        {
          name: batch.name,
          deadline: batch.deadline,
          priority: batch.priority,
          assignedByName: user.name,
          campaignName: campaign?.name,
        },
        variableCount,
      ),
      // One payload per Quick Reply, positionally matched to the template's
      // buttons, so a tap says WHICH button as well as which assignment.
      // A single-button template ignores the extra entry.
      buttonPayloadsFor: (cadreId: string) => {
        const taskId = taskIdByCadre.get(cadreId);
        return taskId ? taskButtonPayloads(taskId) : undefined;
      },
    };

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
        // The task creator's template — the Super Admin's for a task they
        // routed here, this Admin's own for one they created themselves.
        fyxoTemplate: allocationTemplate,
        // user is the allocating Admin — the "Assigned By" column.
        // taskIdByCadre was already built for buttonPayloadsFor; reusing it
        // means the logged task and the button payload can never disagree.
        messageContext: this.messageContext(
          batch.name,
          batch.createdBy,
          user.name,
          user.id,
          (cadreId) => taskIdByCadre.get(cadreId),
        ),
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
            // The template this specific task actually went out with, so a
            // later retry repeats it rather than reverting to the default
            // (an Admin's template can be reassigned in between).
            fyxoTemplateName: result?.channel === "FYXO" ? allocationTemplate.name : undefined,
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
      include: {
        assignedTo: { select: { id: true, name: true, phone: true, regionId: true } },
        // The batch's creator owns both the template and the sheet tab;
        // assignedBy is the "Assigned By" column (and the creator fallback
        // for a task that has no batch).
        assignedBy: { select: TEMPLATE_OWNER_SELECT },
        batch: { select: { createdBy: { select: TEMPLATE_OWNER_SELECT } } },
      },
    });
    if (!task) throw new NotFoundException("Task not found");
    await this.assertVisible([task.assignedTo.regionId], user);

    if (task.fyxoMessageId !== null) {
      // Repeat the template this task actually went out with, recorded at
      // send time — resolving the owner's template afresh could pick up a
      // different one if the Super Admin reassigned it in between, which
      // would make the retry a different message than the one being retried.
      const owner = task.batch?.createdBy ?? task.assignedBy;
      // A retry must read identically to the original, campaign included.
      const retryCampaign = task.campaignId
        ? await this.prisma.campaign.findUnique({ where: { id: task.campaignId }, select: { name: true } })
        : null;
      const resolved = taskAssignedTemplate(
        owner,
        {
          name: task.name,
          deadline: task.deadline,
          priority: task.priority,
          campaignName: retryCampaign?.name,
        },
        await this.messageTemplates.variableCountFor(task.fyxoTemplateName ?? MessageTemplatesService.resolveFor(owner).name),
      );
      const template = task.fyxoTemplateName
        ? { name: task.fyxoTemplateName, language: resolved.language, body: resolved.body }
        : resolved;

      // Fill as many variables as this template declares — resolved above.
      // Hardcoding one here silently sent the wrong count to a multi-variable
      // template, which Fyxo rejects outright (§5).
      const variables = resolved.variablesFor(task.assignedTo.name);

      const idempotencyKey = `assignment-${task.id}-${template.name}-retry-${Date.now()}`;
      const result = await this.fyxoWhatsApp.sendTemplateMessage({
        to: task.assignedTo.phone,
        templateName: template.name,
        templateLanguage: template.language,
        variables,
        // Same payloads as the original send — a retry must produce taps
        // that resolve to the same task and the same actions.
        buttonPayloads: taskButtonPayloads(task.id),
        idempotencyKey,
      });
      await this.logMessage(
        task.assignedTo,
        renderFyxoBody(template, variables),
        result,
        this.taskMessageContext(task),
        "RETRY",
        task.id,
        template.name,
        variables,
      );
      return this.prisma.task.update({
        where: { id: taskId },
        data: {
          whatsappStatus: result.success ? "SENT" : "FAILED",
          whatsappSentAt: result.success ? new Date() : task.whatsappSentAt,
          fyxoMessageId: result.messageId ?? task.fyxoMessageId,
          fyxoTemplateName: template.name,
        },
      });
    }

    const message = `*New task assigned*\n${task.name} — due ${task.deadline.toDateString()}. Reply YES to accept or NO to decline.\n\n(Reply MENU to open PoliOS)`;
    const result = await this.whatsAppApi.sendText(task.assignedTo.phone, message);
    await this.logMessage(task.assignedTo, message, result, this.taskMessageContext(task), "RETRY", task.id);

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
  async handleFyxoStatusUpdate(
    fyxoMessageId: string,
    eventType: string,
    at: Date = new Date(),
    error?: string,
  ): Promise<boolean> {
    // The message log row is updated even when no Task matches — a send can
    // be logged without a Task row (a plain notification), and the reason a
    // message never arrived is worth keeping either way.
    await this.recordDeliveryOnLog(fyxoMessageId, eventType, error);

    const task = await this.prisma.task.findFirst({ where: { fyxoMessageId } });
    if (!task) return false;
    const status = eventType.replace(/^message\./, ""); // "message.delivered" -> "delivered"
    return this.applyDeliveryStatus(task.id, status, at, task.deliveredAt);
  }

  /**
   * Mirrors the provider's verdict onto the message log, so the Message Log
   * page shows what actually happened rather than "SENT" — which only ever
   * meant "Fyxo accepted it", not "it arrived". Meta's own error wording is
   * stored verbatim because it usually names the fix.
   */
  private async recordDeliveryOnLog(providerMessageId: string, eventType: string, error?: string) {
    const status = eventType.replace(/^message\./, "").toUpperCase();
    if (!["SENT", "DELIVERED", "READ", "FAILED"].includes(status)) return;
    try {
      await this.prisma.taskMessageLog.updateMany({
        // Only ever move forward. Fyxo does not guarantee ordering — a
        // message.sent has already been observed arriving after that same
        // message's delivered event — so writing the status unconditionally
        // lets a late event drag a row that reached READ back to SENT, which
        // reads on the Message Log as "the Cadre never opened it".
        where: { providerMessageId, status: { in: OVERWRITABLE_BY[status] } },
        data: { status, ...(error ? { failureReason: error } : {}) },
      });
    } catch (err) {
      this.logger.error(`Failed to record delivery status on message log: ${(err as Error).message}`);
    }
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
   * nest — e.g. a District Admin's scope contains a Constituency Admin's: once the
   * Constituency Admin allocates their Cadres, the batch must stay pending for the
   * District Admin if other Constituencies in the District still need allocating,
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
   * Constituency Admin's: once the Constituency Admin allocates their Cadres, the batch
   * must stay pending for the District Admin if other Constituencies in the
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
  /** Delegates to the shared rule so task routing and campaign assignment agree. */
  private findAdminsForRegions(targetRegionIds: string[]): Promise<{ id: string }[]> {
    return this.regionsService.adminsCovering(targetRegionIds);
  }

  /**
   * Scoped to the caller, never to the query string. A Cadre sees only their
   * own tasks; an Admin only those assigned inside their own region subtree.
   * Previously the filters were passed straight to Prisma, so any
   * authenticated user could read every task in the system by omitting them
   * — or read one specific Cadre's by passing their id.
   */
  async findMany(
    filters: { assignedToId?: string; status?: TaskStatus; campaignId?: string },
    user: AuthenticatedUser,
  ) {
    const where: Record<string, unknown> = { ...filters };

    if (user.role === "CADRE") {
      // Their own tasks only — an assignedToId in the query cannot widen this.
      where.assignedToId = user.id;
    } else if (user.role === "ADMIN") {
      const scoped = await this.regionsService.descendantIds(user.regionId);
      where.assignedTo = { regionId: { in: scoped } };
    }

    return this.prisma.task.findMany({
      where,
      include: { assignedTo: { select: { id: true, name: true } } },
      orderBy: { deadline: "asc" },
    });
  }

  /**
   * `user` is required: without it this returned any task to any
   * authenticated caller, so a Cadre could read every other Cadre's
   * assignments by id.
   */
  async findById(id: string, user: AuthenticatedUser) {
    const task = await this.prisma.task.findUnique({
      where: { id },
      include: {
        progress: { orderBy: { createdAt: "desc" } },
        attachments: true,
        assignedTo: { select: { regionId: true } },
      },
    });
    await this.assertTaskAccessible(task, user);
    return task!;
  }

  /**
   * Shared gate for reading or writing one task. A Cadre may only touch a
   * task assigned to them; an Admin only one inside their region subtree;
   * a Super Admin anything.
   *
   * Reports "not found" rather than "forbidden" for an out-of-scope task, so
   * the endpoint can't be used to confirm that a given task id exists.
   */
  private async assertTaskAccessible(
    task: { assignedToId: string; assignedTo: { regionId: string } } | null,
    user: AuthenticatedUser,
  ) {
    if (!task) throw new NotFoundException("Task not found");
    if (user.role === "SUPER_ADMIN") return;
    if (user.role === "CADRE") {
      if (task.assignedToId !== user.id) throw new NotFoundException("Task not found");
      return;
    }
    const scoped = new Set(await this.regionsService.descendantIds(user.regionId));
    if (!scoped.has(task.assignedTo.regionId)) throw new NotFoundException("Task not found");
  }

  async update(id: string, dto: UpdateTaskDto, user: AuthenticatedUser) {
    // Same gate as reading it — this was previously callable by any
    // authenticated user on any task, with no role guard at all.
    const task = await this.prisma.task.findUnique({
      where: { id },
      select: { assignedToId: true, assignedTo: { select: { regionId: true } } },
    });
    await this.assertTaskAccessible(task, user);
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
   * Sends the "Have you completed your task?" Yes/No check-in to one
   * Cadre — an explicit Admin action, not automatic, since not every task
   * needs one (see completionConfirmation's schema comment for why null vs
   * AWAITING matters). Requires FYXO_TEMPLATES.TASK_COMPLETION_CHECK to
   * actually be approved in Fyxo; until then FyxoWhatsAppService degrades
   * to a simulated send like every other Fyxo call in this app, so this
   * still "succeeds" but nothing real goes out.
   *
   * Recording the Yes/No reply itself happens on the webhook side once its
   * real button-tap payload shape is confirmed (see ConversationRouterService)
   * — not yet wired here.
   */
  async sendCompletionCheck(taskId: string, user: AuthenticatedUser) {
    if (user.role === "CADRE") {
      throw new ForbiddenException("Cadres cannot send completion checks");
    }

    const task = await this.prisma.task.findUnique({
      where: { id: taskId },
      include: {
        assignedTo: { select: { id: true, name: true, phone: true, regionId: true } },
        // The batch's creator owns both the template and the sheet tab;
        // assignedBy is the "Assigned By" column (and the creator fallback
        // for a task that has no batch).
        assignedBy: { select: TEMPLATE_OWNER_SELECT },
        batch: { select: { createdBy: { select: TEMPLATE_OWNER_SELECT } } },
      },
    });
    if (!task) throw new NotFoundException("Task not found");
    await this.assertVisible([task.assignedTo.regionId], user);

    if (task.status === "CANCELLED") {
      throw new BadRequestException(`${task.assignedTo.name} was removed from this task — nothing to check in on`);
    }

    const idempotencyKey = `completion-check-${task.id}-${Date.now()}`;
    const result = await this.fyxoWhatsApp.sendTemplateMessage({
      to: task.assignedTo.phone,
      templateName: FYXO_TEMPLATES.TASK_COMPLETION_CHECK.name,
      templateLanguage: FYXO_TEMPLATES.TASK_COMPLETION_CHECK.language,
      variables: [task.assignedTo.name],
      // Both Yes and No carry the task id; which one was tapped is told apart
      // by the button label Fyxo sends back as `text` (§11).
      buttonPayloads: [task.id, task.id],
      idempotencyKey,
    });

    // Logged before the failure throw below, so a failed check-in still
    // leaves a FAILED row rather than vanishing from the sheet entirely.
    await this.logMessage(
      task.assignedTo,
      renderFyxoBody(FYXO_TEMPLATES.TASK_COMPLETION_CHECK, [task.assignedTo.name]),
      result,
      this.taskMessageContext(task),
      "COMPLETION_CHECK",
      task.id,
      FYXO_TEMPLATES.TASK_COMPLETION_CHECK.name,
      [task.assignedTo.name],
    );

    if (!result.success) {
      throw new BadRequestException(`Failed to send completion check: ${result.error ?? "unknown error"}`);
    }

    return this.prisma.task.update({
      where: { id: taskId },
      data: {
        completionCheckSentAt: new Date(),
        completionCheckFyxoMessageId: result.messageId,
        completionConfirmation: "AWAITING",
      },
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

  /** Walks a region's parent chain to find its Constituency ancestor (or itself, if it already is one). */
  private resolveConstituencyLabel(
    regionId: string | null | undefined,
    regionById: Map<string, { id: string; name: string; type: string; parentId: string | null }>,
  ): string | null {
    let current = regionId ? regionById.get(regionId) : undefined;
    while (current) {
      if (current.type === "CONSTITUENCY") return current.name;
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
   * Who a task was actually allocated to, one row per Cadre.
   *
   * `id` may be a TaskBatch id (the usual case — a task sent to many
   * Cadres) or a single Task id, matching what taskDetail() accepts, so the
   * Campaign Details drawer can pass through whatever it was given.
   *
   * There is no per-Cadre numeric target in PoliOS: a Task row *is* the
   * allocation, carrying a status and ProgressUpdate rows rather than a
   * quota. So this reports real progress (latest reported percentage) and
   * delivery state, and does not invent a target/achieved split.
   */
  async allocations(id: string, user: AuthenticatedUser) {
    const batch = await this.prisma.taskBatch.findUnique({
      where: { id },
      select: { id: true, targetRegionIds: true, tasks: { select: { assignedTo: { select: { regionId: true } } } } },
    });

    if (batch) {
      await this.assertBatchVisible(batch, user);
    } else {
      const task = await this.prisma.task.findUnique({
        where: { id },
        select: { assignedTo: { select: { regionId: true } } },
      });
      if (!task) throw new NotFoundException("Task not found");
      await this.assertVisible([task.assignedTo.regionId], user);
    }

    const rows = await this.prisma.task.findMany({
      where: batch ? { batchId: batch.id } : { id },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        status: true,
        acknowledgment: true,
        acknowledgedAt: true,
        createdAt: true,
        completedAt: true,
        whatsappStatus: true,
        whatsappSentAt: true,
        deliveredAt: true,
        readAt: true,
        fyxoTemplateName: true,
        fyxoMessageId: true,
        assignedTo: {
          select: {
            id: true,
            name: true,
            phone: true,
            region: { select: { id: true, name: true, type: true } },
          },
        },
        progress: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { completionPercentage: true, createdAt: true },
        },
      },
    });

    // A Cadre may only see their own allocation row, never their peers'.
    const visible = user.role === "CADRE" ? rows.filter((r) => r.assignedTo.id === user.id) : rows;

    return visible.map((row) => ({
      taskId: row.id,
      cadre: {
        id: row.assignedTo.id,
        name: row.assignedTo.name,
        // Admins and Super Admins already manage these Cadres and can see
        // their numbers on the Cadres page, so this exposes nothing new.
        phone: row.assignedTo.phone,
      },
      area: row.assignedTo.region.name,
      areaType: row.assignedTo.region.type,
      assignedAt: row.createdAt,
      status: row.status,
      acknowledgment: row.acknowledgment,
      acknowledgedAt: row.acknowledgedAt,
      completedAt: row.completedAt,
      progressPct: row.progress[0]?.completionPercentage ?? 0,
      lastProgressAt: row.progress[0]?.createdAt ?? null,
      whatsapp: {
        status: row.whatsappStatus,
        sentAt: row.whatsappSentAt,
        deliveredAt: row.deliveredAt,
        readAt: row.readAt,
        templateName: row.fyxoTemplateName,
        messageId: row.fyxoMessageId,
      },
    }));
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
      // A batch this Admin has already partially allocated (e.g. one Constituency
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
        // TEMPLATE_OWNER_SELECT, not just the name: the creator also decides
        // which WhatsApp template goes out, which the allocating Admin needs
        // to see before they send (see outgoingTemplate below).
        createdBy: { select: TEMPLATE_OWNER_SELECT },
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
        user.role !== "CADRE" && batch.awaitingAllocation
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
        remarks: batch.remarks,
        districts: regions.filter((r) => r.type === "DISTRICT").map((r) => r.name),
        constituencies: regions.filter((r) => r.type === "CONSTITUENCY").map((r) => r.name),
        booths: regions.filter((r) => r.type === "BOOTH").map((r) => r.name),
        officialLocation: await this.officialLocation(batch.pollingStationId),
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
        // Exactly what will go out when this is allocated — resolved the same
        // way the send resolves it, so the Admin is never guessing. `preview`
        // substitutes a stand-in for {{1}} (the Cadre's real name at send
        // time) so they read what the Cadre reads, not a placeholder.
        outgoingTemplate: (() => {
          const template = MessageTemplatesService.resolveFor(batch.createdBy);
          return {
            name: template.name,
            language: template.language,
            body: template.body ?? null,
            preview: template.body ? renderFyxoBody(template, ["<Cadre name>"]) : null,
            isDefault: !batch.createdBy.fyxoTemplateName,
            // Trimmed: names are stored as typed and several carry trailing
            // spaces, which render as "Rahul Chintha 's template".
            ownerName: batch.createdBy.name.trim(),
          };
        })(),
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
      remarks: task.remarks,
      districts: task.assignedTo.region.type === "DISTRICT" ? [task.assignedTo.region.name] : [],
      constituencies: task.assignedTo.region.type === "CONSTITUENCY" ? [task.assignedTo.region.name] : [],
      booths: task.assignedTo.region.type === "BOOTH" ? [task.assignedTo.region.name] : [],
      // Falls back to the Cadre's own station when the task didn't name one
      // — that is where the work physically happens either way.
      officialLocation: await this.officialLocation(task.pollingStationId ?? task.assignedTo.regionId),
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
      completionCheckSentAt: Date | null;
      completionConfirmation: string | null;
      completionConfirmedAt: Date | null;
      createdAt: Date;
      assignedTo: { id: string; name: string; regionId: string; region: { name: string; type: string } };
      progress: { completionPercentage: number; createdAt: Date }[];
    }[];
    let name: string;
    let remarks: string | null;
    let isBatch: boolean;
    // A batch routed to Admins but not yet handed to any Cadre has no Task
    // rows at all, so every KPI below is legitimately zero. Saying so beats
    // a screen of zeros that reads as a broken dashboard.
    let awaitingAllocation = false;

    if (batch) {
      await this.assertBatchVisible(batch, user);
      tasks = batch.tasks;
      name = batch.name;
      remarks = batch.remarks;
      isBatch = true;
      awaitingAllocation = batch.awaitingAllocation;
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

    // Delivery prefers the message log over Task.whatsappStatus. Both are
    // written by the same webhook, but only the log is updated when a
    // message is resent from the Message Log page — that path never rewrites
    // Task.fyxoMessageId, so the column freezes at its old status while the
    // log moves on.
    //
    // Falls back to the task's own column where the log has nothing: sends
    // from before the log recorded which task a message belonged to left
    // those rows with taskId null, and reading the log alone would report
    // real, delivered messages as zero. The log wins wherever it has an
    // answer; the column only fills the gaps it can't cover.
    //
    // Per recipient, not per message: one Task row is one Cadre, so a Cadre
    // who needed a retry is counted once however many times we messaged.
    const loggedStatus = await this.messageLog.latestStatusByTask(activeTasks.map((t) => t.id));
    const perCadreStatus = activeTasks.map((t) => loggedStatus.get(t.id) ?? t.whatsappStatus);
    const delivery = MessageLogService.rollUp(perCadreStatus);
    const whatsappSent = delivery.sent;
    const whatsappDelivered = delivery.delivered;
    const whatsappRead = delivery.read;
    const whatsappFailed = delivery.failed;
    const responded = activeTasks.filter((t) => t.acknowledgment !== "AWAITING").length;

    // "Have you completed your task?" check-in — only counted among Cadres
    // an Admin actually asked (completionConfirmation !== null); most tasks
    // are never asked at all, and those shouldn't dilute the Yes/No split.
    const asked = activeTasks.filter((t) => t.completionConfirmation !== null);
    const completionYes = asked.filter((t) => t.completionConfirmation === "YES").length;
    const completionNo = asked.filter((t) => t.completionConfirmation === "NO").length;
    const completionAwaiting = asked.filter((t) => t.completionConfirmation === "AWAITING").length;

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
      completionAsked: asked.length,
      completionYes,
      completionNo,
      completionAwaiting,
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
      const lastActivityAt = [
        t.whatsappSentAt,
        t.deliveredAt,
        t.readAt,
        t.acknowledgedAt,
        t.completedAt,
        t.completionCheckSentAt,
        t.completionConfirmedAt,
        t.progress[0]?.createdAt,
      ]
        .filter((d): d is Date => d instanceof Date)
        .sort((a, b) => b.getTime() - a.getTime())[0];
      return {
        taskId: t.id,
        name: t.assignedTo.name,
        area: `${t.assignedTo.region.name} (${t.assignedTo.region.type})`,
        constituency: this.resolveConstituencyLabel(t.assignedTo.regionId, regionById),
        status: t.status,
        acknowledgment: t.acknowledgment,
        acknowledgedAt: t.acknowledgedAt,
        needsReassignment: t.needsReassignment,
        progressPct: this.progressPct(t),
        whatsappStatus: t.whatsappStatus,
        whatsappSentAt: t.whatsappSentAt,
        completionConfirmation: t.completionConfirmation,
        completionCheckSentAt: t.completionCheckSentAt,
        completionConfirmedAt: t.completionConfirmedAt,
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

    // Message-level totals alongside the per-recipient ones in `kpis`. The
    // two answer different questions and will legitimately differ the moment
    // anything is retried: `kpis.whatsappSent` is how many Cadres we reached,
    // `communication.total` is how many messages that took.
    const communication = await this.messageLog.communicationStats({ taskId: { in: activeTasks.map((t) => t.id) } });

    return {
      id,
      isBatch,
      name,
      remarks,
      awaitingAllocation,
      kpis,
      cadres,
      dailyProgress,
      progressFunnel,
      communication,
      timeline: timeline.slice(0, 50),
    };
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
