import { Controller, Get, Param, Post } from "@nestjs/common";
import { AiService } from "./ai.service";

@Controller("ai/campaigns/:id")
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
