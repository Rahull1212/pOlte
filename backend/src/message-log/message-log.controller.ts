import { Body, Controller, Get, Header, Param, Post, Query, UseGuards } from "@nestjs/common";
import { MessageLogService, MessageLogFilters } from "./message-log.service";
import { EngagementService, EngagementFilters } from "./engagement.service";
import { RagExportService, RagExportFilters } from "./rag-export.service";
import { Roles } from "../common/decorators/roles.decorator";
import { RolesGuard } from "../common/guards/roles.guard";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { AuthenticatedUser } from "../auth/types";

// Admins see their own sends, Super Admins see everything — the scoping is
// applied in the service, not here, so it can't be bypassed by a query param.
@Controller("message-log")
@UseGuards(RolesGuard)
@Roles("SUPER_ADMIN", "ADMIN")
export class MessageLogController {
  constructor(
    private readonly messageLog: MessageLogService,
    private readonly engagement: EngagementService,
    private readonly ragExport: RagExportService,
  ) {}

  @Get()
  list(@Query() query: MessageLogFilters, @CurrentUser() user: AuthenticatedUser) {
    return this.messageLog.list({ ...query, limit: query.limit ? Number(query.limit) : undefined }, user);
  }

  // Takes the same filters as the table: the KPI counts describe the rows a
  // card would show, so they must narrow with search/type/date too.
  @Get("summary")
  summary(@Query() query: MessageLogFilters, @CurrentUser() user: AuthenticatedUser) {
    return this.messageLog.summary(query, user);
  }

  // ---- Engagement: who acted on what we sent -----------------------------

  /** Headline counts and the per-button breakdown. */
  @Get("engagement/summary")
  engagementSummary(@Query() query: EngagementFilters, @CurrentUser() user: AuthenticatedUser) {
    return this.engagement.summary(query, user);
  }

  /** One row per message sent, with the actions its recipient took. */
  @Get("engagement/recipients")
  engagementRecipients(@Query() query: EngagementFilters, @CurrentUser() user: AuthenticatedUser) {
    return this.engagement.recipients(query, user);
  }

  /** Only the people who never answered — the follow-up list. */
  @Get("engagement/non-responders")
  nonResponders(@Query() query: EngagementFilters, @CurrentUser() user: AuthenticatedUser) {
    return this.engagement.nonResponders(query, user);
  }

  /**
   * Sends a follow-up template to everyone who hasn't responded.
   * Requires a task or campaign — an unscoped follow-up would message
   * every silent recipient in the system at once.
   */
  @Post("engagement/follow-up")
  followUp(
    @Body() body: EngagementFilters & { templateName?: string; includeFailed?: boolean },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const { templateName, includeFailed, ...filters } = body;
    return this.engagement.sendFollowUp(filters, user, { templateName, includeFailed });
  }

  // ---- Exports -----------------------------------------------------------

  @Post(":id/resend")
  resend(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.messageLog.resend(id, user);
  }

  @Get("export")
  @Header("Content-Type", "text/csv; charset=utf-8")
  @Header("Content-Disposition", 'attachment; filename="task-messages.csv"')
  export(@Query() query: MessageLogFilters, @CurrentUser() user: AuthenticatedUser) {
    return this.messageLog.exportCsv(query, user);
  }

  /**
   * The RAG handover: every message with its responses nested inside it.
   *
   * Super Admin only — this is the whole corpus in one file, which is a
   * different thing from an Admin reading their own log in the UI.
   * `?redactPhones=true` swaps numbers for stable pseudonyms.
   */
  @Get("rag-export.jsonl")
  @Roles("SUPER_ADMIN")
  @Header("Content-Type", "application/x-ndjson; charset=utf-8")
  @Header("Content-Disposition", 'attachment; filename="polios-messages.jsonl"')
  ragExportJsonl(
    @Query() query: RagExportFilters & { redactPhones?: string },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const { redactPhones, ...filters } = query;
    return this.ragExport.buildJsonl(
      { ...filters, limit: filters.limit ? Number(filters.limit) : undefined },
      user,
      redactPhones === "true",
    );
  }

  /** Same corpus as an array, for a caller that would rather have JSON. */
  @Get("rag-export")
  @Roles("SUPER_ADMIN")
  ragExportJson(
    @Query() query: RagExportFilters & { redactPhones?: string },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const { redactPhones, ...filters } = query;
    return this.ragExport.build(
      { ...filters, limit: filters.limit ? Number(filters.limit) : undefined },
      user,
      redactPhones === "true",
    );
  }
}
