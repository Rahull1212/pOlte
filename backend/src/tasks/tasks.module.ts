import { Module } from "@nestjs/common";
import { TasksController } from "./tasks.controller";
import { TasksService } from "./tasks.service";
import { TaskAnalyticsController } from "./task-analytics.controller";
import { TaskAnalyticsService } from "./task-analytics.service";
import { AllocationsModule } from "../allocations/allocations.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { RegionsModule } from "../regions/regions.module";
import { AiModule } from "../ai/ai.module";
import { WhatsAppApiModule } from "../whatsapp-api/whatsapp-api.module";
import { FyxoWhatsAppModule } from "../fyxo-whatsapp/fyxo-whatsapp.module";

@Module({
  imports: [AllocationsModule, NotificationsModule, RegionsModule, AiModule, WhatsAppApiModule, FyxoWhatsAppModule],
  controllers: [TasksController, TaskAnalyticsController],
  providers: [TasksService, TaskAnalyticsService],
  exports: [TasksService],
})
export class TasksModule {}
