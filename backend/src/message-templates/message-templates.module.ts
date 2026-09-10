import { Module } from "@nestjs/common";
import { MessageTemplatesController } from "./message-templates.controller";
import { MessageTemplatesService } from "./message-templates.service";
import { TemplateSyncService } from "./template-sync.service";

@Module({
  controllers: [MessageTemplatesController],
  providers: [MessageTemplatesService, TemplateSyncService],
  exports: [MessageTemplatesService],
})
export class MessageTemplatesModule {}
