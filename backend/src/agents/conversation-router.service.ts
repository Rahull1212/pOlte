import { Injectable, Logger } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { PrismaService } from "../prisma/prisma.service";
import { phoneMatchFilter } from "../fyxo-whatsapp/phone.util";
import { TasksService } from "../tasks/tasks.service";
import { FyxoWhatsAppService } from "../fyxo-whatsapp/fyxo-whatsapp.service";
import { FieldReportsService } from "../field-reports/field-reports.service";
import { CadreAgentService } from "./cadre-agent.service";
import { AuthenticatedUser } from "../auth/types";
import { FyxoInboundMessage } from "../fyxo-agent/fyxo-inbound.types";
import { TemplateResponseService } from "../message-log/template-response.service";
import { TemplateButtonReplyDto } from "../shared-types";

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
    private readonly templateResponses: TemplateResponseService,
  ) {}

  async handleInboundMessage(msg: FyxoInboundMessage, correlationId: string): Promise<void> {
    // Fyxo sends E.164 digits (919616926635); PoliOS stores the national
    // form (9616926635). Matching on the trailing digits is what makes an
    // inbound number resolve to its Cadre — an exact comparison never did.
    const user = await this.prisma.user.findFirst({ where: phoneMatchFilter(msg.from) });

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

    // Everything that isn't a button is recorded here, before it is routed
    // — the same rule handleButton follows. A Cadre who TYPES a reply has
    // responded just as much as one who tapped, and recording inside each
    // handler would miss the ones that bail early (a media download that
    // fails is still an inbound message from that person).
    await this.recordInbound(msg, authedUser);

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
   * Answers a template Quick Reply using whatever the Super Admin
   * configured for that button.
   *
   * The configuration lives on the person whose template was sent — read
   * back off the message the Cadre is replying to, not from the Cadre, who
   * owns no template. Returns false when nothing is configured, so the
   * caller can leave the tap to the Fyxo flow instead of inventing a reply.
   */
  private async replyFromButtonConfig(
    label: string,
    taskId: string | null,
    user: AuthenticatedUser,
    from: string,
  ): Promise<boolean> {
    // Which send is this answering? Its owner's template config is the one
    // that applies.
    const message = taskId
      ? await this.prisma.taskMessageLog.findFirst({
          where: { taskId, cadreId: user.id },
          orderBy: { sentAt: "desc" },
          select: { assignedById: true },
        })
      : null;
    if (!message?.assignedById) return false;

    const owner = await this.prisma.user.findUnique({
      where: { id: message.assignedById },
      select: { fyxoTemplateButtons: true },
    });
    const buttons = (owner?.fyxoTemplateButtons as TemplateButtonReplyDto[] | null) ?? [];
    // Matched case-insensitively: Meta reports labels as approved, and a
    // real tap has arrived as "view task" for a button configured as
    // "View Task".
    const config = buttons.find((b) => b.label.trim().toLowerCase() === label.trim().toLowerCase());
    // NONE with added context still replies — the context IS the reply.
    // Only a button with neither an action nor wording is left alone.
    if (!config) return false;
    if (config.action === "NONE" && !config.text?.trim()) return false;

    const body = await this.buildButtonReply(config, taskId);
    if (!body) return false;

    await this.reply(from, body);
    return true;
  }

  /**
   * The text a configured button produces: whatever its action generates,
   * followed by any hand-written context.
   *
   * The two compose rather than compete — "send the task details AND tell
   * them to bring the register" is one button, not a choice between them.
   */
  private async buildButtonReply(config: TemplateButtonReplyDto, taskId: string | null): Promise<string | null> {
    const extra = config.text?.trim() || null;
    const base = await this.buttonActionText(config, taskId);
    if (base && extra) return `${base}\n\n${extra}`;
    return base ?? extra;
  }

  /** Just the action's own output, before any added context. */
  private async buttonActionText(config: TemplateButtonReplyDto, taskId: string | null): Promise<string | null> {
    if (config.action === "NONE") return null;
    if (config.action === "CUSTOM_TEXT") return null;
    if (!taskId) return null;

    if (config.action === "TASK_DETAILS") {
      const task = await this.prisma.task.findUnique({
        where: { id: taskId },
        include: { campaign: { select: { name: true } } },
      });
      if (!task) return null;
      const lines = [`📋 ${task.name}`];
      if (task.campaign) lines.push(`Campaign: ${task.campaign.name}`);
      if (task.objective) lines.push("", task.objective);
      if (task.description) lines.push("", task.description);
      lines.push("", `Due: ${task.deadline.toLocaleString("en-IN")}`);
      lines.push(`Status: ${task.status.replace("_", " ")}`);
      return lines.join("\n");
    }

    if (config.action === "ADMIN_CONTACT") {
      const task = await this.prisma.task.findUnique({
        where: { id: taskId },
        include: { assignedBy: { select: { name: true, phone: true } } },
      });
      // The Admin who assigned the task is the right contact — not a generic
      // support line the Cadre would have to explain themselves to.
      if (!task?.assignedBy) return null;
      return (
        `📞 Your Admin for this task\n\n${task.assignedBy.name}\n${task.assignedBy.phone}\n\n` +
        "You can call them, or just reply here and your message will reach them."
      );
    }
    return null;
  }

  /**
   * Records a non-button inbound: a typed reply, a voice note, a photo or a
   * document.
   *
   * These used to be answered and forgotten — only button taps were stored —
   * so a Cadre who wrote back still showed as a non-responder, and their
   * words never reached the RAG corpus. What they SAID is the more
   * informative half: a tap says they looked, their message says what
   * actually happened in the field.
   *
   * The task is inferred by TemplateResponseService from their most recent
   * task message, since a free-text reply carries no reference of its own.
   */
  private async recordInbound(msg: FyxoInboundMessage, user: AuthenticatedUser) {
    const text = msg.text?.trim();

    const captured = ((): {
      responseType: "TEXT" | "MEDIA";
      action: string;
      label: string | null;
      rawPayload: string | null;
    } => {
      if (msg.type === "audio") {
        return {
          responseType: "MEDIA",
          action: "VOICE_NOTE",
          label: null,
          rawPayload: msg.mediaUrl ?? msg.mediaId ?? null,
        };
      }
      if (msg.type === "image" || msg.type === "document") {
        return {
          responseType: "MEDIA",
          action: msg.type === "image" ? "PHOTO" : "DOCUMENT",
          // A caption is the only words attached to a photo, so it's kept
          // as the label — it's what a reader would quote back.
          label: msg.caption ?? null,
          rawPayload: msg.mediaUrl ?? msg.mediaId ?? null,
        };
      }
      if (text) return { responseType: "TEXT", action: "REPLY", label: text, rawPayload: text };
      // Something arrived we couldn't read. Still a response from a real
      // person, so it's recorded rather than dropped — capped because an
      // unrecognised payload has no size guarantee.
      return {
        responseType: "TEXT",
        action: "UNKNOWN",
        label: null,
        rawPayload: JSON.stringify(msg).slice(0, 2000),
      };
    })();

    await this.templateResponses.record({
      cadreId: user.id,
      cadreName: user.name,
      cadrePhone: msg.from,
      ...captured,
    });
  }

  /**
   * Buttons never reach the LLM (Part 9) — each id maps straight to an
   * existing TasksService call. Button ids are expected as
   * "<ACTION>:<taskId>" (e.g. "ACCEPT:cmabc123"), a payload this app
   * controls when the interactive template is authored in Fyxo's console.
   */
  private async handleButton(buttonId: string, user: AuthenticatedUser, from: string, correlationId: string) {
    const [action, taskId] = buttonId.split(":");

    // Every tap is recorded before anything else happens, whether or not
    // this router goes on to act on it. The response dashboard's entire
    // premise is that no interaction is lost, so recording can't be a side
    // effect of a branch that happens to handle the button.
    const recorded = await this.templateResponses.record({
      cadreId: user.id,
      cadreName: user.name,
      cadrePhone: from,
      responseType: "BUTTON",
      action: taskId ? action : "QUICK_REPLY",
      label: taskId ? undefined : buttonId,
      rawPayload: buttonId,
      taskId: taskId ?? null,
    });

    if (!taskId) {
      // An approved template's own Quick Reply: the tap arrives as the
      // button's LABEL ("view task") with no payload. What it replies with
      // is configured per template on the WhatsApp Templates page, so a
      // Super Admin decides what each button says rather than it being
      // fixed in code.
      const replied = await this.replyFromButtonConfig(buttonId, recorded?.taskId ?? null, user, from);
      if (!replied) {
        // Nothing configured for this label — leave it to the Fyxo flow,
        // which answers via the details endpoint (API.md §11). Speaking
        // here too would send the Cadre two replies for one tap.
        this.logger.log(`Quick reply "${buttonId}" has no configured action; left to the Fyxo flow`);
      }
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
        // ---- task_assigned_v2's two Quick Replies ----
        case "VIEW_TASK": {
          const task = await this.prisma.task.findUnique({
            where: { id: taskId },
            include: {
              campaign: { select: { name: true } },
              assignedBy: { select: { name: true, phone: true } },
            },
          });
          if (!task) {
            await this.reply(from, "That task could not be found. Please contact your Admin.");
            break;
          }
          const lines = [`📋 ${task.name}`];
          if (task.campaign) lines.push(`Campaign: ${task.campaign.name}`);
          if (task.objective) lines.push("", task.objective);
          if (task.description) lines.push("", task.description);
          lines.push("", `Due: ${task.deadline.toLocaleString("en-IN")}`);
          lines.push(`Status: ${task.status.replace("_", " ")}`);
          await this.reply(from, lines.join("\n"));
          break;
        }
        case "CONTACT_ADMIN": {
          const task = await this.prisma.task.findUnique({
            where: { id: taskId },
            include: { assignedBy: { select: { name: true, phone: true } } },
          });
          // The Admin who assigned the task is the right contact — not a
          // generic support line the Cadre would have to explain themselves to.
          if (!task?.assignedBy) {
            await this.reply(from, "We couldn't find your Admin's details. Please reply here and we'll pass it on.");
            break;
          }
          await this.reply(
            from,
            `📞 Your Admin for this task\n\n${task.assignedBy.name}\n${task.assignedBy.phone}\n\n` +
              "You can call them, or just reply here and your message will reach them.",
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
          // Same reasoning as above: an unrecognised action is a template
          // button the flow owns, not something to apologise for.
          this.logger.log(`Unrecognised button action "${action}" left to the Fyxo flow`);
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
