import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

export interface DetailsRequest {
  waId?: string;
  reference?: string;
  text?: string;
}

/**
 * Answers Fyxo's "Fetch from your system" call (API.md §11) when a Cadre taps
 * a template button: we return the task text and Fyxo delivers it as a
 * free-form WhatsApp message.
 *
 * This is what replaces keeping task text in a spreadsheet. Nothing is copied
 * into Fyxo — the task is read from Postgres at the moment of the tap, so a
 * reassignment made a minute earlier is already reflected and there is no
 * export step that can go stale.
 *
 * Must answer within 8 seconds or Fyxo sends the step's fallback text
 * instead, so everything here is a single indexed query — no AI, no external
 * calls, nothing queued.
 */
@Injectable()
export class TaskDetailsService {
  private readonly logger = new Logger(TaskDetailsService.name);

  async buildReply(body: DetailsRequest): Promise<string> {
    const task = body.reference ? await this.byReference(body.reference) : await this.currentForPhone(body.waId);

    if (!task) {
      // §11: the recipient always gets something — silence reads as broken.
      // A plain, true sentence beats a fallback that sounds like an error.
      return "You don't have an open task right now. If you were expecting one, please contact your Admin.";
    }

    // WHICH button was tapped decides what comes back. The payload has always
    // carried it ("CONTACT_ADMIN:cmu83dz…"), but only the task id was read
    // off it — so every button, Contact Admin included, replied with the full
    // task details. Both Fetch steps in the Fyxo flow call this one endpoint,
    // so this is the only place that can tell them apart.
    const intent = this.intentOf(body);
    if (intent === "CONTACT_ADMIN") return this.adminContactReply(task);
    if (intent === "UPDATE_STATUS") return this.updateStatusReply(task);

    const lines = [task.name];
    if (task.objective) lines.push("", task.objective);
    if (task.description) lines.push("", task.description);

    // Where the work is, in the Election Commission's own terms — the same
    // wording the Cadre will see on the roll, so there is no translating
    // between what the app calls a place and what the ECI does.
    const station = task.pollingStation;
    if (station) {
      const constituency = station.parent;
      const district = constituency?.parent;
      lines.push("", "Official location:");
      if (district?.parent?.name) lines.push(`State: ${district.parent.name}`);
      if (district?.name) lines.push(`District: ${district.name}`);
      if (constituency) {
        lines.push(
          `Assembly Constituency: ${constituency.number ? `${constituency.number} — ${constituency.name}` : constituency.name}`,
        );
      }
      lines.push(`Polling Station: ${station.number ? `${station.number} — ${station.name}` : station.name}`);
    }

    lines.push("", `Due: ${formatDeadline(task.deadline)}`);
    lines.push(`Priority: ${titleCase(task.priority)}`);
    lines.push(`Assigned by: ${task.assignedBy.name}`);
    if (task.assignedBy.phone) lines.push(`Contact: ${task.assignedBy.phone}`);
    return lines.join("\n");
  }

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Which button this request is answering.
   *
   * The payload prefix is authoritative — it is set by PoliOS at send time
   * (see taskButtonPayloads). The label in `text` is the fallback for a send
   * that predates payloads, or a Cadre who typed rather than tapped.
   *
   * Anything unrecognised is treated as a request for the task itself: that
   * is what someone poking at the flow almost always wants, and it is the
   * safer of the two to give by mistake.
   */
  private intentOf(body: DetailsRequest): Intent {
    const reference = body.reference ?? "";
    if (reference.includes(":")) {
      const prefix = reference.split(":")[0].trim().toUpperCase();
      if (prefix === "CONTACT_ADMIN") return "CONTACT_ADMIN";
      if (prefix === "UPDATE_STATUS") return "UPDATE_STATUS";
      if (prefix === "VIEW_TASK") return "VIEW_TASK";
    }
    // The reminder template (task_reminder) is sent by the Fyxo flow, not by
    // PoliOS, so its buttons carry no payload at all — the label in `text` is
    // the only thing identifying them. Without this the reminder's "Update
    // Status" button replied with the task details again.
    const text = (body.text ?? "").trim().toLowerCase();
    if (text === "contact admin" || text === "contact_admin") return "CONTACT_ADMIN";
    if (text === "update status" || text === "update_status") return "UPDATE_STATUS";
    return "VIEW_TASK";
  }

  /**
   * What the Cadre should do to report progress. Says where the task stands
   * now so they are not guessing what has already been recorded, then asks
   * for the one thing that actually updates it: a reply.
   */
  private updateStatusReply(task: { name: string; status: string; deadline: Date }): string {
    return [
      `Update status: ${task.name}`,
      "",
      `Currently recorded as: ${humanStatus(task.status)}`,
      `Due: ${formatDeadline(task.deadline)}`,
      "",
      "Reply to this message with your progress (for example \"50% done\" or \"completed\") and your Admin will see it.",
    ].join("\n");
  }

  /**
   * Who to contact about this task, and how — not the task text again.
   *
   * Names the task so a Cadre holding several knows which Admin this is, and
   * says plainly when no number is on file rather than sending a line that
   * trails off after "Contact:".
   */
  private adminContactReply(task: { name: string; assignedBy: { name: string; phone: string | null } }): string {
    const lines = [`Contact for: ${task.name}`, "", `Admin: ${task.assignedBy.name}`];
    if (task.assignedBy.phone) {
      lines.push(`Phone: ${task.assignedBy.phone}`, "", "You can call or message them directly on this number.");
    } else {
      lines.push("", "No phone number is on file for them yet — please reply here and we will pass it on.");
    }
    return lines.join("\n");
  }

  /**
   * `reference` is the buttonPayloads value we set at send time — the Cadre's
   * own Task id, which makes the tap unambiguous even when they have several
   * open tasks.
   */
  private byReference(reference: string) {
    // Payloads now carry the button's action as well as the task
    // ("VIEW_TASK:cmabc123"), so a tap says WHICH button was pressed. Older
    // sends carry the bare task id — both forms have to resolve, or every
    // message sent before this change would stop answering.
    const taskId = reference.includes(":") ? reference.split(":").pop()! : reference;
    return this.prisma.task.findUnique({
      where: { id: taskId },
      select: TASK_FIELDS,
    });
  }

  /**
   * Fallback for §11's documented "`reference` can be absent" case — the
   * Cadre typed instead of tapping, or the send predates buttonPayloads.
   * Answers with whatever is currently live for that number: the soonest
   * deadline among their unfinished tasks, which is the one a person asking
   * "what's my task?" almost always means.
   */
  private async currentForPhone(waId: string | undefined) {
    if (!waId) return null;
    const cadre = await this.prisma.user.findFirst({
      // Fyxo sends E.164 digits with no "+", while numbers are stored here
      // however they were entered — match on the trailing digits rather than
      // assuming either side's formatting.
      where: { phone: { endsWith: waId.replace(/^\+/, "").slice(-10) } },
      select: { id: true },
    });
    if (!cadre) return null;

    return this.prisma.task.findFirst({
      where: {
        assignedToId: cadre.id,
        status: { notIn: ["COMPLETED", "CANCELLED"] },
      },
      orderBy: { deadline: "asc" },
      select: TASK_FIELDS,
    });
  }
}

const TASK_FIELDS = {
  id: true,
  name: true,
  status: true,
  objective: true,
  description: true,
  deadline: true,
  priority: true,
  assignedBy: { select: { name: true, phone: true } },
  // Three levels of parent give the AC, District and State without a
  // second round trip — this has to answer inside Fyxo's 8-second window.
  pollingStation: {
    select: {
      name: true,
      number: true,
      parent: {
        select: {
          name: true,
          number: true,
          parent: { select: { name: true, parent: { select: { name: true } } } },
        },
      },
    },
  },
} as const;

function formatDeadline(deadline: Date): string {
  return deadline.toLocaleString("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

function titleCase(value: string): string {
  return value.charAt(0) + value.slice(1).toLowerCase();
}

type Intent = "VIEW_TASK" | "CONTACT_ADMIN" | "UPDATE_STATUS";

function humanStatus(status: string): string {
  const text = status.replace(/_/g, " ").toLowerCase();
  return text.charAt(0).toUpperCase() + text.slice(1);
}
