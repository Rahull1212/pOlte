import { InjectQueue } from "@nestjs/bullmq";
import { Injectable } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { Queue } from "bullmq";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class AiJobsScheduler {
  constructor(
    @InjectQueue("ai-jobs") private readonly aiJobsQueue: Queue,
    private readonly prisma: PrismaService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_6AM)
  async scheduleDailySummaries() {
    const activeCampaigns = await this.prisma.campaign.findMany({
      where: { status: "ACTIVE" },
      select: { id: true },
    });
    for (const campaign of activeCampaigns) {
      await this.aiJobsQueue.add("daily-summary", { campaignId: campaign.id });
      await this.aiJobsQueue.add("risk-scan", { campaignId: campaign.id });
    }
  }

  @Cron(CronExpression.EVERY_WEEK)
  async scheduleWeeklyReports() {
    const activeCampaigns = await this.prisma.campaign.findMany({
      where: { status: "ACTIVE" },
      select: { id: true },
    });
    for (const campaign of activeCampaigns) {
      await this.aiJobsQueue.add("weekly-report", { campaignId: campaign.id });
    }
  }
}
