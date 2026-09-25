import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import {
  CampaignStatus,
  createCampaignSchema,
  CreateCampaignDto,
  updateCampaignSchema,
  UpdateCampaignDto, setCampaignStatusSchema, SetCampaignStatusDto,
  respondToCampaignSchema, RespondToCampaignDto } from "../shared-types";
import { CampaignsService } from "./campaigns.service";
import { CampaignDetailService } from "./campaign-detail.service";
import { Roles } from "../common/decorators/roles.decorator";
import { RolesGuard } from "../common/guards/roles.guard";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { AuthenticatedUser } from "../auth/types";

@Controller("campaigns")
@UseGuards(RolesGuard)
export class CampaignsController {
  constructor(
    private readonly campaignsService: CampaignsService,
    private readonly campaignDetail: CampaignDetailService,
  ) {}

  /**
   * Super Admin only. A campaign is handed down, not raised: the Super
   * Admin defines it and assigns Admins, who then accept it and allocate
   * its work to their own Cadres.
   */
  @Post()
  @Roles("SUPER_ADMIN")
  create(@Body(new ZodValidationPipe(createCampaignSchema)) dto: CreateCampaignDto, @CurrentUser() user: AuthenticatedUser) {
    return this.campaignsService.create(dto, user);
  }

  // Open to Cadres too: CampaignsService.visibilityFilter narrows the list
  // to campaigns they actually hold a task on, so a Cadre can reach the
  // campaign behind their own work instead of getting a 403 from the nav.
  @Get()
  @Roles("SUPER_ADMIN", "ADMIN", "CADRE")
  findAll(
    @CurrentUser() user: AuthenticatedUser,
    @Query("status") status?: CampaignStatus,
    @Query("priority") priority?: string,
  ) {
    return this.campaignsService.findAll({ status, priority }, user);
  }

  /**
   * Campaigns waiting on this Admin's accept/decline. Listed before :id so
   * "pending" can't be read as a campaign id.
   */
  @Get("pending-assignments")
  @Roles("ADMIN")
  pendingAssignments(@CurrentUser() user: AuthenticatedUser) {
    return this.campaignsService.pendingAssignments(user);
  }

  @Get("dashboard-summary")
  @Roles("SUPER_ADMIN", "ADMIN")
  dashboardSummary(@CurrentUser() user: AuthenticatedUser) {
    return this.campaignsService.dashboardSummary(user);
  }

  @Get(":id")
  @Roles("SUPER_ADMIN", "ADMIN")
  findById(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.campaignsService.findById(id, user);
  }

  // ---- Campaign Details page -------------------------------------------
  // Each tab loads its own slice rather than one endpoint returning
  // everything: opening the page shouldn't pay for the activity timeline or
  // the attachment list until those tabs are actually looked at. Every one
  // of these re-checks visibility through CampaignsService.findById().
  //
  // A Cadre may reach these too — CampaignDetailService narrows every query
  // to their own tasks, so they see their own work on a campaign and
  // nothing else.

  @Get(":id/overview")
  @Roles("SUPER_ADMIN", "ADMIN", "CADRE")
  overview(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.campaignDetail.overview(id, user);
  }

  @Get(":id/tasks")
  @Roles("SUPER_ADMIN", "ADMIN", "CADRE")
  tasks(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.campaignDetail.tasks(id, user);
  }

  @Get(":id/cadres")
  @Roles("SUPER_ADMIN", "ADMIN")
  cadres(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.campaignDetail.cadres(id, user);
  }

  @Get(":id/communication")
  @Roles("SUPER_ADMIN", "ADMIN")
  communication(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.campaignDetail.communication(id, user);
  }

  @Get(":id/activity")
  @Roles("SUPER_ADMIN", "ADMIN", "CADRE")
  activity(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.campaignDetail.activity(id, user);
  }

  @Get(":id/attachments")
  @Roles("SUPER_ADMIN", "ADMIN", "CADRE")
  attachments(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.campaignDetail.attachments(id, user);
  }

  /**
   * The Admin accepts or declines a campaign they were handed. ADMIN only —
   * a Super Admin answering on their behalf would defeat the point, and the
   * service refuses it regardless of this decorator.
   */
  @Patch(":id/response")
  @Roles("ADMIN")
  respond(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(respondToCampaignSchema)) dto: RespondToCampaignDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.campaignsService.respondToAssignment(id, dto, user);
  }

  // Super Admin only. A campaign's name, dates, areas and type are set by
  // whoever created it; an Admin's part is accepting it and allocating the
  // work to their Cadres, not rewriting the brief they were given. Enforced
  // here rather than by hiding the button, which an Admin could bypass by
  // calling the API directly.
  @Patch(":id")
  @Roles("SUPER_ADMIN")
  update(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateCampaignSchema)) dto: UpdateCampaignDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.campaignsService.update(id, dto, user);
  }

  @Post(":id/status")
  @Roles("SUPER_ADMIN", "ADMIN")
  setStatus(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(setCampaignStatusSchema)) body: SetCampaignStatusDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.campaignsService.setStatus(id, body.status, user);
  }
}
