import { BullModule } from "@nestjs/bullmq";
import { Module } from "@nestjs/common";
import { ScheduleModule } from "@nestjs/schedule";
import Redis from "ioredis";
import { NotificationsModule } from "../notifications/notifications.module";
import { AiModule } from "../ai/ai.module";
import { EscalationProcessor } from "./escalation.processor";
import { EscalationScheduler } from "./escalation.scheduler";
import { AiJobsProcessor } from "./ai-jobs.processor";
import { AiJobsScheduler } from "./ai-jobs.scheduler";

@Module({
  imports: [
    ScheduleModule.forRoot(),
    BullModule.forRoot({
      connection: new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
        maxRetriesPerRequest: null,
      }),
    }),
    BullModule.registerQueue({ name: "escalations" }, { name: "ai-jobs" }),
    NotificationsModule,
    AiModule,
  ],
  providers: [EscalationProcessor, EscalationScheduler, AiJobsProcessor, AiJobsScheduler],
  exports: [BullModule],
})
export class QueueModule {}
