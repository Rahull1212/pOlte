import { Module } from "@nestjs/common";
import { TasksController } from "./tasks.controller";
import { TasksService } from "./tasks.service";
import { AllocationsModule } from "../allocations/allocations.module";
import { NotificationsModule } from "../notifications/notifications.module";

@Module({
  imports: [AllocationsModule, NotificationsModule],
  controllers: [TasksController],
  providers: [TasksService],
  exports: [TasksService],
})
export class TasksModule {}
