import { Body, Controller, Get, Post, Query } from "@nestjs/common";
import { createAnnouncementSchema, CreateAnnouncementDto } from "../shared-types";
import { CommunicationService } from "./communication.service";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { AuthenticatedUser } from "../auth/types";

@Controller("announcements")
export class CommunicationController {
  constructor(private readonly communicationService: CommunicationService) {}

  @Post()
  create(
    @Body(new ZodValidationPipe(createAnnouncementSchema)) dto: CreateAnnouncementDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.communicationService.createAnnouncement(dto, user);
  }

  @Get()
  findByCampaign(@Query("campaignId") campaignId: string) {
    return this.communicationService.findByCampaign(campaignId);
  }
}
