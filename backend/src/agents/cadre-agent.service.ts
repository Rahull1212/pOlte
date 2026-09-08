import { Injectable, Logger } from "@nestjs/common";
import Anthropic from "@anthropic-ai/sdk";
import { AuthenticatedUser } from "../auth/types";
import { PrismaService } from "../prisma/prisma.service";
import { CadreToolsService } from "./cadre-tools.service";
import { AgentToolDef, ToolCallTrace, runToolLoop } from "./agent-runtime";

const SYSTEM_PROMPT =
  "You are the PoliOS Cadre Agent, a WhatsApp assistant for a field Cadre in a political organizing platform. " +
  "You ONLY answer using data returned by your tools — you must NEVER invent assignments, deadlines, statuses, " +
  "progress numbers, or Cadre information. If a tool returns an error or empty result, say so plainly instead of " +
  "guessing. Keep replies short and WhatsApp-friendly (a few sentences, no markdown tables). Deterministic actions " +
  "like Accept/Decline/Start/Submit are usually handled by buttons already — only call those tools yourself when " +
  "the Cadre asks in plain language (e.g. 'I completed the task', 'I can't do this today'). When a Cadre reports " +
  "being unable to complete work, travel, or an emergency, use raiseAssignmentException so their Admin is notified " +
  "rather than just sympathizing in text.";

const CADRE_AGENT_TOOLS: AgentToolDef[] = [
  { name: "getMyProfile", description: "Get the Cadre's own name, phone, and assigned area.", input_schema: { type: "object", properties: {} } },
  {
    name: "getMyAssignments",
    description: "List the Cadre's current task assignments.",
    input_schema: {
      type: "object",
      properties: { includeCompleted: { type: "boolean", description: "Include completed/cancelled tasks too. Default false." } },
    },
  },
  {
    name: "getAssignmentDetails",
    description: "Get full details (objective, description, deadline, priority, status) of one assignment.",
    input_schema: { type: "object", properties: { taskId: { type: "string" } }, required: ["taskId"] },
  },
  {
    name: "getAssignmentProgress",
    description: "Get the current completion percentage and status of one assignment.",
    input_schema: { type: "object", properties: { taskId: { type: "string" } }, required: ["taskId"] },
  },
  {
    name: "acceptAssignment",
    description: "Accept a pending assignment (equivalent to tapping the Accept button).",
    input_schema: { type: "object", properties: { taskId: { type: "string" } }, required: ["taskId"] },
  },
  {
    name: "declineAssignment",
    description: "Decline a pending assignment (equivalent to tapping the Decline button).",
    input_schema: { type: "object", properties: { taskId: { type: "string" } }, required: ["taskId"] },
  },
  {
    name: "startAssignment",
    description: "Mark an already-accepted assignment as started/in-progress.",
    input_schema: { type: "object", properties: { taskId: { type: "string" } }, required: ["taskId"] },
  },
  {
    name: "submitAssignment",
    description: "Submit a completion percentage (0-100) for an assignment.",
    input_schema: {
      type: "object",
      properties: { taskId: { type: "string" }, completionPercentage: { type: "number" } },
      required: ["taskId", "completionPercentage"],
    },
  },
  {
    name: "raiseAssignmentException",
    description:
      "Flag that the Cadre cannot complete an assignment as planned — traveling, an emergency, blocked, or any other reason. Notifies the Admin who assigned it.",
    input_schema: {
      type: "object",
      properties: { taskId: { type: "string" }, reason: { type: "string" } },
      required: ["taskId", "reason"],
    },
  },
  {
    name: "getMyTaskHistory",
    description: "List the Cadre's completed assignments, most recent first.",
    input_schema: {
      type: "object",
      properties: { sinceDays: { type: "number", description: "Only include tasks completed in the last N days." } },
    },
  },
  {
    name: "getTaskInstructions",
    description: "Get the detailed field instructions/objective for one assignment.",
    input_schema: { type: "object", properties: { taskId: { type: "string" } }, required: ["taskId"] },
  },
];

export interface CadreAgentReply {
  reply: string;
  toolCalls: ToolCallTrace[];
}

/**
 * The conversational AI interface between WhatsApp and PoliOS for a Cadre
 * (Part 7 of the spec) — single-turn tool-calling over CadreToolsService.
 * Deliberately stateless across messages: every turn re-fetches live data
 * via tools rather than trusting a remembered conversation history, so the
 * model can never act on stale/hallucinated context from an earlier turn.
 */
@Injectable()
export class CadreAgentService {
  private readonly logger = new Logger(CadreAgentService.name);
  private readonly client: Anthropic | null;

  constructor(
    private readonly cadreTools: CadreToolsService,
    private readonly prisma: PrismaService,
  ) {
    this.client = process.env.ANTHROPIC_API_KEY ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }) : null;
  }

  async handleMessage(user: AuthenticatedUser, message: string): Promise<CadreAgentReply> {
    if (!this.client) {
      this.logger.warn("ANTHROPIC_API_KEY not set — CadreAgent cannot process free-form messages");
      return {
        reply: "I can't process free-form questions right now. Reply MENU to see your tasks, or YES/NO to respond to an assignment.",
        toolCalls: [],
      };
    }

    const executeTool = async (name: string, input: Record<string, unknown>): Promise<unknown> => {
      switch (name) {
        case "getMyProfile":
          return this.cadreTools.getMyProfile(user);
        case "getMyAssignments":
          return this.cadreTools.getMyAssignments(user, Boolean(input.includeCompleted));
        case "getAssignmentDetails":
          return this.cadreTools.getAssignmentDetails(String(input.taskId ?? ""), user);
        case "getAssignmentProgress":
          return this.cadreTools.getAssignmentProgress(String(input.taskId ?? ""), user);
        case "acceptAssignment":
          return this.cadreTools.acceptAssignment(String(input.taskId ?? ""), user);
        case "declineAssignment":
          return this.cadreTools.declineAssignment(String(input.taskId ?? ""), user);
        case "startAssignment":
          return this.cadreTools.startAssignment(String(input.taskId ?? ""), user);
        case "submitAssignment":
          return this.cadreTools.submitAssignment(String(input.taskId ?? ""), Number(input.completionPercentage), user);
        case "raiseAssignmentException":
          return this.cadreTools.raiseAssignmentException(String(input.taskId ?? ""), String(input.reason ?? ""), user);
        case "getMyTaskHistory":
          return this.cadreTools.getMyTaskHistory(user, input.sinceDays !== undefined ? Number(input.sinceDays) : undefined);
        case "getTaskInstructions":
          return this.cadreTools.getTaskInstructions(String(input.taskId ?? ""), user);
        default:
          return { error: `Unknown tool: ${name}` };
      }
    };

    const result = await runToolLoop(this.client, {
      model: "claude-sonnet-4-5",
      system: SYSTEM_PROMPT,
      tools: CADRE_AGENT_TOOLS,
      executeTool,
      userMessage: message,
    });

    return {
      reply: result.finalText || "Sorry, I couldn't process that — reply MENU for the basic options.",
      toolCalls: result.toolCalls,
    };
  }
}
