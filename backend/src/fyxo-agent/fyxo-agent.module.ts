import { Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bullmq";
import { FyxoAgentWebhookController } from "./fyxo-agent-webhook.controller";

// FyxoAgentJobsProcessor (the worker) lives in QueueModule, registered
// alongside the fyxo-agent-jobs queue there (see queue.module.ts) — the
// arrangement already proven to work for BullMQ's shared connection
// (forRoot) in this codebase. This module separately re-registers the same
// queue name so the webhook controller can @InjectQueue it without a
// cross-module export dependency on QueueModule — BullMQ resolves both
// registrations against the one shared Redis connection from forRoot().
@Module({
  imports: [BullModule.registerQueue({ name: "fyxo-agent-jobs" })],
  controllers: [FyxoAgentWebhookController],
})
export class FyxoAgentModule {}
