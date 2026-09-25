import { Controller, Get, Param, Query, UseGuards } from "@nestjs/common";
import { RegionType } from "../shared-types";
import { AnalyticsService } from "./analytics.service";
import { Roles } from "../common/decorators/roles.decorator";
import { RolesGuard } from "../common/guards/roles.guard";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { AuthenticatedUser } from "../auth/types";

// Analytics are for org/region leadership, not individual Cadres — every
// route here is scoped to the caller's own region subtree (ADMIN) or the
// whole org (SUPER_ADMIN) inside the service, never unscoped.
@Controller("analytics")
@UseGuards(RolesGuard)
@Roles("SUPER_ADMIN", "ADMIN")
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get("overview")
  overview(@CurrentUser() user: AuthenticatedUser) {
    return this.analyticsService.overview(user);
  }

  @Get("campaign/:id")
  campaignProgress(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.analyticsService.campaignProgress(id, user);
  }

  @Get("district-progress")
  districtProgress(@Query("campaignId") campaignId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.analyticsService.regionProgress(campaignId, "DISTRICT", user);
  }

  @Get("constituency-progress")
  constituencyProgress(@Query("campaignId") campaignId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.analyticsService.regionProgress(campaignId, "CONSTITUENCY", user);
  }

  @Get("booth-progress")
  boothProgress(@Query("campaignId") campaignId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.analyticsService.regionProgress(campaignId, "BOOTH", user);
  }

  @Get("top-performers")
  topPerformers(
    @Query("campaignId") campaignId: string,
    @Query("level") level: "district" | "cadre",
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.analyticsService.topPerformers(campaignId, level, user);
  }

  @Get("pending-overdue")
  pendingOverdue(@Query("campaignId") campaignId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.analyticsService.pendingAndOverdue(campaignId, user);
  }
}
