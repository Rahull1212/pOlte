import { Module } from "@nestjs/common";
import { CampaignsController } from "./campaigns.controller";
import { CampaignsService } from "./campaigns.service";
import { CampaignDetailService } from "./campaign-detail.service";
import { RegionsModule } from "../regions/regions.module";
import { NotificationsModule } from "../notifications/notifications.module";

@Module({
  // RegionsModule: CampaignDetailService narrows task rows by region for
  // anyone who isn't a Super Admin (RegionsService.descendantIds()).
  // NotificationsModule: the Super Admin is told when an Admin accepts or
  // declines a campaign they handed over.
  imports: [RegionsModule, NotificationsModule],
  controllers: [CampaignsController],
  providers: [CampaignsService, CampaignDetailService],
  exports: [CampaignsService],
})
export class CampaignsModule {}
