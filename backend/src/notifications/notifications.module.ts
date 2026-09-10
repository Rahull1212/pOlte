import { Module } from "@nestjs/common";
import { NotificationsController } from "./notifications.controller";
import { NotificationsService } from "./notifications.service";
import { WhatsAppApiModule } from "../whatsapp-api/whatsapp-api.module";
import { FyxoWhatsAppModule } from "../fyxo-whatsapp/fyxo-whatsapp.module";
import { GoogleSheetsModule } from "../google-sheets/google-sheets.module";

@Module({
  imports: [WhatsAppApiModule, FyxoWhatsAppModule, GoogleSheetsModule],
  controllers: [NotificationsController],
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
