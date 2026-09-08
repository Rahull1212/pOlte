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

  /**
   * The per-task dashboard's "AI Task Insights" — one call, three labeled
   * sections, so the model only sees the real KPI/WhatsApp-funnel/cadre
   * bundle already computed by TasksService.getTaskDashboard and never
   * invents a number that isn't in it.
   */
  async generateTaskInsight(bundle: {
    name: string;
    kpis: Record<string, number>;
    progressFunnel?: { stage: string; count: number }[];
    cadres: { name: string; status: string; acknowledgment?: string; whatsappStatus?: string; progressPct: number }[];
  }): Promise<{ insight: string; risks: string; followUp: string }> {
    const content = await this.callLLM(
      "You are a field-operations analyst for a political campaign, reviewing one task's progress, WhatsApp " +
        "communication, and Cadre execution. Respond in exactly this format, nothing else:\n" +
        "INSIGHT: <2-3 factual sentences on current performance and completion rate, using only the numbers given>\n" +
        "RISKS: <2-3 bullet points on deadline risk, WhatsApp delivery failures, Cadres who received/read the " +
        "message but haven't responded, or delays — reference actual names/numbers. Say briefly if there's nothing notable>\n" +
        "FOLLOW-UP: <2-3 concrete next actions for the Admin — who to follow up with, which Cadres are at risk, " +
        "what to do next>\n" +
        "Do not invent any numbers, names, or reasons not present in the data.",
      JSON.stringify(bundle),
    );

    const section = (label: string, nextLabel?: string) => {
      const pattern = nextLabel ? `${label}:\\s*([\\s\\S]*?)(?:\\n?${nextLabel}:|$)` : `${label}:\\s*([\\s\\S]*)$`;
      const match = content.match(new RegExp(pattern, "i"));
      return match ? match[1].trim() : "";
    };

    const insight = section("INSIGHT", "RISKS");
    const risks = section("RISKS", "FOLLOW-UP");
    const followUp = section("FOLLOW-UP");

    if (!insight && !risks && !followUp) {
      return { insight: content.trim(), risks: "", followUp: "" };
    }
    return { insight, risks, followUp };
  }

  /**
   * The GLOBAL Communication & AI Insights dashboard's "AI Insights"
   * section — a short list of individually-categorized findings (⚠️ / 🏆 /
   * 📍 / 📱 / 💡 / 📈), each one factual sentence, over a bundle
   * TaskAnalyticsService already computed org/area-wide from real Task/
   * WhatsApp/Cadre/Mandal/District data. The model only ever reasons over
   * numbers already computed elsewhere — never invents them.
   */
  async generateGlobalTaskInsights(bundle: unknown): Promise<{ items: { category: string; icon: string; text: string }[] }> {
    const content = await this.callLLM(
      "You are an operations analyst for a political field-organizing platform, reviewing task allocation, " +
        "WhatsApp communication, Cadre, and Mandal/District performance data across everything the Admin has " +
        "access to. Respond with 5-8 short insight lines and NOTHING else — one per line, each starting with " +
        "exactly one tag from this list: [ATTENTION] [TOP_PERFORMANCE] [LOW_PERFORMANCE] [MANDAL] [WHATSAPP] " +
        "[TREND] [RECOMMENDATION]. After the tag, write exactly one factual sentence using only the data given, " +
        "citing real names and numbers (e.g. '[TOP_PERFORMANCE] Ganesh has the highest completion rate at 94%.'). " +
        "Cover overall performance, top and low performers, best/worst Mandals, overdue patterns, WhatsApp " +
        "delivery/response problems, and at least one concrete recommendation. Do not invent anything not present " +
        "in the data.",
      JSON.stringify(bundle),
    );

    const categoryMeta: Record<string, { category: string; icon: string }> = {
      ATTENTION: { category: "Attention Required", icon: "⚠️" },
      TOP_PERFORMANCE: { category: "Top Performance", icon: "🏆" },
      LOW_PERFORMANCE: { category: "Needs Improvement", icon: "📉" },
      MANDAL: { category: "Mandal Insight", icon: "📍" },
      WHATSAPP: { category: "WhatsApp Insight", icon: "📱" },
      TREND: { category: "Trend", icon: "📈" },
      RECOMMENDATION: { category: "Recommendation", icon: "💡" },
    };

    const items: { category: string; icon: string; text: string }[] = [];
    for (const line of content.split("\n").map((l) => l.trim()).filter(Boolean)) {
      const match = line.match(/^\[(\w+)\]\s*(.*)$/);
      const meta = match ? categoryMeta[match[1]] : undefined;
      if (match && meta && match[2]) {
        items.push({ category: meta.category, icon: meta.icon, text: match[2].trim() });
      }
    }

    // Nothing matched the tagged format — most commonly ANTHROPIC_API_KEY
    // isn't set, so callLLM returned its unlabeled placeholder string.
    // Surface it as a single generic item instead of an empty list.
    if (items.length === 0) {
      items.push({ category: "Summary", icon: "🤖", text: content.trim() });
    }
    return { items };
  }

  /**
   * "Ask AI" — free-form natural-language Q&A over the same kind of real
   * data bundle as generateTaskCommunicationInsights, scoped to whichever
   * Admin/Super Admin asked. Told explicitly to refuse rather than
   * fabricate when the provided data can't answer the question.
   */
  async answerTaskQuestion(question: string, bundle: unknown): Promise<string> {
    return this.callLLM(
      "You are a data analyst assistant for PoliOS, a political field-organizing platform. Answer the Admin's " +
        "question using ONLY the task/Cadre/Mandal data provided — never invent numbers or names. If the data given " +
        "doesn't contain what's needed to answer, say so plainly instead of guessing. Keep the answer concise " +
        "(2-5 sentences) and cite specific numbers/names from the data where relevant.",
      `Data: ${JSON.stringify(bundle)}\n\nQuestion: ${question}`,
    );
  }

  /**
   * The Field Intelligence Agent's extraction step (Part 12-16 of the
   * WhatsApp/AI agent spec) — turns a Cadre's voice/text field report
   * transcript into structured facts. A single strict-JSON call, not a
   * tool-use loop (there's nothing to look up — everything needed is in the
   * transcript). Never invents a number/name not stated in the transcript;
   * a low overall confidence sets needsReview so an Admin reviews it before
   * it's treated as a verified organizational fact, rather than silently
   * guessing.
   */
  async extractFieldIntelligence(input: {
    transcript: string;
    language: string | null;
    taskContext?: { name: string; objective?: string | null } | null;
  }): Promise<{
    region: string | null;
    householdsVisited: number | null;
    issues: { category: string; affectedHouseholds: number | null; duration: string | null; confidence: number }[];
    summary: string;
    confidence: number;
    needsReview: boolean;
  }> {
    const content = await this.callLLM(
      "You are a field-intelligence extraction system for a political field-organizing platform. You will be given " +
        "a Cadre's field report transcript (possibly in a regional Indian language, already transcribed to text). " +
        "Extract ONLY facts explicitly stated in the transcript — never infer or invent a number, name, or issue " +
        "not present. Respond with STRICT JSON only, no prose, no markdown fences, matching exactly this shape: " +
        `{"region": string|null, "householdsVisited": number|null, "issues": [{"category": string, ` +
        `"affectedHouseholds": number|null, "duration": string|null, "confidence": number}], "summary": string, ` +
        '"confidence": number}. confidence is 0-1. If the transcript is too ambiguous or sparse to extract a field ' +
        "confidently, still include your best guess but with a low confidence score rather than a high one.",
      JSON.stringify({ transcript: input.transcript, language: input.language, task: input.taskContext ?? null }),
    );

    try {
      const cleaned = content.trim().replace(/^```json\s*|```\s*$/g, "");
      const parsed = JSON.parse(cleaned) as {
        region?: string | null;
        householdsVisited?: number | null;
        issues?: { category: string; affectedHouseholds?: number | null; duration?: string | null; confidence?: number }[];
        summary?: string;
        confidence?: number;
      };
      const confidence = typeof parsed.confidence === "number" ? parsed.confidence : 0;
      return {
        region: parsed.region ?? null,
        householdsVisited: parsed.householdsVisited ?? null,
        issues: Array.isArray(parsed.issues)
          ? parsed.issues.map((i) => ({
              category: i.category,
              affectedHouseholds: i.affectedHouseholds ?? null,
              duration: i.duration ?? null,
              confidence: typeof i.confidence === "number" ? i.confidence : 0,
            }))
          : [],
        summary: parsed.summary ?? content.trim(),
        confidence,
        needsReview: confidence < 0.6,
      };
    } catch {
      // Model didn't return valid JSON — most commonly ANTHROPIC_API_KEY
      // isn't set, so callLLM returned its unlabeled placeholder string.
      // Never silently drop the report: surface the raw content for manual
      // review instead of pretending extraction succeeded.
      return { region: null, householdsVisited: null, issues: [], summary: content.trim(), confidence: 0, needsReview: true };
    }
  }

  private saveInsight(campaignId: string, type: any, content: string, metadata?: Record<string, unknown>) {
    return this.prisma.aIInsight.create({
      data: { campaignId, type, content, metadata: metadata as any },
    });
  }
}
