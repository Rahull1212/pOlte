import { Module } from "@nestjs/common";
import { FyxoWhatsAppService } from "./fyxo-whatsapp.service";

// Zero dependency on any business module, same shape as WhatsAppApiModule
// and FyxoConnectModule — anything needing to send via Fyxo's WhatsApp
// messaging API imports this service, not the other way around.
@Module({
  providers: [FyxoWhatsAppService],
  exports: [FyxoWhatsAppService],
})
export class FyxoWhatsAppModule {}
