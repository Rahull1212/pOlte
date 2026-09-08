import { Module } from "@nestjs/common";
import { CadreToolsService } from "./cadre-tools.service";
import { CadreAgentService } from "./cadre-agent.service";
import { ConversationRouterService } from "./conversation-router.service";
import { SpeechToTextModule } from "./speech-to-text.module";
import { TasksModule } from "../tasks/tasks.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { FyxoWhatsAppModule } from "../fyxo-whatsapp/fyxo-whatsapp.module";
import { FieldReportsModule } from "../field-reports/field-reports.module";

@Module({
  imports: [SpeechToTextModule, TasksModule, NotificationsModule, FyxoWhatsAppModule, FieldReportsModule],
  providers: [CadreToolsService, CadreAgentService, ConversationRouterService],
  exports: [ConversationRouterService],
})
export class AgentsModule {}
