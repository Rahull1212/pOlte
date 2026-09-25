import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuthenticatedUser } from "../auth/types";

export interface RagExportFilters {
  campaignId?: string;
  taskId?: string;
  from?: string;
  to?: string;
  limit?: number;
}

/**
 * The conversation record, as JSON, for the RAG pipeline.
 *
 * One object per message sent, with the responses it drew nested inside it.
 * That shape is deliberate: a retrieval chunk should carry a complete
 * exchange ("we asked X, they tapped Y"), because a message and its reply
 * retrieved separately are two fragments that each mislead on their own.
 *
 * Emitted as JSONL (one JSON object per line) rather than one big array —
 * it streams, it appends, and every loader in the RAG ecosystem reads it
 * without holding the whole export in memory. `json` is available too for
 * a caller that would rather have an array.
 *
 * WHAT IS DELIBERATELY NOT IN HERE: API keys, webhook secrets, auth tokens,
 * password hashes. Phone numbers ARE included because they identify the
 * participant in a conversation, which is the unit of retrieval — see
 * `redactPhones` for an export that omits them.
 */
@Injectable()
export class RagExportService {
  constructor(private readonly prisma: PrismaService) {}

  private scope(user: AuthenticatedUser, filters: RagExportFilters) {
    const where: Record<string, unknown> = {};
    if (user.role === "ADMIN") where.assignedById = user.id;
    if (filters.taskId) where.taskId = filters.taskId;
    if (filters.campaignId) where.task = { campaignId: filters.campaignId };
    if (filters.from || filters.to) {
      where.sentAt = {
        ...(filters.from ? { gte: new Date(filters.from) } : {}),
        ...(filters.to ? { lte: new Date(filters.to) } : {}),
      };
    }
    return where;
  }

  /**
   * The export rows. `redactPhones` replaces each number with a stable
   * pseudonym so the corpus can leave the building without carrying
   * personal contact details — the same Cadre keeps the same pseudonym
   * across the export, so conversation threading still works.
   */
  async build(filters: RagExportFilters, user: AuthenticatedUser, redactPhones = false) {
    const messages = await this.prisma.taskMessageLog.findMany({
      where: this.scope(user, filters),
      orderBy: { sentAt: "asc" },
      take: Math.min(filters.limit ?? 5000, 20000),
      select: {
        id: true,
        cadreId: true,
        cadreName: true,
        cadrePhone: true,
        message: true,
        templateName: true,
        variables: true,
        kind: true,
        channel: true,
        status: true,
        failureReason: true,
        providerMessageId: true,
        retryCount: true,
        sentAt: true,
        assignedByName: true,
        taskId: true,
        taskName: true,
        task: {
          select: {
            status: true,
            priority: true,
            deadline: true,
            campaign: { select: { id: true, name: true, category: true } },
            assignedTo: { select: { region: { select: { name: true, type: true } } } },
          },
        },
        responses: {
          orderBy: { respondedAt: "asc" },
          select: {
            id: true,
            responseType: true,
            action: true,
            label: true,
            rawPayload: true,
            respondedAt: true,
          },
        },
      },
    });

    const pseudonym = this.pseudonymiser();

    return messages.map((m) => ({
      // Stable ids so a re-export updates existing vectors instead of
      // duplicating them.
      message_id: m.id,
      provider_message_id: m.providerMessageId,
      sent_at: m.sentAt.toISOString(),
      channel: m.channel,
      kind: m.kind,
      template: m.templateName,
      // The rendered body the Cadre actually read — this is the text worth
      // embedding, not the template's placeholder form.
      text: m.message,
      template_variables: m.variables,
      delivery: {
        status: m.status,
        failure_reason: m.failureReason,
        retry_count: m.retryCount,
      },
      recipient: {
        id: m.cadreId,
        name: m.cadreName,
        phone: redactPhones ? pseudonym(m.cadrePhone) : m.cadrePhone,
        area: m.task?.assignedTo?.region
          ? { name: m.task.assignedTo.region.name, type: m.task.assignedTo.region.type }
          : null,
      },
      sent_by: m.assignedByName,
      task: m.taskId
        ? {
            id: m.taskId,
            name: m.taskName,
            status: m.task?.status ?? null,
            priority: m.task?.priority ?? null,
            deadline: m.task?.deadline?.toISOString() ?? null,
          }
        : null,
      campaign: m.task?.campaign
        ? { id: m.task.campaign.id, name: m.task.campaign.name, type: m.task.campaign.category }
        : null,
      // The whole point of the nesting: the exchange, not two fragments.
      responses: m.responses.map((r) => ({
        id: r.id,
        type: r.responseType,
        action: r.action,
        label: r.label,
        raw: r.rawPayload,
        at: r.respondedAt.toISOString(),
      })),
      responded: m.responses.length > 0,
    }));
  }

  /** Stable per-export pseudonyms: same number in, same token out. */
  private pseudonymiser() {
    const seen = new Map<string, string>();
    return (phone: string) => {
      const existing = seen.get(phone);
      if (existing) return existing;
      const token = `cadre-${String(seen.size + 1).padStart(4, "0")}`;
      seen.set(phone, token);
      return token;
    };
  }

  /** JSONL: one JSON object per line, which is what RAG loaders expect. */
  async buildJsonl(filters: RagExportFilters, user: AuthenticatedUser, redactPhones = false) {
    const rows = await this.build(filters, user, redactPhones);
    return rows.map((r) => JSON.stringify(r)).join("\n");
  }
}
