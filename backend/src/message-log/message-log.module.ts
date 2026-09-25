import { Module } from "@nestjs/common";
import { MessageLogController } from "./message-log.controller";
import { MessageLogService } from "./message-log.service";
import { TemplateResponseService } from "./template-response.service";
import { EngagementService } from "./engagement.service";
import { RagExportService } from "./rag-export.service";
import { FyxoWhatsAppModule } from "../fyxo-whatsapp/fyxo-whatsapp.module";
import { MessageTemplatesModule } from "../message-templates/message-templates.module";

@Module({
  imports: [FyxoWhatsAppModule, MessageTemplatesModule],
  controllers: [MessageLogController],
  providers: [MessageLogService, TemplateResponseService, EngagementService, RagExportService],
  exports: [MessageLogService, TemplateResponseService],
})
export class MessageLogModule {}
