import { Injectable, Logger } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { PrismaService } from "../prisma/prisma.service";
import { TasksService } from "../tasks/tasks.service";
import { FyxoWhatsAppService } from "../fyxo-whatsapp/fyxo-whatsapp.service";
import { FieldReportsService } from "../field-reports/field-reports.service";
import { CadreAgentService } from "./cadre-agent.service";
import { AuthenticatedUser } from "../auth/types";
import { FyxoInboundMessage } from "../fyxo-agent/fyxo-inbound.types";

const UPLOADS_DIR = join(process.cwd(), "uploads");

/**
 * Sits between the Fyxo webhook queue processor and every downstream agent
 * (Part 24's "CONVERSATION ROUTER" box). Resolves WhatsApp identity ->
 * PoliOS Cadre (Part 6), then routes:
 *   - a button tap                -> deterministic TasksService calls (Part 9 — never the LLM)
 *   - a voice/photo/document note -> FieldIntelligenceAgent (via FieldReportsService)
 *   - free text                   -> CadreAgent (tool-use)
 * This is a NEW, separate channel from WhatsAppConversationService (Meta) —
 * per the chosen rollout option, the existing Meta-based menu flow is left
 * completely untouched; this only ever runs for traffic arriving through
 * Fyxo's webhook.
 */
@Injectable()
export class ConversationRouterService {
  private readonly logger = new Logger(ConversationRouterService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tasksService: TasksService,
    private readonly fyxoWhatsApp: FyxoWhatsAppService,
    private readonly fieldReportsService: FieldReportsService,
    private readonly cadreAgent: CadreAgentService,
  ) {}

  async handleInboundMessage(msg: FyxoInboundMessage, correlationId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { phone: msg.from } });

    // Part 6: an unrecognized/unauthorized number is handled safely — a
    // plain reply, no data touched, no crash.
    if (!user || user.role !== "CADRE" || !user.isActive) {
      await this.reply(msg.from, "This number isn't registered as a PoliOS Cadre account. Contact your Admin to be added.");
      return;
    }

    const authedUser: AuthenticatedUser = { id: user.id, role: user.role as AuthenticatedUser["role"], regionId: user.regionId, name: user.name };

    if (msg.type === "button" && msg.buttonId) {
      await this.handleButton(msg.buttonId, authedUser, msg.from, correlationId);
      return;
    }

    if (msg.type === "audio" && (msg.mediaUrl || msg.mediaId)) {
      await this.handleVoice(msg, authedUser, correlationId);
      return;
    }

    if ((msg.type === "image" || msg.type === "document") && (msg.mediaUrl || msg.mediaId)) {
      await this.handleMediaReport(msg, authedUser, correlationId);
      return;
    }

    const text = msg.text?.trim();
    if (!text) {
      await this.reply(msg.from, "Sorry, I couldn't understand that message. Try asking about your tasks, or send a voice note with your field report.");
      return;
    }

    const { reply, toolCalls } = await this.cadreAgent.handleMessage(authedUser, text);
    await this.logActivity({
      correlationId,
      agentName: "CadreAgent",
      cadreId: user.id,
      intent: "free_text",
      output: { toolCalls: toolCalls.map((t) => ({ name: t.name, input: t.input })) },
    });
    await this.reply(msg.from, reply);
  }

  /**
   * Buttons never reach the LLM (Part 9) — each id maps straight to an
   * existing TasksService call. Button ids are expected as
   * "<ACTION>:<taskId>" (e.g. "ACCEPT:cmabc123"), a payload this app
   * controls when the interactive template is authored in Fyxo's console.
   */
  private async handleButton(buttonId: string, user: AuthenticatedUser, from: string, correlationId: string) {
    const [action, taskId] = buttonId.split(":");
    if (!taskId) {
      await this.reply(from, "Sorry, I couldn't process that button.");
      return;
    }

    try {
      switch (action) {
        case "ACCEPT": {
          await this.tasksService.acknowledge(taskId, "ACCEPTED", user);
          const task = await this.prisma.task.findUnique({ where: { id: taskId } });
          await this.reply(
            from,
            `✅ Assignment Accepted\n\n${task?.name}\n\n🎯 Target: ${task?.objective ?? "—"}\n⏰ Due: ${task?.deadline.toLocaleString()}\n\nReply START when you begin field work.`,
          );
          break;
        }
        case "DECLINE": {
          await this.tasksService.acknowledge(taskId, "DECLINED", user);
          await this.reply(from, "You've declined this assignment. Your Admin has been notified.");
          break;
        }
        case "VIEW_DETAILS": {
          const task = await this.prisma.task.findUnique({ where: { id: taskId } });
          if (!task) {
            await this.reply(from, "Assignment not found.");
            break;
          }
          await this.reply(
            from,
            `📋 Assignment Details\n\nTask:\n${task.name}\n\n${task.objective ? `Objective:\n${task.objective}\n\n` : ""}` +
              `Deadline:\n${task.deadline.toLocaleString()}\n\n${task.description ?? ""}`.trim(),
          );
          break;
        }
        case "START": {
          await this.tasksService.startAssignment(taskId, user);
          const task = await this.prisma.task.findUnique({ where: { id: taskId } });
          await this.reply(
            from,
            `🟢 Task Started\n\n${task?.name}\n\nYou can now begin your field work. Send your report here (text, voice, or photo) when ready.`,
          );
          break;
        }
        default:
          await this.reply(from, "Sorry, I couldn't process that button.");
          return;
      }
      await this.logActivity({ correlationId, agentName: "ConversationRouter", cadreId: user.id, taskId, toolName: action, intent: "deterministic_button" });
    } catch (err) {
      await this.reply(from, `Sorry — ${(err as Error).message}`);
    }
  }

  private async handleVoice(msg: FyxoInboundMessage, user: AuthenticatedUser, correlationId: string) {
    const audio = await this.fyxoWhatsApp.downloadMedia((msg.mediaUrl ?? msg.mediaId)!);
    if (!audio) {
      await this.reply(msg.from, "Sorry, I couldn't download your voice note — please try sending it again.");
      return;
    }

    const activeTaskId = await this.resolveActiveTaskId(user.id);
    const report = await this.fieldReportsService.createFromVoice({
      cadreId: user.id,
      taskId: activeTaskId,
      audio,
      filename: `${randomUUID()}.ogg`,
      mimeType: msg.mimeType ?? "audio/ogg",
      rawMediaUrl: msg.mediaUrl ?? null,
      correlationId,
    });

    await this.reply(
      msg.from,
      report.reviewStatus === "NEEDS_REVIEW"
        ? "Thanks — I've recorded your voice report. It needs a quick review before it's confirmed, but it's saved."
        : "Thanks — I've recorded and processed your voice report. It's now part of the field report.",
    );
  }

  private async handleMediaReport(msg: FyxoInboundMessage, user: AuthenticatedUser, correlationId: string) {
    const mediaUrl = msg.mediaUrl ?? (msg.mediaId ? await this.downloadAndPersist(msg.mediaId, msg.mimeType) : null);
    if (!mediaUrl) {
      await this.reply(msg.from, "Sorry, I couldn't process that file — please try again.");
      return;
    }
    const activeTaskId = await this.resolveActiveTaskId(user.id);
    await this.fieldReportsService.createFromPhoto({ cadreId: user.id, taskId: activeTaskId, mediaUrl, caption: msg.caption, correlationId });
    await this.reply(msg.from, "Thanks — your file has been saved as evidence for your assignment.");
  }

  /** Fetches Fyxo media by id and saves it locally (same /uploads stand-in used for Meta media) so it has a stable URL to store as evidence. */
  private async downloadAndPersist(mediaId: string, mimeType?: string): Promise<string | null> {
    const buffer = await this.fyxoWhatsApp.downloadMedia(mediaId);
    if (!buffer) return null;
    const extension = mimeType?.split("/")[1]?.split(";")[0] ?? "bin";
    const filename = `${randomUUID()}.${extension}`;
    await mkdir(UPLOADS_DIR, { recursive: true });
    await writeFile(join(UPLOADS_DIR, filename), buffer);
    const publicUrl = process.env.API_PUBLIC_URL ?? `http://localhost:${process.env.API_PORT ?? 4000}`;
    return `${publicUrl}/uploads/${filename}`;
  }

  private async resolveActiveTaskId(cadreId: string): Promise<string | null> {
    const task = await this.prisma.task.findFirst({
      where: { assignedToId: cadreId, status: "IN_PROGRESS" },
      orderBy: { createdAt: "desc" },
    });
    return task?.id ?? null;
  }

  private async reply(to: string, body: string) {
    await this.fyxoWhatsApp.sendTextMessage({ to, body, idempotencyKey: `reply-${to}-${Date.now()}` });
  }

  private async logActivity(data: {
    correlationId: string;
    agentName: string;
    cadreId?: string;
    taskId?: string | null;
    toolName?: string;
    intent?: string;
    output?: unknown;
  }) {
    try {
      await this.prisma.agentActivityLog.create({
        data: {
          correlationId: data.correlationId,
          agentName: data.agentName,
          cadreId: data.cadreId,
          taskId: data.taskId ?? undefined,
          toolName: data.toolName,
          intent: data.intent,
          output: data.output as any,
        },
      });
    } catch (err) {
      this.logger.error(`Failed to write AgentActivityLog: ${(err as Error).message}`);
    }
  }
}
