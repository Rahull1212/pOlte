import { Body, Controller, Get, Post, Query, UseGuards } from "@nestjs/common";
import { createAnnouncementSchema, CreateAnnouncementDto } from "../shared-types";
import { CommunicationService } from "./communication.service";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { Roles } from "../common/decorators/roles.decorator";
import { RolesGuard } from "../common/guards/roles.guard";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { AuthenticatedUser } from "../auth/types";

// Announcements are campaign-wide broadcasts, so creating one is a
// leadership action — a Cadre could previously post one to everybody.
@Controller("announcements")
@UseGuards(RolesGuard)
export class CommunicationController {
  constructor(private readonly communicationService: CommunicationService) {}

  @Post()
  @Roles("SUPER_ADMIN", "ADMIN")
  create(
    @Body(new ZodValidationPipe(createAnnouncementSchema)) dto: CreateAnnouncementDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.communicationService.createAnnouncement(dto, user);
  }

  @Get()
  @Roles("SUPER_ADMIN", "ADMIN", "CADRE")
  findByCampaign(@Query("campaignId") campaignId: string) {
    return this.communicationService.findByCampaign(campaignId);
  }
}
