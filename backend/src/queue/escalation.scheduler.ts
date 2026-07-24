import { InjectQueue } from "@nestjs/bullmq";
import { Injectable } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { Queue } from "bullmq";

@Injectable()
export class EscalationScheduler {
  constructor(@InjectQueue("escalations") private readonly escalationsQueue: Queue) {}

  @Cron(CronExpression.EVERY_HOUR)
  async scheduleOverdueCheck() {
    await this.escalationsQueue.add("check-overdue", {});
  }
}
