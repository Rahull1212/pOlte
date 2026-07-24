import { Controller, Get, Param, Query } from "@nestjs/common";
import { RegionType } from "../shared-types";
import { AnalyticsService } from "./analytics.service";

@Controller("analytics")
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get("campaign/:id")
  campaignProgress(@Param("id") id: string) {
    return this.analyticsService.campaignProgress(id);
  }

  @Get("district-progress")
  districtProgress(@Query("campaignId") campaignId: string) {
    return this.analyticsService.regionProgress(campaignId, "DISTRICT");
  }

  @Get("mandal-progress")
  mandalProgress(@Query("campaignId") campaignId: string) {
    return this.analyticsService.regionProgress(campaignId, "MANDAL");
  }

  @Get("booth-progress")
  boothProgress(@Query("campaignId") campaignId: string) {
    return this.analyticsService.regionProgress(campaignId, "BOOTH");
  }

  @Get("top-performers")
  topPerformers(@Query("campaignId") campaignId: string, @Query("level") level: "district" | "cadre") {
    return this.analyticsService.topPerformers(campaignId, level);
  }

  @Get("pending-overdue")
  pendingOverdue(@Query("campaignId") campaignId: string) {
    return this.analyticsService.pendingAndOverdue(campaignId);
  }
}
