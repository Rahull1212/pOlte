import { Module } from "@nestjs/common";
import { WhatsAppApiService } from "./whatsapp-api.service";

@Module({
  providers: [WhatsAppApiService],
  exports: [WhatsAppApiService],
})
export class WhatsAppApiModule {}
