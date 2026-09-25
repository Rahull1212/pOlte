import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { CreatePollDto, AllocatePollDto } from "../shared-types";
import { PrismaService } from "../prisma/prisma.service";
import { AuthenticatedUser } from "../auth/types";
import { RegionsService } from "../regions/regions.service";
import { NotificationsService } from "../notifications/notifications.service";
import { FyxoWhatsAppService } from "../fyxo-whatsapp/fyxo-whatsapp.service";
import { FYXO_TEMPLATES } from "../fyxo-whatsapp/templates";
import { MessageLogService } from "../message-log/message-log.service";

/**
 * Polls follow the exact same two-step shape as Tasks (see TasksService):
 * create() only creates the record (awaitingAllocation: true, zero
 * recipients) and routes a notification to whichever Admins cover the
 * area; nothing is sent to any Cadre until allocate() is explicitly called.
 *
 * Delivery uses FYXO_TEMPLATES.POLL, a single generic template with fixed
 * "Option A/B/C" buttons — see that constant's doc comment for why the
 * real option text lives in the message body instead of the buttons.
 * Recording which option a Cadre actually tapped is NOT wired yet: that
 * needs the same webhook button-tap correlation TasksService's Task
 * Details button and completion check-in are already blocked on (a real
 * payload has never been captured) — see ConversationRouterService. Once
 * that's confirmed, the fix plugs in there for all three at once, not here.
 */
@Injectable()
export class PollsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly regionsService: RegionsService,
    private readonly notificationsService: NotificationsService,
    private readonly fyxoWhatsApp: FyxoWhatsAppService,
    private readonly messageLog: MessageLogService,
  ) {}

  async create(dto: CreatePollDto, user: AuthenticatedUser) {
    if (user.role === "CADRE") {
      throw new ForbiddenException("Cadres cannot create polls");
    }
    if (user.role !== "SUPER_ADMIN") {
      for (const regionId of dto.regionIds) {
        const withinScope = await this.regionsService.isWithinScope(user.regionId, regionId);
        if (!withinScope) {
          throw new ForbiddenException("One or more selected areas are outside your own area");
        }
      }
    }

    // The template's own Quick Replies are the answers. Copied onto the poll
    // now rather than read back at send time, so a poll keeps meaning what it
    // meant even if that template is later edited or un-approved.
    const template = await this.prisma.availableTemplate.findUnique({ where: { name: dto.templateName } });
    if (!template) {
      throw new BadRequestException(`Template "${dto.templateName}" is not in the synced list — run Sync templates first`);
    }
    if (template.status && template.status !== "APPROVED") {
      throw new BadRequestException(`Template "${template.name}" is ${template.status}; WhatsApp will refuse it`);
    }
    if (template.buttons.length < 2) {
      throw new BadRequestException(
        `Template "${template.name}" has ${template.buttons.length} button(s) — a poll needs at least 2 for the Cadre to choose between`,
      );
    }
    // A poll template carries exactly one dynamic value: the question. A
    // template wanting more has slots PoliOS cannot fill from a poll, and
    // they would go out as em dashes in the middle of the Cadre's message.
    if (template.variables !== null && template.variables > 1) {
      throw new BadRequestException(
        `Template "${template.name}" expects ${template.variables} variables — a poll template must take exactly one, the question itself`,
      );
    }

    // A task the poll hangs off must be one this user can actually see;
    // otherwise the poll becomes a way to probe for task ids.
    if (dto.taskId) {
      const task = await this.prisma.task.findUnique({
        where: { id: dto.taskId },
        select: { assignedTo: { select: { regionId: true } } },
      });
      if (!task) throw new NotFoundException("Task not found");
      if (user.role !== "SUPER_ADMIN") {
        const withinScope = await this.regionsService.isWithinScope(user.regionId, task.assignedTo.regionId);
        if (!withinScope) throw new NotFoundException("Task not found");
      }
    }

    const poll = await this.prisma.poll.create({
      data: {
        question: dto.question,
        options: template.buttons,
        templateName: template.name,
        templateLanguage: dto.templateLanguage ?? template.language,
        taskId: dto.taskId,
        targetRegionIds: dto.regionIds,
        deadline: dto.deadline,
        createdById: user.id,
        awaitingAllocation: true,
      },
    });

    const admins = await this.findAdminsForRegions(dto.regionIds);
    if (admins.length > 0) {
      await this.notificationsService.notifyMany(
        admins.map((a) => a.id),
        {
          type: "POLL_PENDING_ALLOCATION",
          title: "Poll awaiting your allocation",
          message: `"${dto.question}" was created and is ready to send to your Cadres.`,
          relatedEntityType: "Poll",
          relatedEntityId: poll.id,
        },
      );
    }

    return poll;
  }

  /**
   * Sends the poll to Cadres — the step that actually calls Fyxo. Same
   * area-broadcast-and/or-named-Cadre shape as TasksService.allocateToCadres,
   * duplicated here rather than shared since the two services otherwise
   * have little in common (no batches, no acknowledgment/progress lifecycle).
   */
  async allocate(pollId: string, input: AllocatePollDto, user: AuthenticatedUser) {
    if (user.role !== "ADMIN") {
      throw new ForbiddenException("Only Admins allocate polls to Cadres");
    }

    const poll = await this.prisma.poll.findUnique({ where: { id: pollId } });
    if (!poll) throw new NotFoundException("Poll not found");
    if (!poll.awaitingAllocation) {
      throw new BadRequestException("This poll has already been allocated");
    }

    const assertRegionEligible = async (regionId: string) => {
      const withinAdminScope = await this.regionsService.isWithinScope(user.regionId, regionId);
      if (!withinAdminScope) {
        throw new ForbiddenException("One or more selected areas are outside your own area");
      }
      const relatesToTarget = await Promise.all(
        poll.targetRegionIds.map(
          async (t) =>
            (await this.regionsService.isWithinScope(t, regionId)) || (await this.regionsService.isWithinScope(regionId, t)),
        ),
      );
      if (!relatesToTarget.some(Boolean)) {
        throw new ForbiddenException("Selected areas must be within this poll's original target area(s)");
      }
    };

    const existingRecipients = await this.prisma.pollRecipient.findMany({ where: { pollId }, select: { cadreId: true } });
    const alreadySent = new Set(existingRecipients.map((r) => r.cadreId));

    const cadreMap = new Map<string, { id: string }>();

    if (input.regionIds.length > 0) {
      for (const regionId of input.regionIds) {
        await assertRegionEligible(regionId);
      }
      const descendantSets = await Promise.all(input.regionIds.map((id) => this.regionsService.descendantIds(id)));
      const scopedRegionIds = Array.from(new Set(descendantSets.flat()));
      const areaCadres = await this.prisma.user.findMany({
        where: { role: "CADRE", isActive: true, regionId: { in: scopedRegionIds } },
        select: { id: true },
      });
      for (const c of areaCadres) {
        if (!alreadySent.has(c.id)) cadreMap.set(c.id, c);
      }
    }

    if (input.cadreIds.length > 0) {
      const namedCadres = await this.prisma.user.findMany({
        where: { id: { in: input.cadreIds }, role: "CADRE", isActive: true },
        select: { id: true, regionId: true },
      });
      if (namedCadres.length !== input.cadreIds.length) {
        throw new BadRequestException("One or more selected Cadres could not be found or are inactive");
      }
      for (const cadre of namedCadres) {
        if (alreadySent.has(cadre.id) || cadreMap.has(cadre.id)) continue;
        const withinScope = await this.regionsService.isWithinScope(user.regionId, cadre.regionId);
        if (!withinScope) throw new ForbiddenException("One or more selected Cadres are outside your own area");
        await assertRegionEligible(cadre.regionId);
        cadreMap.set(cadre.id, cadre);
      }
    }

    const cadres = Array.from(cadreMap.values());
    if (cadres.length === 0) {
      throw new BadRequestException("No new active Cadres found for the selected area(s)/Cadre(s)");
    }

    const cadreUsers = await this.prisma.user.findMany({ where: { id: { in: cadres.map((c) => c.id) } }, select: { id: true, name: true, phone: true } });

    // The template chosen when the poll was created; its buttons are the
    // answers. Older polls have none and fall back to the generic one.
    const templateName = poll.templateName ?? FYXO_TEMPLATES.POLL.name;
    const templateLanguage = poll.templateLanguage ?? FYXO_TEMPLATES.POLL.language;
    const declared = await this.prisma.availableTemplate.findUnique({
      where: { name: templateName },
      select: { variables: true },
    });

    // {{1}} is the poll question, and nothing else is.
    //
    // Fyxo's `variables` is a positional array posted straight to
    // POST /v1/messages, so variables[0] IS {{1}} — there are no named
    // parameters to get wrong. It previously led with the Cadre's name,
    // which on a one-variable template meant the recipient read their own
    // name where the question belonged.
    //
    // The Cadre's name is deliberately NOT passed: a poll template greets
    // generically and asks one thing. Any slot beyond the first gets an em
    // dash rather than failing the send, though create() blocks
    // multi-variable templates so that should not arise.
    const variablesFor = () => {
      const count = Math.max(1, declared?.variables ?? 1);
      const values = [poll.question];
      return Array.from({ length: count }, (_, i) => (values[i] ?? "—").replace(/\s+/g, " ").trim() || "—");
    };

    const results = await Promise.all(
      cadreUsers.map(async (cadre) => {
        const idempotencyKey = `poll-${poll.id}-${cadre.id}`;
        const variables = variablesFor();
        const result = await this.fyxoWhatsApp.sendTemplateMessage({
          to: cadre.phone,
          templateName,
          templateLanguage,
          variables,
          idempotencyKey,
        });
        return { cadre, result, variables };
      }),
    );

    // Logged like any other send. This is what makes answers capturable at
    // all: the button-tap router correlates an inbound tap to the
    // recipient's most recent logged message, so a poll that never appeared
    // in the log could never be matched to a tap.
    await Promise.all(
      results.map(({ cadre, result, variables }) =>
        this.messageLog
          .record({
            cadreId: cadre.id,
            cadreName: cadre.name,
            cadrePhone: cadre.phone,
            message: poll.question,
            pollId: poll.id,
            taskId: poll.taskId ?? undefined,
            assignedById: user.id,
            assignedByName: user.name,
            kind: "POLL",
            templateName,
            variables,
            channel: "FYXO",
            success: result.success,
            providerMessageId: result.messageId ?? undefined,
            failureReason: result.error ?? undefined,
          })
          .catch(() => undefined),
      ),
    );

    await this.prisma.$transaction([
      ...results.map(({ cadre, result }) =>
        this.prisma.pollRecipient.create({
          data: {
            pollId: poll.id,
            cadreId: cadre.id,
            status: result.success ? "SENT" : "FAILED",
            fyxoMessageId: result.success ? result.messageId : undefined,
            sentAt: result.success ? new Date() : undefined,
          },
        }),
      ),
      this.prisma.poll.update({ where: { id: poll.id }, data: { awaitingAllocation: false } }),
    ]);

    const sentCount = results.filter((r) => r.result.success).length;
    return { sentCount, failedCount: results.length - sentCount };
  }

  /** Every poll a Super Admin created, or an Admin created/was routed. Region-scoped like listTasks. */
  async list(user: AuthenticatedUser) {
    const regionIds = user.role === "SUPER_ADMIN" ? undefined : await this.regionsService.descendantIds(user.regionId);

    const polls = await this.prisma.poll.findMany({
      where: regionIds
        ? {
            OR: [{ createdById: user.id }, { recipients: { some: { cadre: { regionId: { in: regionIds } } } } }, { awaitingAllocation: true }],
          }
        : undefined,
      include: {
        createdBy: { select: { name: true } },
        recipients: { select: { status: true, selectedOption: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    // Awaiting-allocation polls a Super Admin didn't create themselves, or
    // that don't actually overlap this Admin's scope, still slipped through
    // the OR above (recipients-based filtering can't apply before anyone's
    // been sent anything) — narrow those down the same way
    // findPendingAllocationBatchesForAdmin does for tasks.
    const filtered = regionIds
      ? await Promise.all(
          polls.map(async (p) => {
            if (p.recipients.length > 0) return p;
            if (p.createdById === user.id) return p;
            const overlaps = await this.targetOverlapsScope(p.targetRegionIds, new Set(regionIds));
            return overlaps ? p : null;
          }),
        )
      : polls;

    return filtered
      .filter((p): p is NonNullable<typeof p> => p !== null)
      .map((p) => ({
        id: p.id,
        question: p.question,
        options: p.options,
        awaitingAllocation: p.awaitingAllocation,
        recipientCount: p.recipients.length,
        answeredCount: p.recipients.filter((r) => r.selectedOption !== null).length,
        createdByName: p.createdBy.name,
        deadline: p.deadline,
        createdAt: p.createdAt,
      }));
  }

  async getDetail(id: string, user: AuthenticatedUser) {
    const poll = await this.prisma.poll.findUnique({
      where: { id },
      include: {
        createdBy: { select: { name: true } },
        recipients: {
          include: { cadre: { select: { id: true, name: true, region: { select: { name: true, type: true } } } } },
        },
      },
    });
    if (!poll) throw new NotFoundException("Poll not found");

    if (user.role !== "SUPER_ADMIN") {
      const scopeIds = new Set(await this.regionsService.descendantIds(user.regionId));
      const visible =
        poll.createdById === user.id ||
        poll.recipients.length > 0 ||
        (await this.targetOverlapsScope(poll.targetRegionIds, scopeIds));
      if (!visible) throw new ForbiddenException("This poll is outside your area");
    }

    const regions = await this.prisma.region.findMany({
      where: { id: { in: poll.targetRegionIds } },
      select: { name: true, type: true },
    });

    return {
      id: poll.id,
      question: poll.question,
      options: poll.options,
      districts: regions.map((r) => `${r.name} (${r.type})`),
      awaitingAllocation: poll.awaitingAllocation,
      deadline: poll.deadline,
      createdByName: poll.createdBy.name,
      createdAt: poll.createdAt,
      recipients: poll.recipients.map((r) => ({
        id: r.id,
        cadreName: r.cadre?.name ?? "Deleted user",
        area: r.cadre ? `${r.cadre.region.name} (${r.cadre.region.type})` : "—",
        status: r.status,
        selectedOption: r.selectedOption,
        answeredAt: r.answeredAt,
      })),
    };
  }

  /**
   * The Poll Dashboard: KPIs, the real vote tally, a per-Cadre response
   * table, and an activity timeline — same idea as
   * TasksService.getTaskDashboard, scoped to exactly one poll. Kept
   * separate from getDetail() so the detail page stays a light overview
   * (mirrors how Task's detail page shows Assigned Members but not the
   * full analytics breakdown).
   */
  async getDashboard(id: string, user: AuthenticatedUser) {
    const poll = await this.prisma.poll.findUnique({
      where: { id },
      include: {
        recipients: {
          include: { cadre: { select: { id: true, name: true, regionId: true, region: { select: { name: true, type: true } } } } },
        },
      },
    });
    if (!poll) throw new NotFoundException("Poll not found");

    if (user.role !== "SUPER_ADMIN") {
      const scopeIds = new Set(await this.regionsService.descendantIds(user.regionId));
      const visible =
        poll.createdById === user.id ||
        poll.recipients.length > 0 ||
        (await this.targetOverlapsScope(poll.targetRegionIds, scopeIds));
      if (!visible) throw new ForbiddenException("This poll is outside your area");
    }

    const recipients = poll.recipients;

    // The real answers: button taps captured against this poll's messages.
    // PollRecipient.selectedOption predates tap capture and is never written,
    // so reading only that reported every poll as unanswered. Taps win; the
    // old column is still honoured for any row that has one.
    const taps = await this.prisma.templateResponse.findMany({
      where: { messageLog: { pollId: poll.id }, responseType: "BUTTON" },
      orderBy: { respondedAt: "desc" },
      select: { cadreId: true, label: true, action: true, respondedAt: true },
    });

    // Newest tap per Cadre wins — changing your mind is answering again, not
    // answering twice.
    const answerByCadre = new Map<string, { optionIndex: number; label: string; at: Date }>();
    for (const tap of taps) {
      if (!tap.cadreId || answerByCadre.has(tap.cadreId)) continue;
      const label = (tap.label ?? tap.action ?? "").trim();
      const optionIndex = poll.options.findIndex((o) => o.toLowerCase() === label.toLowerCase());
      // A tap whose label matches no option still counts as a response — it
      // just can't be tallied against a specific one.
      answerByCadre.set(tap.cadreId, { optionIndex, label, at: tap.respondedAt });
    }

    /** What this recipient answered, tap first, stored column second. */
    const answerFor = (r: (typeof recipients)[number]) => {
      const tap = r.cadreId ? answerByCadre.get(r.cadreId) : undefined;
      if (tap) return { index: tap.optionIndex, label: tap.label, at: tap.at };
      if (r.selectedOption !== null) {
        return { index: r.selectedOption, label: poll.options[r.selectedOption] ?? "—", at: r.answeredAt };
      }
      return null;
    };
    // "Sent" here means the outbound API call succeeded (SENT or, once
    // wired, ANSWERED) — distinct from FAILED, where it didn't go out at
    // all. answered/noResponse are both counted against sent, not
    // totalRecipients, so a failed send doesn't get counted as "didn't
    // respond" alongside someone who genuinely received it and stayed quiet.
    const sent = recipients.filter((r) => r.status === "SENT" || r.status === "ANSWERED").length;
    const failed = recipients.filter((r) => r.status === "FAILED").length;
    const answered = recipients.filter((r) => answerFor(r) !== null).length;
    const noResponse = sent - answered;

    const kpis = {
      totalRecipients: recipients.length,
      sent,
      failed,
      answered,
      noResponse,
      responseRatePct: sent > 0 ? Math.round((answered / sent) * 100) : 0,
    };

    // Real vote tally per option index — a null cadre (their account was
    // since deleted, see UsersService.remove) still counts toward the
    // tally, just shown without a name in `respondents` below.
    const tally = poll.options.map((option, i) => ({
      option,
      votes: recipients.filter((r) => answerFor(r)?.index === i).length,
    }));

    const respondents = recipients.map((r) => {
      const answer = answerFor(r);
      return {
        id: r.id,
        cadreName: r.cadre?.name ?? "Deleted user",
        area: r.cadre ? `${r.cadre.region.name} (${r.cadre.region.type})` : "—",
        status: r.status,
        selectedOption: answer && answer.index >= 0 ? answer.index : null,
        // The label as tapped, so an answer that matches no known option is
        // still readable rather than collapsing to a dash.
        answerLabel: answer?.label ?? null,
        sentAt: r.sentAt,
        answeredAt: answer?.at ?? r.answeredAt,
      };
    });

    type TimelineEvent = { type: "SENT" | "ANSWERED"; cadreName: string; at: Date; detail?: string };
    const timeline: TimelineEvent[] = [];
    for (const r of recipients) {
      const name = r.cadre?.name ?? "Deleted user";
      if (r.sentAt) timeline.push({ type: "SENT", cadreName: name, at: r.sentAt });
      const answer = answerFor(r);
      if (answer?.at) {
        timeline.push({ type: "ANSWERED", cadreName: name, at: answer.at, detail: answer.label });
      }
    }
    timeline.sort((a, b) => b.at.getTime() - a.at.getTime());

    return {
      id: poll.id,
      question: poll.question,
      options: poll.options,
      templateName: poll.templateName,
      taskId: poll.taskId,
      createdAt: poll.createdAt,
      deadline: poll.deadline,
      kpis,
      tally,
      respondents,
      timeline,
    };
  }

  /**
   * Re-sends one recipient's poll message — for when the original send
   * failed. Same idea as TasksService.retryWhatsapp, targeting a
   * PollRecipient row directly (not the poll id).
   */
  async retryWhatsapp(recipientId: string, user: AuthenticatedUser) {
    const recipient = await this.prisma.pollRecipient.findUnique({
      where: { id: recipientId },
      include: { poll: true, cadre: { select: { id: true, name: true, phone: true, regionId: true } } },
    });
    if (!recipient) throw new NotFoundException("Poll recipient not found");
    if (!recipient.cadre) {
      throw new BadRequestException("This Cadre's account no longer exists");
    }
    if (user.role !== "SUPER_ADMIN") {
      const withinScope = await this.regionsService.isWithinScope(user.regionId, recipient.cadre.regionId);
      if (!withinScope) throw new ForbiddenException("This poll is outside your area");
    }

    // The poll's own template, exactly as allocate() sends it. Hardcoding the
    // generic one here meant a retry was a DIFFERENT message from the
    // original — and pointed at a template that isn't even in the catalogue.
    const templateName = recipient.poll.templateName ?? FYXO_TEMPLATES.POLL.name;
    const templateLanguage = recipient.poll.templateLanguage ?? FYXO_TEMPLATES.POLL.language;
    const declared = await this.prisma.availableTemplate.findUnique({
      where: { name: templateName },
      select: { variables: true },
    });
    // Same rule as the original send: {{1}} is the question, never a name.
    const count = Math.max(1, declared?.variables ?? 1);
    const values = [recipient.poll.question];
    const variables = Array.from({ length: count }, (_, i) =>
      (values[i] ?? "—").replace(/\s+/g, " ").trim() || "—",
    );

    const idempotencyKey = `poll-${recipient.pollId}-${recipient.cadreId}-retry-${Date.now()}`;
    const result = await this.fyxoWhatsApp.sendTemplateMessage({
      to: recipient.cadre.phone,
      templateName,
      templateLanguage,
      variables,
      idempotencyKey,
    });

    // Logged like the original send, so a retry that is answered correlates
    // to the poll the same way — without this the tap would attribute to
    // whatever older message happened to be the newest one on record.
    await this.messageLog
      .record({
        cadreId: recipient.cadre.id,
        cadreName: recipient.cadre.name,
        cadrePhone: recipient.cadre.phone,
        message: recipient.poll.question,
        pollId: recipient.pollId,
        taskId: recipient.poll.taskId ?? undefined,
        assignedById: user.id,
        assignedByName: user.name,
        kind: "RETRY",
        templateName,
        variables,
        channel: "FYXO",
        success: result.success,
        providerMessageId: result.messageId ?? undefined,
        failureReason: result.error ?? undefined,
      })
      .catch(() => undefined);

    return this.prisma.pollRecipient.update({
      where: { id: recipientId },
      data: {
        status: result.success ? "SENT" : "FAILED",
        fyxoMessageId: result.success ? result.messageId : recipient.fyxoMessageId,
        sentAt: result.success ? new Date() : recipient.sentAt,
      },
    });
  }

  private async targetOverlapsScope(targetRegionIds: string[], scopeIds: Set<string>): Promise<boolean> {
    if (targetRegionIds.some((t) => scopeIds.has(t))) return true;
    const targetDescendantSets = await Promise.all(targetRegionIds.map((id) => this.regionsService.descendantIds(id)));
    return targetDescendantSets.some((set) => Array.from(scopeIds).some((s) => set.includes(s)));
  }

  /** Every active Admin whose own region scope overlaps any of the given target region(s) — same rule as TasksService.findAdminsForRegions. */
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
}
