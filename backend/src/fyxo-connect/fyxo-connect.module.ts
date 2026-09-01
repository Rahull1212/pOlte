import { Module } from "@nestjs/common";
import { FyxoConnectService } from "./fyxo-connect.service";

// Deliberately has zero dependency on any business module — anything that
// needs to send via Fyxo Connect imports this service, not the other way
// around, which keeps the dependency graph acyclic. Same shape as
// WhatsAppApiModule; the inbound webhook (which DOES need business logic to
// update recipient status) lives in BulkMessagingModule instead, mirroring
// how WhatsAppWebhookController lives in WhatsAppModule rather than here.
@Module({
  providers: [FyxoConnectService],
  exports: [FyxoConnectService],
})
export class FyxoConnectModule {}
