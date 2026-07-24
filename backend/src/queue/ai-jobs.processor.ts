import { Processor, WorkerHost } from "@nestjs/bullmq";
import { Job } from "bullmq";
import { Logger } from "@nestjs/common";
import { AiService } from "../ai/ai.service";

@Processor("ai-jobs")
export class AiJobsProcessor extends WorkerHost {
  private readonly logger = new Logger(AiJobsProcessor.name);

  constructor(private readonly aiService: AiService) {
    super();
  }

  async process(job: Job<{ campaignId: string }>): Promise<void> {
    const { campaignId } = job.data;

    switch (job.name) {
      case "daily-summary":
        await this.aiService.generateSummary(campaignId);
        break;
      case "weekly-report":
        await this.aiService.weeklyReport(campaignId);
        break;
      case "risk-scan":
        await this.aiService.identifySlowRegions(campaignId);
        break;
      default:
        this.logger.warn(`Unknown ai-jobs job: ${job.name}`);
    }
  }
}
