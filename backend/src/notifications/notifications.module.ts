import { Module } from "@nestjs/common";
import { NotificationsController } from "./notifications.controller";
import { NotificationsService } from "./notifications.service";
import { WhatsAppApiModule } from "../whatsapp-api/whatsapp-api.module";
import { FyxoWhatsAppModule } from "../fyxo-whatsapp/fyxo-whatsapp.module";

@Module({
  imports: [WhatsAppApiModule, FyxoWhatsAppModule],
  controllers: [NotificationsController],
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
