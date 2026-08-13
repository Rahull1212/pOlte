import { Injectable, Logger } from "@nestjs/common";
import Anthropic from "@anthropic-ai/sdk";
import { PrismaService } from "../prisma/prisma.service";
import { AnalyticsService } from "../analytics/analytics.service";
import { AuthenticatedUser } from "../auth/types";

/**
 * Thin wrapper around the Claude API — no agent framework, no planner.
 * Every AI feature below assembles a JSON data bundle with plain
 * Prisma/SQL queries first, then asks the model to turn that bundle into
 * readable prose/judgment. The model never invents the underlying numbers.
 */
@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private readonly client: Anthropic | null;

  // AiController has no auth/region context wired in today (a pre-existing
  // gap, not introduced here) — these reports have always analyzed a
  // campaign org-wide, so this synthetic SUPER_ADMIN scope preserves that
  // exact behavior against AnalyticsService's now-scoped methods.
  private readonly orgWideScope: AuthenticatedUser = {
    id: "system",
    role: "SUPER_ADMIN",
    regionId: "",
    name: "System",
  };

  constructor(
    private readonly prisma: PrismaService,
    private readonly analyticsService: AnalyticsService,
  ) {
    this.client = process.env.ANTHROPIC_API_KEY
      ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
      : null;
  }

  private async callLLM(system: string, userPrompt: string): Promise<string> {
    if (!this.client) {
      this.logger.warn("ANTHROPIC_API_KEY not set — returning a placeholder instead of calling Claude");
      return `[AI disabled locally] ${userPrompt.slice(0, 300)}`;
    }

    const response = await this.client.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 600,
      system,
      messages: [{ role: "user", content: userPrompt }],
    });

    const textBlock = response.content.find((block) => block.type === "text");
    return textBlock && textBlock.type === "text" ? textBlock.text : "";
  }

  async generateSummary(campaignId: string) {
    const campaign = await this.prisma.campaign.findUniqueOrThrow({ where: { id: campaignId } });
    const stats = await this.analyticsService.campaignProgress(campaignId, this.orgWideScope);

    const content = await this.callLLM(
      "You are a campaign operations analyst for a political party. Write a concise, factual 3-4 sentence summary using only the numbers given. Do not invent figures.",
      `Campaign: ${campaign.name}\nStats: ${JSON.stringify(stats)}`,
    );

    return this.saveInsight(campaignId, "SUMMARY", content);
  }

  async predictCompletion(campaignId: string) {
    // Ground truth projection is arithmetic, not AI: linear extrapolation
    // from progress-to-date over elapsed time.
    const campaign = await this.prisma.campaign.findUniqueOrThrow({ where: { id: campaignId } });
    const stats = await this.analyticsService.campaignProgress(campaignId, this.orgWideScope);

    const elapsedMs = Date.now() - campaign.startDate.getTime();
    const totalMs = campaign.endDate.getTime() - campaign.startDate.getTime();
    const elapsedPct = totalMs > 0 ? Math.min(1, elapsedMs / totalMs) : 1;
    const paceRatio = elapsedPct > 0 ? stats.targetAchievementPct / 100 / elapsedPct : 0;
    const projectedFinalPct = Math.round(Math.min(200, paceRatio * 100));

    const content = await this.callLLM(
      "You are a campaign operations analyst. Phrase this completion projection in 2-3 sentences, including one caveat about assuming a constant pace.",
      `Campaign: ${campaign.name}\nElapsed: ${Math.round(elapsedPct * 100)}%\nAchieved so far: ${stats.targetAchievementPct}%\nProjected final completion at current pace: ${projectedFinalPct}%`,
    );

    return this.saveInsight(campaignId, "PREDICTION", content, { projectedFinalPct });
  }

  async identifySlowRegions(campaignId: string) {
    const districts = await this.analyticsService.regionProgress(campaignId, "DISTRICT", this.orgWideScope);
    const slow = districts.filter((d) => d.achievementPct < 50).slice(-5);

    const content = await this.callLLM(
      "You are a campaign operations analyst. List the underperforming districts and a plausible reason to investigate for each, in 3-5 bullet points. Do not invent data not provided.",
      `Underperforming districts (achievement % below 50): ${JSON.stringify(slow)}`,
    );

    return this.saveInsight(campaignId, "RISK", content, { slow });
  }

  async recommendBudgetRedistribution(campaignId: string) {
    const districts = await this.analyticsService.regionProgress(campaignId, "DISTRICT", this.orgWideScope);
    const underspent = districts.filter((d) => d.allocatedBudget > 0 && d.spentBudget / d.allocatedBudget < 0.3);
    const overachieving = districts.filter((d) => d.achievementPct > 90);

    const content = await this.callLLM(
      "You are a campaign operations analyst. Recommend specific budget moves (from which district to which) based only on the data given. Keep it to 3 bullet points.",
      `Underspent districts: ${JSON.stringify(underspent)}\nHigh-achieving districts that may benefit from more budget: ${JSON.stringify(overachieving)}`,
    );

    return this.saveInsight(campaignId, "RECOMMENDATION", content);
  }

  async weeklyReport(campaignId: string) {
    const campaign = await this.prisma.campaign.findUniqueOrThrow({ where: { id: campaignId } });
    const stats = await this.analyticsService.campaignProgress(campaignId, this.orgWideScope);
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const recentProgress = await this.prisma.progressUpdate.count({
      where: { task: { campaignId }, createdAt: { gte: sevenDaysAgo } },
    });

    const content = await this.callLLM(
      "You are a campaign operations analyst writing a weekly report for state leadership. 4-6 sentences, factual, no invented numbers.",
      `Campaign: ${campaign.name}\nOverall stats: ${JSON.stringify(stats)}\nProgress updates submitted in the last 7 days: ${recentProgress}`,
    );

    return this.saveInsight(campaignId, "WEEKLY_REPORT", content);
  }

  async nextActions(campaignId: string) {
    const stats = await this.analyticsService.campaignProgress(campaignId, this.orgWideScope);
    const { overdue } = await this.analyticsService.pendingAndOverdue(campaignId, this.orgWideScope);

    const content = await this.callLLM(
      "You are a campaign operations advisor. Suggest 3 concrete next actions for state leadership based on the data. Label this clearly as a suggestion, not a decision.",
      `Stats: ${JSON.stringify(stats)}\nOverdue task count: ${overdue.length}`,
    );

    return this.saveInsight(campaignId, "RECOMMENDATION", content);
  }

  private saveInsight(campaignId: string, type: any, content: string, metadata?: Record<string, unknown>) {
    return this.prisma.aIInsight.create({
      data: { campaignId, type, content, metadata: metadata as any },
    });
  }
}
