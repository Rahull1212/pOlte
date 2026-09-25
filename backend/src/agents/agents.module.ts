import { Module } from "@nestjs/common";
import { CadreToolsService } from "./cadre-tools.service";
import { CadreAgentService } from "./cadre-agent.service";
import { ConversationRouterService } from "./conversation-router.service";
import { SpeechToTextModule } from "./speech-to-text.module";
import { TasksModule } from "../tasks/tasks.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { FyxoWhatsAppModule } from "../fyxo-whatsapp/fyxo-whatsapp.module";
import { FieldReportsModule } from "../field-reports/field-reports.module";
import { MessageLogModule } from "../message-log/message-log.module";

@Module({
    // MessageLogModule provides TemplateResponseService — the router records
  // every inbound button tap through it.
  imports: [SpeechToTextModule, TasksModule, NotificationsModule, FyxoWhatsAppModule, FieldReportsModule, MessageLogModule],
  providers: [CadreToolsService, CadreAgentService, ConversationRouterService],
  exports: [ConversationRouterService],
})
export class AgentsModule {}
