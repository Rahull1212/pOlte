import { Module } from "@nestjs/common";
import { TasksController } from "./tasks.controller";
import { TasksService } from "./tasks.service";
import { AllocationsModule } from "../allocations/allocations.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { RegionsModule } from "../regions/regions.module";
import { AiModule } from "../ai/ai.module";

@Module({
  imports: [AllocationsModule, NotificationsModule, RegionsModule, AiModule],
  controllers: [TasksController],
  providers: [TasksService],
  exports: [TasksService],
})
export class TasksModule {}
