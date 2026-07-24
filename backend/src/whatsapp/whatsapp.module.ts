import { Module } from "@nestjs/common";
import { WhatsAppApiModule } from "../whatsapp-api/whatsapp-api.module";
import { TasksModule } from "../tasks/tasks.module";
import { CitizensModule } from "../citizens/citizens.module";
import { GrievancesModule } from "../grievances/grievances.module";
import { EventsModule } from "../events/events.module";
import { WhatsAppWebhookController } from "./whatsapp-webhook.controller";
import { WhatsAppConversationService } from "./whatsapp-conversation.service";

@Module({
  imports: [WhatsAppApiModule, TasksModule, CitizensModule, GrievancesModule, EventsModule],
  controllers: [WhatsAppWebhookController],
  providers: [WhatsAppConversationService],
})
export class WhatsAppModule {}
