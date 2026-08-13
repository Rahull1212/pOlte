import { Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { AiService } from "./ai.service";
import { Roles } from "../common/decorators/roles.decorator";
import { RolesGuard } from "../common/guards/roles.guard";

// AI reports are for campaign leadership, not individual Cadres — same
// SUPER_ADMIN/ADMIN restriction used on AnalyticsController, which these
// endpoints are built on top of.
@Controller("ai/campaigns/:id")
@UseGuards(RolesGuard)
@Roles("SUPER_ADMIN", "ADMIN")
export class AiController {
  constructor(private readonly aiService: AiService) {}

  @Post("summary")
  summary(@Param("id") id: string) {
    return this.aiService.generateSummary(id);
  }

  @Post("weekly-report")
  weeklyReport(@Param("id") id: string) {
    return this.aiService.weeklyReport(id);
  }

  @Get("risks")
  risks(@Param("id") id: string) {
    return this.aiService.identifySlowRegions(id);
  }

  @Get("predict-completion")
  predictCompletion(@Param("id") id: string) {
    return this.aiService.predictCompletion(id);
  }

  @Get("slow-regions")
  slowRegions(@Param("id") id: string) {
    return this.aiService.identifySlowRegions(id);
  }

  @Post("recommend-budget-redistribution")
  recommendBudget(@Param("id") id: string) {
    return this.aiService.recommendBudgetRedistribution(id);
  }

  @Get("next-actions")
  nextActions(@Param("id") id: string) {
    return this.aiService.nextActions(id);
  }
}
