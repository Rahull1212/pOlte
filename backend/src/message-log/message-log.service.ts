import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { FyxoWhatsAppService } from "../fyxo-whatsapp/fyxo-whatsapp.service";
import { MessageTemplatesService } from "../message-templates/message-templates.service";
import { taskButtonPayloads } from "../fyxo-whatsapp/templates";
import { AuthenticatedUser } from "../auth/types";

// What counts as "sent" for the KPI card: accepted by the provider, and not
// since reported failed. Delivered/read are later stages of the same success.
const SENT_STATUSES = ["SENT", "DELIVERED", "READ"];

// FOLLOW_UP: a chase sent to someone who never responded to the original
// (see EngagementService.sendFollowUp). Distinct from RETRY, which resends a
// message that failed to deliver — the person never got that one at all.
// POLL: a question asked via a template whose buttons are the answers.
export type MessageKind = "ASSIGNMENT" | "RETRY" | "COMPLETION_CHECK" | "NOTIFICATION" | "FOLLOW_UP" | "POLL";

export interface RecordMessageInput {
  cadreId?: string;
  cadreName: string;
  cadrePhone: string;
  message: string;
  taskId?: string;
  taskName?: string;
  /** Set when the send was a poll, so its answers can be found again. */
  pollId?: string;
  assignedById?: string;
  assignedByName?: string;
  kind: MessageKind;
  templateName?: string;
  // The exact values the template's {{n}} placeholders were filled with.
  // Kept so Resend repeats the original message rather than re-deriving one
  // that may since have changed.
  variables?: string[];
  channel: "FYXO" | "META";
  success: boolean;
  providerMessageId?: string;
  /** Provider's refusal wording, when the send failed. */
  failureReason?: string;
}

/** One Resend attempt, appended to TaskMessageLog.retryHistory. */
export interface RetryAttempt {
  at: string;
  providerMessageId: string | null;
  success: boolean;
  error: string | null;
}

export interface MessageLogFilters {
  search?: string;
  status?: string;
  kind?: string;
  from?: string;
  to?: string;
  limit?: number;
  cursor?: string;
}

/**
 * The record of every outbound task WhatsApp message.
 *
 * The database is the only store: there is no export step and nothing to
 * keep in sync. Anyone who wants the rows in a spreadsheet downloads the CSV
 * from the Message Log page.
 *
 * The write can never fail a send. A WhatsApp message that reached a Cadre
 * must not be reported as failed because logging it hit a problem, so the
 * insert is wrapped and swallowed.
 */
@Injectable()
export class MessageLogService {
  private readonly logger = new Logger(MessageLogService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly fyxoWhatsApp: FyxoWhatsAppService,
    private readonly messageTemplates: MessageTemplatesService,
  ) {}

  async record(input: RecordMessageInput) {
    const sentAt = new Date();
    const status = input.success ? "SENT" : "FAILED";

    try {
      await this.prisma.taskMessageLog.create({
        data: {
          cadreId: input.cadreId ?? null,
          cadreName: input.cadreName,
          cadrePhone: input.cadrePhone,
          message: input.message,
          taskId: input.taskId ?? null,
          taskName: input.taskName ?? null,
          pollId: input.pollId ?? null,
          assignedById: input.assignedById ?? null,
          assignedByName: input.assignedByName ?? null,
          kind: input.kind,
          templateName: input.templateName ?? null,
          variables: input.variables ?? [],
          channel: input.channel,
          status,
          providerMessageId: input.providerMessageId ?? null,
          failureReason: input.failureReason ?? null,
          sentAt,
        },
      });
    } catch (err) {
      this.logger.error(`Failed to record message log row: ${(err as Error).message}`);
    }

  }

  /**
   * Paged newest-first, because the only question anyone opens this page
   * with is "what just went out?". Cursor paging rather than offset so a new
   * send arriving mid-scroll doesn't shift rows onto the next page.
   */
  /**
   * The scope + filters shared by list(), summary() and exportCsv(), so the
   * KPI counts can never disagree with the table beneath them — they are one
   * query shape, differing only in whether the status filter is applied.
   *
   * `includeStatus: false` is what makes the KPI cards work as filters: the
   * counts are computed over everything the current search/type/date filters
   * match, ignoring which status card is selected. Applying it would make
   * each card count only itself and zero the other two the moment one was
   * clicked.
   */
  private buildWhere(filters: MessageLogFilters, user: AuthenticatedUser, includeStatus = true) {
    const where: Record<string, unknown> = {};
    // An Admin sees only what they sent; a Super Admin sees everything.
    if (user.role === "ADMIN") where.assignedById = user.id;
    if (includeStatus && filters.status) where.status = filters.status;
    if (filters.kind) where.kind = filters.kind;
    if (filters.from || filters.to) {
      where.sentAt = {
        ...(filters.from ? { gte: new Date(filters.from) } : {}),
        ...(filters.to ? { lte: new Date(filters.to) } : {}),
      };
    }
    if (filters.search) {
      where.OR = [
        { cadreName: { contains: filters.search, mode: "insensitive" } },
        { cadrePhone: { contains: filters.search } },
        { taskName: { contains: filters.search, mode: "insensitive" } },
        { assignedByName: { contains: filters.search, mode: "insensitive" } },
      ];
    }
    return where;
  }

  async list(filters: MessageLogFilters, user: AuthenticatedUser) {
    const limit = Math.min(filters.limit ?? 50, 200);
    const where = this.buildWhere(filters, user);

    const rows = await this.prisma.taskMessageLog.findMany({
      where,
      orderBy: { sentAt: "desc" },
      take: limit + 1,
      ...(filters.cursor ? { cursor: { id: filters.cursor }, skip: 1 } : {}),
    });

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    return { rows: page, nextCursor: hasMore ? page[page.length - 1].id : null };
  }

  /**
   * The KPI counts, over exactly the rows the table is drawn from (same
   * scope, same search/type/date filters) — so clicking a card filters the
   * table to a number the card itself predicted.
   *
   * "Sent" counts every message the provider accepted and has not since
   * reported as failed — DELIVERED and READ included, since a delivered
   * message is emphatically a sent one and excluding it would make the three
   * cards fail to add up.
   */
  async summary(filters: MessageLogFilters, user: AuthenticatedUser) {
    const where = this.buildWhere(filters, user, false);
    const [total, sent, failed] = await Promise.all([
      this.prisma.taskMessageLog.count({ where }),
      this.prisma.taskMessageLog.count({ where: { ...where, status: { in: SENT_STATUSES } } }),
      this.prisma.taskMessageLog.count({ where: { ...where, status: "FAILED" } }),
    ]);
    return { total, sent, failed };
  }

  /**
   * The variables to resend with. Normally the ones recorded at send time —
   * that's the whole point, so an edited task can't change what a retry
   * delivers.
   *
   * Rows written before `variables` existed have none, and sending the wrong
   * COUNT is a hard rejection from Fyxo (§5), so those are reconstructed to
   * the length the template declares using the same who/what/when order the
   * sender uses. It's a best effort for legacy rows, not a second source of
   * truth: anything sent from now on carries its own.
   */
  private async variablesFor(row: {
    variables: string[];
    templateName: string | null;
    cadreName: string;
    taskName: string | null;
  }): Promise<string[]> {
    if (row.variables.length > 0) return row.variables;

    const count = row.templateName ? await this.messageTemplates.variableCountFor(row.templateName) : 1;
    const fallback = [row.cadreName, row.taskName ?? "your task", "—"];
    return Array.from({ length: Math.max(1, count) }, (_, i) => fallback[i] ?? "—");
  }

  /**
   * Re-sends one logged message, repeating the ORIGINAL template, recipient
   * and variables rather than rebuilding it — a task edited (or deleted)
   * since the first attempt must not change what a retry delivers.
   *
   * The log keeps one row per message: status, provider id and failure
   * reason are updated in place, and each attempt is appended to
   * retryHistory, so the page shows a current state plus how it got there.
   */
  async resend(id: string, user: AuthenticatedUser) {
    const row = await this.prisma.taskMessageLog.findUnique({ where: { id } });
    if (!row) throw new NotFoundException("Message not found");
    // Same scoping as the table: an Admin can only retry their own sends.
    if (user.role === "ADMIN" && row.assignedById !== user.id) {
      throw new ForbiddenException("You can only resend messages you sent");
    }
    if (!row.templateName) {
      // A Meta free-text send carries no template to repeat; its wording
      // lives only in `message`, and that path is not what this app sends
      // assignments through.
      throw new BadRequestException("This message wasn't sent from a template, so it can't be resent");
    }

    const attemptNumber = row.retryCount + 1;
    const result = await this.fyxoWhatsApp.sendTemplateMessage({
      to: row.cadrePhone,
      templateName: row.templateName,
      templateLanguage: "en",
      variables: await this.variablesFor(row),
      // The task id still rides on the button so a tap after a retry
      // resolves to the same task (API.md §5).
      // Resend repeats the original message, buttons included — the same
      // per-button payloads so a tap on a resent message is attributed the
      // same way as one on the first attempt.
      buttonPayloads: row.taskId ? taskButtonPayloads(row.taskId) : undefined,
      // Unique per attempt: a resend is a deliberate new send, not the
      // network-retry case Idempotency-Key exists to collapse.
      idempotencyKey: `resend-${row.id}-${attemptNumber}`,
    });

    const attempt: RetryAttempt = {
      at: new Date().toISOString(),
      providerMessageId: result.messageId ?? null,
      success: result.success,
      error: result.error ?? null,
    };
    const history = [...asAttempts(row.retryHistory), attempt];

    const updated = await this.prisma.taskMessageLog.update({
      where: { id },
      data: {
        status: result.success ? "SENT" : "FAILED",
        // Only replace the provider id on success — keeping the failed
        // attempt's id would break correlation with the delivery webhook
        // that reports on the new message.
        providerMessageId: result.success ? (result.messageId ?? row.providerMessageId) : row.providerMessageId,
        // Cleared on success so a now-delivered row doesn't still show why it
        // failed last time.
        failureReason: result.success ? null : (result.error ?? row.failureReason),
        retryCount: attemptNumber,
        lastRetryAt: new Date(),
        retryHistory: history as unknown as Prisma.InputJsonValue,
      },
    });

    this.logger.log(`Resend #${attemptNumber} of ${id} to ${row.cadrePhone}: ${result.success ? "accepted" : result.error}`);
    return { row: updated, success: result.success, error: result.error ?? null };
  }

  /**
   * The whole filtered log as CSV — the thing a spreadsheet was wanted for
   * in the first place, without needing Google connected. Unpaged
   * deliberately: an export that stopped at one page would be a trap.
   */
  async exportCsv(filters: MessageLogFilters, user: AuthenticatedUser): Promise<string> {
    const { rows } = await this.list({ ...filters, limit: 200, cursor: undefined }, user);
    const header = ["Name", "Number", "Message", "Task", "Assigned By", "Type", "Status", "Sent At"];
    const lines = rows.map((r) =>
      [
        r.cadreName,
        r.cadrePhone,
        r.message,
        r.taskName ?? "",
        r.assignedByName ?? "",
        r.kind,
        r.status,
        r.sentAt.toISOString(),
      ]
        .map(csvCell)
        .join(","),
    );
    return [header.join(","), ...lines].join("\r\n");
  }

  // ---- Communication stats, shared by both dashboards --------------------

  /**
   * Delivery counts over the message log, for any `where` the caller builds.
   *
   * Deliberately computed live with one groupBy rather than kept in a
   * summary table. TaskMessageLog is already the single place a delivery
   * webhook writes to, and a second copy of these numbers would be a second
   * thing to keep correct — the exact split that let Task.whatsappStatus
   * drift from the log after a resend. At this size a grouped count over an
   * indexed column is far cheaper than the staleness would be; if the log
   * ever outgrows that, this one method is the only place to change.
   *
   * Counts MESSAGES, not people: a Cadre who got an original plus a retry is
   * two rows here. Use perRecipientDelivery() where the question is "how
   * many Cadres did we reach".
   */
  async communicationStats(where: Prisma.TaskMessageLogWhereInput): Promise<CommunicationStats> {
    const groups = await this.prisma.taskMessageLog.groupBy({
      by: ["status"],
      where,
      _count: { _all: true },
    });

    const count = (status: string) => groups.find((g) => g.status === status)?._count._all ?? 0;
    const total = groups.reduce((sum, g) => sum + g._count._all, 0);
    const read = count("READ");
    const delivered = count("DELIVERED") + read;
    const sent = count("SENT") + delivered;
    const failed = count("FAILED");

    return {
      total,
      sent,
      delivered,
      read,
      failed,
      // Percentages are of everything we attempted, so they always sum
      // sensibly against `total` rather than against each other.
      deliveryRatePct: pct(delivered, total),
      readRatePct: pct(read, total),
      failureRatePct: pct(failed, total),
    };
  }

  /**
   * The latest delivery status the log knows for each of these tasks, keyed
   * by task id.
   *
   * A task can be absent from the result entirely: messages sent before the
   * log started recording which task they belonged to have `taskId: null`,
   * so their tasks have no rows here at all. The caller decides what to do
   * about that — see TasksService.getTaskDashboard, which falls back to the
   * task's own column rather than reporting those sends as zero.
   *
   * One entry per task (tasks are already one-per-Cadre), newest message
   * wins, so a retry updates that Cadre's status instead of counting twice.
   */
  async latestStatusByTask(taskIds: string[]): Promise<Map<string, string>> {
    if (taskIds.length === 0) return new Map();

    const rows = await this.prisma.taskMessageLog.findMany({
      where: { taskId: { in: taskIds } },
      select: { taskId: true, status: true },
      orderBy: { sentAt: "desc" },
    });

    const latest = new Map<string, string>();
    for (const row of rows) {
      if (row.taskId && !latest.has(row.taskId)) latest.set(row.taskId, row.status);
    }
    return latest;
  }

  /** Rolls a list of per-recipient statuses up into the same shape. */
  static rollUp(statuses: string[]): CommunicationStats {
    const has = (s: string) => statuses.filter((x) => x === s).length;
    const total = statuses.length;
    const read = has("READ");
    const delivered = has("DELIVERED") + read;
    const sent = has("SENT") + delivered;
    const failed = has("FAILED");

    return {
      total,
      sent,
      delivered,
      read,
      failed,
      deliveryRatePct: pct(delivered, total),
      readRatePct: pct(read, total),
      failureRatePct: pct(failed, total),
    };
  }
}

/** Delivery rollup shared by the Global and Task dashboards. */
export interface CommunicationStats {
  /** Messages (or recipients) the rollup covers. */
  total: number;
  /** Accepted by the provider and not since reported failed. */
  sent: number;
  /** Reached the handset — READ implies DELIVERED, so it is counted here too. */
  delivered: number;
  read: number;
  failed: number;
  deliveryRatePct: number;
  readRatePct: number;
  failureRatePct: number;
}

function emptyStats(): CommunicationStats {
  return {
    total: 0,
    sent: 0,
    delivered: 0,
    read: 0,
    failed: 0,
    deliveryRatePct: 0,
    readRatePct: 0,
    failureRatePct: 0,
  };
}

function pct(part: number, whole: number): number {
  return whole > 0 ? Math.round((part / whole) * 100) : 0;
}

// Quotes every cell and doubles embedded quotes. Message bodies contain
// commas and newlines routinely, so unquoted output would corrupt the file.
// The leading-character guard stops Excel executing a cell that starts with
// =, +, - or @ (CSV injection) — these are phone numbers and free text from
// WhatsApp, not formulas.
// retryHistory is Json, so it comes back as `unknown` — read it defensively
// rather than trusting a cast, since a hand-edited or older row could hold
// anything.
function asAttempts(value: unknown): RetryAttempt[] {
  return Array.isArray(value) ? (value as RetryAttempt[]) : [];
}

function csvCell(value: string): string {
  const safe = /^[=+\-@]/.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
}
