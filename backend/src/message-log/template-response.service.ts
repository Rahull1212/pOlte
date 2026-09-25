import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { TEMPLATE_BUTTON_ACTIONS } from "../fyxo-whatsapp/templates";

export interface RecordResponseInput {
  cadreId?: string | null;
  cadreName: string;
  cadrePhone: string;
  /** How they answered: a tap, typed words, or a voice note / file. */
  responseType: "BUTTON" | "TEXT" | "MEDIA";
  /** Normalised action: VIEW_TASK, CONTACT_ADMIN, ACCEPT, REPLY, ... */
  action: string;
  label?: string | null;
  rawPayload?: string | null;
  taskId?: string | null;
}

/**
 * Records what a Cadre did with a message we sent them.
 *
 * Before this, a template quick-reply arrived at the conversation router,
 * got a log line, and was discarded — so "who opened their task?" had no
 * answer anywhere in the system. Every inbound interaction now leaves a row.
 *
 * Recording must never break the reply: a Cadre tapping a button should get
 * their answer even if this write fails, so every call is wrapped and
 * failures are logged rather than thrown.
 */
@Injectable()
export class TemplateResponseService {
  private readonly logger = new Logger(TemplateResponseService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** The visible button text for an action, for display in the dashboard. */
  private labelFor(action: string): string | undefined {
    return TEMPLATE_BUTTON_ACTIONS.find((b) => b.action === action)?.label;
  }

  /**
   * The action behind a tap whose payload didn't survive.
   *
   * A template Quick Reply arrives as the button's LABEL ("View Task") with
   * no payload — confirmed against a live payload on 2026-09-15. Matching
   * the label back to a known action is what keeps those taps attributable
   * instead of piling up as anonymous QUICK_REPLY rows.
   */
  actionForLabel(label: string): string | undefined {
    const normalised = label.trim().toLowerCase();
    return TEMPLATE_BUTTON_ACTIONS.find((b) => b.label.toLowerCase() === normalised)?.action;
  }

  /**
   * Which task a tap refers to, when the payload didn't say.
   *
   * Falls back to the most recent task message sent to this Cadre — the one
   * they were almost certainly looking at when they tapped. Best-effort by
   * nature, so it only ever fills a gap; a payload that names its task is
   * always preferred.
   */
  private async inferSource(cadreId?: string | null, cadrePhone?: string, label?: string | null) {
    if (!cadreId && !cadrePhone) return null;

    const who = cadreId ? { cadreId } : { cadrePhone: { endsWith: (cadrePhone ?? "").slice(-10) } };
    const recent = await this.prisma.taskMessageLog.findMany({
      where: {
        // Any kind of send, not just task assignments — a standalone poll has
        // no taskId, and requiring one made every poll invisible here.
        //
        // A failed send is excluded: it never reached the handset, so it
        // cannot be the thing being answered.
        status: { not: "FAILED" },
        ...who,
      },
      orderBy: { sentAt: "desc" },
      take: RECENT_MESSAGE_WINDOW,
      select: { id: true, taskId: true, pollId: true, templateName: true },
    });
    if (recent.length === 0) return null;

    // Prefer the newest message that actually OFFERED this button.
    //
    // "Newest message wins" alone is wrong whenever someone has more than one
    // conversation open: a Cadre sent a Yes/No poll and then a task
    // assignment has "Yes" attributed to the task, whose buttons are View
    // Task and Contact Admin and which could never have produced it. Matching
    // the label against each template's own buttons puts the answer back on
    // the thing that asked the question.
    const tapped = label?.trim().toLowerCase();
    if (tapped) {
      for (const message of recent) {
        const offered = await this.buttonsOffered(message);
        if (offered.some((b) => b.trim().toLowerCase() === tapped)) return message;
      }
    }

    // Nothing claims it — fall back to the newest, as before.
    return recent[0];
  }

  /**
   * The buttons a given send actually put in front of the recipient.
   *
   * A poll's are its own options (copied onto the poll when it was created,
   * so they survive the template changing later); anything else takes them
   * from the synced template catalogue.
   */
  private async buttonsOffered(message: { pollId: string | null; templateName: string | null }): Promise<string[]> {
    if (message.pollId) {
      const poll = await this.prisma.poll.findUnique({
        where: { id: message.pollId },
        select: { options: true },
      });
      return poll?.options ?? [];
    }
    if (!message.templateName) return [];
    const template = await this.prisma.availableTemplate.findUnique({
      where: { name: message.templateName },
      select: { buttons: true },
    });
    return template?.buttons ?? [];
  }

  async record(input: RecordResponseInput) {
    try {
      // A label-only tap carries neither its action nor its task; recover
      // both so the dashboard can attribute it, rather than storing an
      // anonymous row that inflates "responded" without saying to what.
      const action =
        input.action === "QUICK_REPLY" && input.label
          ? (this.actionForLabel(input.label) ?? input.action)
          : input.action;

      // A payload that names its task is always preferred; otherwise fall
      // back to the newest message this person was actually sent.
      const named = input.taskId
        ? await this.prisma.taskMessageLog.findFirst({
            where: { taskId: input.taskId, ...(input.cadreId ? { cadreId: input.cadreId } : {}) },
            orderBy: { sentAt: "desc" },
            select: { id: true, taskId: true },
          })
        : null;

      const messageLog = named ?? (await this.inferSource(input.cadreId, input.cadrePhone, input.label));
      // Taken from the matched row rather than inferred separately, so the
      // response's task and its message can never disagree. Null for a
      // standalone poll, which is correct — the link that matters there is
      // the message row's own pollId.
      const taskId = input.taskId ?? messageLog?.taskId ?? null;

      return await this.prisma.templateResponse.create({
        data: {
          messageLogId: messageLog?.id,
          taskId: taskId ?? undefined,
          cadreId: input.cadreId ?? undefined,
          cadreName: input.cadreName,
          cadrePhone: input.cadrePhone,
          responseType: input.responseType,
          action,
          label: input.label ?? this.labelFor(action),
          rawPayload: input.rawPayload,
        },
      });
    } catch (error) {
      this.logger.error(`Failed to record response (${input.action}) for ${input.cadrePhone}: ${error}`);
      return null;
    }
  }
}

/**
 * How far back to look for the send a tap answers. Twenty is comfortably
 * more than anyone receives between reading a message and replying to it,
 * while keeping this to one indexed query.
 */
const RECENT_MESSAGE_WINDOW = 20;
