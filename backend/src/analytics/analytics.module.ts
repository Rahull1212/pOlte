import { Module } from "@nestjs/common";
import { AnalyticsController } from "./analytics.controller";
import { AnalyticsService } from "./analytics.service";
import { RegionsModule } from "../regions/regions.module";
import { MessageLogModule } from "../message-log/message-log.module";

@Module({
  imports: [RegionsModule, MessageLogModule],
  controllers: [AnalyticsController],
  providers: [AnalyticsService],
  exports: [AnalyticsService],
})
export class AnalyticsModule {}
