import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuthenticatedUser } from "../auth/types";
import { FyxoWhatsAppService } from "../fyxo-whatsapp/fyxo-whatsapp.service";
import { MessageTemplatesService } from "../message-templates/message-templates.service";
import { MessageLogService } from "./message-log.service";
import { TEMPLATE_BUTTON_ACTIONS, renderFyxoBody, taskButtonPayloads } from "../fyxo-whatsapp/templates";

export interface EngagementFilters {
  campaignId?: string;
  taskId?: string;
  /**
   * A whole task batch — one fan-out to many Cadres. The Task Dashboard is
   * addressed by batch id far more often than by a single task id, and
   * filtering on taskId with a batch id silently matches nothing.
   */
  batchId?: string;
  /** One poll — its answers are button presses on the poll's own template. */
  pollId?: string;
  from?: string;
  to?: string;
}

/**
 * Who responded to the messages we sent, and who didn't.
 *
 * "Responded" means a TemplateResponse row exists for that send — a real
 * inbound interaction, not a delivery receipt. DELIVERED and READ say the
 * phone got it; only a tap or a reply says the person acted on it. Both are
 * reported side by side so a silent Cadre can be told apart from a message
 * that never landed.
 */
@Injectable()
export class EngagementService {
  private readonly logger = new Logger(EngagementService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly fyxo: FyxoWhatsAppService,
    private readonly messageTemplates: MessageTemplatesService,
    private readonly messageLog: MessageLogService,
  ) {}

  /** An Admin sees only their own sends; a Super Admin sees everything. */
  private scope(user: AuthenticatedUser, filters: EngagementFilters) {
    const where: Record<string, unknown> = {};
    if (user.role === "ADMIN") where.assignedById = user.id;
    if (filters.taskId) where.taskId = filters.taskId;
    if (filters.pollId) where.pollId = filters.pollId;
    // Both narrow the same relation, so they are merged rather than one
    // overwriting the other.
    const taskWhere: Record<string, unknown> = {};
    if (filters.batchId) taskWhere.batchId = filters.batchId;
    if (filters.campaignId) taskWhere.campaignId = filters.campaignId;
    if (Object.keys(taskWhere).length > 0) where.task = taskWhere;
    if (filters.from || filters.to) {
      where.sentAt = {
        ...(filters.from ? { gte: new Date(filters.from) } : {}),
        ...(filters.to ? { lte: new Date(filters.to) } : {}),
      };
    }
    return where;
  }

  /**
   * One row per message sent, with whatever the recipient did about it.
   *
   * Built from the outbound log rather than from responses, because the
   * people who matter most here are the ones with no response at all — they
   * exist only on the outbound side.
   */
  async recipients(filters: EngagementFilters, user: AuthenticatedUser) {
    const messages = await this.prisma.taskMessageLog.findMany({
      where: this.scope(user, filters),
      orderBy: { sentAt: "desc" },
      select: {
        id: true,
        cadreId: true,
        cadreName: true,
        cadrePhone: true,
        taskId: true,
        taskName: true,
        templateName: true,
        kind: true,
        status: true,
        failureReason: true,
        sentAt: true,
        assignedByName: true,
        task: { select: { campaign: { select: { id: true, name: true } } } },
      },
    });

    if (messages.length === 0) return [];

    const responses = await this.prisma.templateResponse.findMany({
      where: { messageLogId: { in: messages.map((m) => m.id) } },
      orderBy: { respondedAt: "asc" },
      select: { messageLogId: true, action: true, label: true, responseType: true, respondedAt: true },
    });

    const byMessage = new Map<string, typeof responses>();
    for (const r of responses) {
      if (!r.messageLogId) continue;
      byMessage.set(r.messageLogId, [...(byMessage.get(r.messageLogId) ?? []), r]);
    }

    return messages.map((m) => {
      const own = byMessage.get(m.id) ?? [];
      return {
        messageId: m.id,
        cadreId: m.cadreId,
        cadreName: m.cadreName,
        cadrePhone: m.cadrePhone,
        taskId: m.taskId,
        taskName: m.taskName,
        campaign: m.task?.campaign ?? null,
        templateName: m.templateName,
        kind: m.kind,
        deliveryStatus: m.status,
        failureReason: m.failureReason,
        sentBy: m.assignedByName,
        sentAt: m.sentAt,
        responded: own.length > 0,
        // Every action taken, in order — someone may tap View Task and then
        // Contact Admin, and collapsing that to one would lose the more
        // interesting second half.
        actions: own.map((r) => ({
          action: r.action,
          label: r.label,
          type: r.responseType,
          at: r.respondedAt,
        })),
        firstRespondedAt: own[0]?.respondedAt ?? null,
      };
    });
  }

  /** Headline counts plus a per-button breakdown, for the dashboard cards. */
  async summary(filters: EngagementFilters, user: AuthenticatedUser) {
    const rows = await this.recipients(filters, user);

    const responded = rows.filter((r) => r.responded);
    const delivered = rows.filter((r) => ["DELIVERED", "READ"].includes(r.deliveryStatus));
    const failed = rows.filter((r) => r.deliveryStatus === "FAILED");

    // Grouped by the BUTTON, identified by the label the Cadre actually
    // tapped — not by the internal action.
    //
    // Only two buttons have known actions (View Task / Contact Admin);
    // everything else arrives as the generic QUICK_REPLY carrying its label.
    // Grouping on action therefore collapsed every custom button into one
    // bucket: an "Are you interested? Yes / No" template reported
    // "QUICK_REPLY: 2" instead of "Yes: 1, No: 1", which is precisely the
    // question the template was asking. The label is what the person chose,
    // so the label is what gets counted.
    //
    // Per recipient, not per tap: someone who taps Yes twice is one person
    // who said yes.
    const buttons = new Map<string, { label: string; action: string; cadres: ButtonPresser[] }>();
    for (const row of responded) {
      const seen = new Set<string>();
      for (const a of row.actions) {
        // Typed replies and media are answers, but they are not buttons and
        // would otherwise create a bucket per distinct sentence.
        if (a.type !== "BUTTON") continue;
        const label = (a.label ?? a.action ?? "").trim();
        if (!label) continue;
        const key = label.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);

        const entry = buttons.get(key) ?? { label: titleCase(label), action: a.action, cadres: [] };
        entry.cadres.push({
          cadreId: row.cadreId,
          cadreName: row.cadreName,
          cadrePhone: row.cadrePhone,
          taskId: row.taskId,
          taskName: row.taskName,
          at: a.at,
        });
        buttons.set(key, entry);
      }
    }

    // Buttons the template offers but nobody pressed still belong on the
    // dashboard — "No: 0" is a real answer, and omitting it reads as if the
    // option was never there.
    for (const known of TEMPLATE_BUTTON_ACTIONS) {
      const key = known.label.toLowerCase();
      if (!buttons.has(key)) buttons.set(key, { label: known.label, action: known.action, cadres: [] });
    }

    const byButton = [...buttons.values()]
      .map((b) => ({ ...b, count: b.cadres.length }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

    // Answers that weren't a button press, so they aren't lost from the
    // totals just because they don't fit a bucket.
    const otherResponses = responded.filter((r) => r.actions.every((a) => a.type !== "BUTTON")).length;

    return {
      totalSent: rows.length,
      delivered: delivered.length,
      failed: failed.length,
      responded: responded.length,
      notResponded: rows.length - responded.length,
      responseRatePct: rows.length > 0 ? Math.round((responded.length / rows.length) * 100) : 0,
      byButton,
      otherResponses,
      // Kept so anything still reading the old shape keeps working; the
      // per-button list above is what the dashboards use.
      byAction: byButton.map((b) => ({ action: b.action, label: b.label, count: b.count })),
    };
  }

  /** Just the people who were sent something and never answered. */
  async nonResponders(filters: EngagementFilters, user: AuthenticatedUser) {
    const rows = await this.recipients(filters, user);
    return rows.filter((r) => !r.responded);
  }

  /**
   * Sends a follow-up to everyone who hasn't responded.
   *
   * Restricted by default to recipients whose original message actually
   * reached them: chasing someone whose first message FAILED is noise —
   * that message needs resending, not following up, and the Message Log's
   * Resend already does that. `includeFailed` overrides it.
   */
  async sendFollowUp(
    filters: EngagementFilters,
    user: AuthenticatedUser,
    options: { templateName?: string; includeFailed?: boolean } = {},
  ) {
    if (!filters.taskId && !filters.campaignId) {
      throw new BadRequestException("Choose a task or a campaign to follow up on");
    }

    const targets = (await this.nonResponders(filters, user)).filter(
      (r) => options.includeFailed || r.deliveryStatus !== "FAILED",
    );
    if (targets.length === 0) {
      return { sent: 0, failed: 0, targeted: 0, results: [], message: "Everyone has already responded." };
    }

    const template = options.templateName
      ? { name: options.templateName, language: "en", body: undefined as string | undefined }
      : // No template named: fall back to the platform default, exactly as a
        // fresh assignment does when its sender owns no template.
        MessageTemplatesService.resolveFor({
          fyxoTemplateName: null,
          fyxoTemplateLanguage: null,
          fyxoTemplateBody: null,
        });

    const variableCount = await this.messageTemplates.variableCountFor(template.name);

    let sent = 0;
    let failed = 0;
    const results: {
      cadreName: string;
      cadrePhone: string;
      taskId: string | null;
      success: boolean;
      error?: string;
    }[] = [];

    // Sequential rather than parallel: Fyxo rate-limits, and a follow-up
    // run is a burst to the same workspace. A slow loop beats a throttled
    // one that reports failures it didn't really have.
    for (const target of targets) {
      const variables = this.followUpVariables(variableCount, target);

      const result = await this.fyxo.sendTemplateMessage({
        to: target.cadrePhone,
        templateName: template.name,
        templateLanguage: template.language,
        variables,
        buttonPayloads: target.taskId ? taskButtonPayloads(target.taskId) : undefined,
        // Keyed to the original message and the hour, so re-running a failed
        // batch is idempotent while a deliberate follow-up tomorrow is not
        // rejected as a duplicate.
        idempotencyKey: `followup-${target.messageId}-${new Date().toISOString().slice(0, 13)}`,
      });

      if (result.success) sent += 1;
      else failed += 1;

      results.push({
        cadreName: target.cadreName,
        cadrePhone: target.cadrePhone,
        taskId: target.taskId,
        success: result.success,
        error: result.error,
      });

      // Follow-ups land in the same Message Log as everything else, marked
      // FOLLOW_UP — otherwise the dashboard would count them as fresh
      // assignments and compute the response rate against the wrong
      // denominator.
      await this.messageLog.record({
        cadreId: target.cadreId ?? undefined,
        cadreName: target.cadreName,
        cadrePhone: target.cadrePhone,
        message: renderFyxoBody(template, variables),
        taskId: target.taskId ?? undefined,
        taskName: target.taskName ?? undefined,
        assignedById: user.id,
        assignedByName: user.name,
        kind: "FOLLOW_UP",
        templateName: template.name,
        variables,
        channel: "FYXO",
        success: result.success,
        providerMessageId: result.messageId,
      });
    }

    return { sent, failed, targeted: targets.length, results };
  }

  /**
   * A follow-up repeats the original assignment's facts, read back off the
   * logged send rather than re-derived from the task — the task may have
   * been edited since, and the point is to chase the message they got.
   */
  private followUpVariables(
    count: number,
    target: { cadreName: string; taskName: string | null; campaign: { name: string } | null },
  ): string[] {
    const order = [target.cadreName, target.campaign?.name ?? "—", target.taskName ?? "your task", "—"];
    return Array.from({ length: Math.max(1, count) }, (_, i) => order[i] ?? "—");
  }
}

/** One person's press of one button, for the "who clicked what" list. */
interface ButtonPresser {
  cadreId: string | null;
  cadreName: string;
  cadrePhone: string;
  taskId: string | null;
  taskName: string | null;
  at: Date;
}

// Button labels arrive from WhatsApp lowercased ("view task"), which reads
// as a typo on a dashboard next to properly-cased names.
function titleCase(text: string): string {
  return text.replace(/\S+/g, (word) => word.charAt(0).toUpperCase() + word.slice(1));
}
