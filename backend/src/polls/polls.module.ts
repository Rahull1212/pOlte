import { Module } from "@nestjs/common";
import { PollsController } from "./polls.controller";
import { PollsService } from "./polls.service";
import { RegionsModule } from "../regions/regions.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { FyxoWhatsAppModule } from "../fyxo-whatsapp/fyxo-whatsapp.module";
import { MessageLogModule } from "../message-log/message-log.module";

@Module({
  imports: [RegionsModule, NotificationsModule, FyxoWhatsAppModule, MessageLogModule],
  controllers: [PollsController],
  providers: [PollsService],
})
export class PollsModule {}
