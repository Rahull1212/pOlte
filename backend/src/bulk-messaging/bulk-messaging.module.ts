import { Module } from "@nestjs/common";
import { FyxoConnectModule } from "../fyxo-connect/fyxo-connect.module";
import { BulkMessagingController } from "./bulk-messaging.controller";
import { BulkMessagingService } from "./bulk-messaging.service";
import { FyxoWebhookController } from "./fyxo-webhook.controller";

@Module({
  imports: [FyxoConnectModule],
  controllers: [BulkMessagingController, FyxoWebhookController],
  providers: [BulkMessagingService],
})
export class BulkMessagingModule {}
