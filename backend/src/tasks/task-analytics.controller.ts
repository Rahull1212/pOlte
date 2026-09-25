import { Body, Controller, Get, Post, Query, UseGuards } from "@nestjs/common";
import { askTaskAiSchema, AskTaskAiDto } from "../shared-types";
import { TaskAnalyticsFilters, TaskAnalyticsService } from "./task-analytics.service";
import { Roles } from "../common/decorators/roles.decorator";
import { RolesGuard } from "../common/guards/roles.guard";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { AuthenticatedUser } from "../auth/types";

// Task Communication & AI Insights dashboard — GLOBAL, never a single task
// (see /tasks/:id/dashboard for that). SUPER_ADMIN sees the whole org,
// ADMIN sees only their own region subtree (enforced in
// TaskAnalyticsService, not just by hiding routes here) — a District/Constituency
// filter can only narrow that further, never escape it.
@Controller("task-analytics")
@UseGuards(RolesGuard)
@Roles("SUPER_ADMIN", "ADMIN")
export class TaskAnalyticsController {
  constructor(private readonly taskAnalyticsService: TaskAnalyticsService) {}

  private filtersFrom(query: Record<string, string | undefined>): TaskAnalyticsFilters {
    return {
      dateFrom: query.dateFrom || undefined,
      dateTo: query.dateTo || undefined,
      districtId: query.districtId || undefined,
      constituencyId: query.constituencyId || undefined,
      status: query.status || undefined,
      priority: query.priority || undefined,
      taskType: query.taskType === "BULK" || query.taskType === "INDIVIDUAL" ? query.taskType : undefined,
    };
  }

  @Get("scope")
  scope(@CurrentUser() user: AuthenticatedUser) {
    return this.taskAnalyticsService.getScope(user);
  }

  @Get("overview")
  overview(@CurrentUser() user: AuthenticatedUser, @Query() query: Record<string, string>) {
    return this.taskAnalyticsService.getOverview(user, this.filtersFrom(query));
  }

  @Get("cadre-overview")
  cadreOverview(@CurrentUser() user: AuthenticatedUser, @Query() query: Record<string, string>) {
    return this.taskAnalyticsService.getCadreOverview(user, this.filtersFrom(query));
  }

  @Get("tasks")
  tasks(@CurrentUser() user: AuthenticatedUser, @Query() query: Record<string, string>) {
    return this.taskAnalyticsService.getTaskWiseAnalytics(user, this.filtersFrom(query));
  }

  @Get("cadres")
  cadres(@CurrentUser() user: AuthenticatedUser, @Query() query: Record<string, string>) {
    return this.taskAnalyticsService.getCadreAnalytics(user, this.filtersFrom(query));
  }

  @Get("constituencies")
  constituencies(@CurrentUser() user: AuthenticatedUser, @Query() query: Record<string, string>) {
    return this.taskAnalyticsService.getConstituencyAnalytics(user, this.filtersFrom(query));
  }

  @Get("districts")
  districts(@CurrentUser() user: AuthenticatedUser, @Query() query: Record<string, string>) {
    return this.taskAnalyticsService.getDistrictAnalytics(user, this.filtersFrom(query));
  }

  @Get("charts")
  charts(@CurrentUser() user: AuthenticatedUser, @Query() query: Record<string, string>) {
    return this.taskAnalyticsService.getCharts(user, this.filtersFrom(query));
  }

  @Get("action-center")
  actionCenter(@CurrentUser() user: AuthenticatedUser, @Query() query: Record<string, string>) {
    return this.taskAnalyticsService.getActionCenter(user, this.filtersFrom(query));
  }

  @Post("ai-insights")
  aiInsights(@CurrentUser() user: AuthenticatedUser, @Query() query: Record<string, string>) {
    return this.taskAnalyticsService.generateAiInsights(user, this.filtersFrom(query));
  }

  @Post("ask")
  ask(@Body(new ZodValidationPipe(askTaskAiSchema)) dto: AskTaskAiDto, @CurrentUser() user: AuthenticatedUser) {
    return this.taskAnalyticsService.askAi(user, dto.question, dto.filters ?? {});
  }
}
