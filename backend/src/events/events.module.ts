import { Module } from "@nestjs/common";
import { EventsController } from "./events.controller";
import { EventsService } from "./events.service";
import { RegionsModule } from "../regions/regions.module";
import { NotificationsModule } from "../notifications/notifications.module";

@Module({
  imports: [RegionsModule, NotificationsModule],
  controllers: [EventsController],
  providers: [EventsService],
  exports: [EventsService],
})
export class EventsModule {}
