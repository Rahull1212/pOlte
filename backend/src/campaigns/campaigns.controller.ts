import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import {
  CampaignStatus,
  createCampaignSchema,
  CreateCampaignDto,
  updateCampaignSchema,
  UpdateCampaignDto,
} from "../shared-types";
import { CampaignsService } from "./campaigns.service";
import { Roles } from "../common/decorators/roles.decorator";
import { RolesGuard } from "../common/guards/roles.guard";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { AuthenticatedUser } from "../auth/types";

@Controller("campaigns")
@UseGuards(RolesGuard)
export class CampaignsController {
  constructor(private readonly campaignsService: CampaignsService) {}

  @Post()
  @Roles("SUPER_ADMIN")
  create(@Body(new ZodValidationPipe(createCampaignSchema)) dto: CreateCampaignDto, @CurrentUser() user: AuthenticatedUser) {
    return this.campaignsService.create(dto, user);
  }

  @Get()
  findAll(@Query("status") status?: CampaignStatus, @Query("priority") priority?: string) {
    return this.campaignsService.findAll({ status, priority });
  }

  @Get("dashboard-summary")
  dashboardSummary() {
    return this.campaignsService.dashboardSummary();
  }

  @Get(":id")
  findById(@Param("id") id: string) {
    return this.campaignsService.findById(id);
  }

  @Patch(":id")
  @Roles("SUPER_ADMIN")
  update(@Param("id") id: string, @Body(new ZodValidationPipe(updateCampaignSchema)) dto: UpdateCampaignDto) {
    return this.campaignsService.update(id, dto);
  }

  @Post(":id/status")
  @Roles("SUPER_ADMIN")
  setStatus(@Param("id") id: string, @Body("status") status: CampaignStatus) {
    return this.campaignsService.setStatus(id, status);
  }
}
