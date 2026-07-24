import { Module } from "@nestjs/common";
import { AllocationsController } from "./allocations.controller";
import { AllocationsService } from "./allocations.service";
import { RegionsModule } from "../regions/regions.module";
import { NotificationsModule } from "../notifications/notifications.module";

@Module({
  imports: [RegionsModule, NotificationsModule],
  controllers: [AllocationsController],
  providers: [AllocationsService],
  exports: [AllocationsService],
})
export class AllocationsModule {}
