import { BullModule } from "@nestjs/bullmq";
import { Module } from "@nestjs/common";
import { ScheduleModule } from "@nestjs/schedule";
import Redis from "ioredis";
import { NotificationsModule } from "../notifications/notifications.module";
import { AiModule } from "../ai/ai.module";
import { TasksModule } from "../tasks/tasks.module";
import { AgentsModule } from "../agents/agents.module";
import { EscalationProcessor } from "./escalation.processor";
import { EscalationScheduler } from "./escalation.scheduler";
import { AiJobsProcessor } from "./ai-jobs.processor";
import { AiJobsScheduler } from "./ai-jobs.scheduler";
import { FyxoAgentJobsProcessor } from "../fyxo-agent/fyxo-agent-jobs.processor";

@Module({
  imports: [
    ScheduleModule.forRoot(),
    BullModule.forRoot({
      connection: new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
        maxRetriesPerRequest: null,
      }),
    }),
    // fyxo-agent-jobs registered alongside the existing queues — BullMQ's
    // shared connection (forRoot, above) only resolves cleanly for
    // registerQueue() calls made in this same module, matching the one
    // working precedent already in this codebase (escalations/ai-jobs).
    BullModule.registerQueue({ name: "escalations" }, { name: "ai-jobs" }, { name: "fyxo-agent-jobs" }),
    NotificationsModule,
    AiModule,
    TasksModule,
    AgentsModule,
  ],
  providers: [EscalationProcessor, EscalationScheduler, AiJobsProcessor, AiJobsScheduler, FyxoAgentJobsProcessor],
  exports: [BullModule],
})
export class QueueModule {}
