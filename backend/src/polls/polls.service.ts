import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { CreatePollDto, AllocatePollDto } from "../shared-types";
import { PrismaService } from "../prisma/prisma.service";
import { AuthenticatedUser } from "../auth/types";
import { RegionsService } from "../regions/regions.service";
import { NotificationsService } from "../notifications/notifications.service";
import { FyxoWhatsAppService } from "../fyxo-whatsapp/fyxo-whatsapp.service";
import { FYXO_TEMPLATES } from "../fyxo-whatsapp/templates";

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

    const poll = await this.prisma.poll.create({
      data: {
        question: dto.question,
        options: dto.options,
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

    // Fixed A/B/C body slots regardless of how many real options this poll
    // has — see FYXO_TEMPLATES.POLL.
    const optionText = (i: number) => poll.options[i] ?? "—";

    const results = await Promise.all(
      cadreUsers.map(async (cadre) => {
        const idempotencyKey = `poll-${poll.id}-${cadre.id}`;
        const result = await this.fyxoWhatsApp.sendTemplateMessage({
          to: cadre.phone,
          templateName: FYXO_TEMPLATES.POLL.name,
          templateLanguage: FYXO_TEMPLATES.POLL.language,
          variables: [cadre.name, poll.question, optionText(0), optionText(1), optionText(2)],
          idempotencyKey,
        });
        return { cadre, result };
      }),
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
    // "Sent" here means the outbound API call succeeded (SENT or, once
    // wired, ANSWERED) — distinct from FAILED, where it didn't go out at
    // all. answered/noResponse are both counted against sent, not
    // totalRecipients, so a failed send doesn't get counted as "didn't
    // respond" alongside someone who genuinely received it and stayed quiet.
    const sent = recipients.filter((r) => r.status === "SENT" || r.status === "ANSWERED").length;
    const failed = recipients.filter((r) => r.status === "FAILED").length;
    const answered = recipients.filter((r) => r.selectedOption !== null).length;
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
      votes: recipients.filter((r) => r.selectedOption === i).length,
    }));

    const respondents = recipients.map((r) => ({
      id: r.id,
      cadreName: r.cadre?.name ?? "Deleted user",
      area: r.cadre ? `${r.cadre.region.name} (${r.cadre.region.type})` : "—",
      status: r.status,
      selectedOption: r.selectedOption,
      sentAt: r.sentAt,
      answeredAt: r.answeredAt,
    }));

    type TimelineEvent = { type: "SENT" | "ANSWERED"; cadreName: string; at: Date; detail?: string };
    const timeline: TimelineEvent[] = [];
    for (const r of recipients) {
      const name = r.cadre?.name ?? "Deleted user";
      if (r.sentAt) timeline.push({ type: "SENT", cadreName: name, at: r.sentAt });
      if (r.answeredAt) {
        timeline.push({
          type: "ANSWERED",
          cadreName: name,
          at: r.answeredAt,
          detail: r.selectedOption !== null ? poll.options[r.selectedOption] : undefined,
        });
      }
    }
    timeline.sort((a, b) => b.at.getTime() - a.at.getTime());

    return { id: poll.id, question: poll.question, options: poll.options, kpis, tally, respondents, timeline };
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

    const optionText = (i: number) => recipient.poll.options[i] ?? "—";
    const idempotencyKey = `poll-${recipient.pollId}-${recipient.cadreId}-retry-${Date.now()}`;
    const result = await this.fyxoWhatsApp.sendTemplateMessage({
      to: recipient.cadre.phone,
      templateName: FYXO_TEMPLATES.POLL.name,
      templateLanguage: FYXO_TEMPLATES.POLL.language,
      variables: [recipient.cadre.name, recipient.poll.question, optionText(0), optionText(1), optionText(2)],
      idempotencyKey,
    });

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
