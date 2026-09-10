import { Module } from "@nestjs/common";
import { PollsController } from "./polls.controller";
import { PollsService } from "./polls.service";
import { RegionsModule } from "../regions/regions.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { FyxoWhatsAppModule } from "../fyxo-whatsapp/fyxo-whatsapp.module";

@Module({
  imports: [RegionsModule, NotificationsModule, FyxoWhatsAppModule],
  controllers: [PollsController],
  providers: [PollsService],
})
export class PollsModule {}
