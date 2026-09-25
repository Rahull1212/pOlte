import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { WhatsAppApiService } from "../whatsapp-api/whatsapp-api.service";
import { TasksService } from "../tasks/tasks.service";
import { CitizensService } from "../citizens/citizens.service";
import { GrievancesService } from "../grievances/grievances.service";
import { EventsService } from "../events/events.service";
import { AuthenticatedUser } from "../auth/types";
import { WhatsAppInboundMessage } from "./whatsapp-payload.types";

const GRIEVANCE_CATEGORIES = ["Water Supply", "Roads", "Electricity", "Sanitation", "Other"];

const RESET_WORDS = ["MENU", "HI", "HELLO", "START", "HI POLIOS"];

interface SessionContext {
  taskIds?: string[];
  taskId?: string;
  pendingPhoto?: string | null;
  citizenId?: string;
  citizenName?: string;
  citizenPhone?: string;
  category?: string;
  photos?: string[];
  returnTo?: "GRIEVANCE";
  eventIds?: string[];
}

/**
 * The actual "cadre works entirely via WhatsApp" state machine. Every Cadre
 * has at most one WhatsAppSession row tracking which multi-step flow (if
 * any) they're mid-way through, since a webhook has no memory of its own
 * between requests.
 *
 * This only serves CADRE accounts — Admins/Super Admins keep using the web
 * portal, per the scope agreed for this build.
 */
@Injectable()
export class WhatsAppConversationService {
  private readonly logger = new Logger(WhatsAppConversationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly whatsAppApi: WhatsAppApiService,
    private readonly tasksService: TasksService,
    private readonly citizensService: CitizensService,
    private readonly grievancesService: GrievancesService,
    private readonly eventsService: EventsService,
  ) {}

  async handleIncomingMessage(message: WhatsAppInboundMessage): Promise<void> {
    const phone = message.from;
    const user = await this.prisma.user.findUnique({ where: { phone } });

    if (!user || user.role !== "CADRE" || !user.isActive) {
      await this.whatsAppApi.sendText(
        phone,
        "This number isn't registered as a PoliOS Cadre account. Contact your Admin to be added.",
      );
      return;
    }

    const authedUser: AuthenticatedUser = {
      id: user.id,
      role: user.role as AuthenticatedUser["role"],
      regionId: user.regionId,
      name: user.name,
    };

    const session = await this.prisma.whatsAppSession.upsert({
      where: { userId: user.id },
      create: { userId: user.id, state: "MAIN", context: {} },
      update: {},
    });

    const text = message.text?.body?.trim() ?? "";
    const upper = text.toUpperCase();

    let mediaUrl: string | null = null;
    if (message.type === "image" && message.image?.id) {
      mediaUrl = await this.whatsAppApi.downloadMedia(message.image.id);
    }

    if (RESET_WORDS.includes(upper)) {
      await this.resetToMain(user.id);
      await this.sendMainMenu(phone, user.name);
      return;
    }
    if (upper === "CANCEL") {
      await this.resetToMain(user.id);
      await this.whatsAppApi.sendText(phone, "Cancelled.");
      await this.sendMainMenu(phone, user.name);
      return;
    }

    // YES/NO task acknowledgment works from any state — a new task
    // notification can land while a Cadre is mid-way through something
    // else, so this can't wait for them to be sitting at a particular menu.
    const ackMatch = upper.match(/^(?:(\d+)\s+)?(YES|NO)$/);
    if (ackMatch) {
      await this.handleAcknowledgmentReply(phone, authedUser, ackMatch[1], ackMatch[2] as "YES" | "NO");
      return;
    }

    const context = (session.context as SessionContext) ?? {};

    try {
      switch (session.state) {
        case "MAIN":
          await this.handleMainMenuChoice(phone, authedUser, upper);
          break;
        case "TASKS_MENU":
          await this.handleTaskSelection(phone, user, context, text);
          break;
        case "TASK_DETAIL":
          await this.handleTaskDetail(phone, authedUser, context, text, mediaUrl);
          break;
        case "CITIZEN_NAME":
          await this.handleCitizenName(phone, user.id, context, text);
          break;
        case "CITIZEN_PHONE":
          await this.handleCitizenPhone(phone, user.id, context, text);
          break;
        case "CITIZEN_ADDRESS":
          await this.handleCitizenAddress(phone, authedUser, context, text);
          break;
        case "GRIEVANCE_CITIZEN_PHONE":
          await this.handleGrievanceCitizenLookup(phone, authedUser, context, text);
          break;
        case "GRIEVANCE_CATEGORY":
          await this.handleGrievanceCategory(phone, user.id, context, text);
          break;
        case "GRIEVANCE_DESCRIPTION":
          await this.handleGrievanceDescription(phone, authedUser, context, text, mediaUrl);
          break;
        case "EVENTS_MENU":
          await this.handleEventSelection(phone, authedUser, context, text);
          break;
        default:
          await this.resetToMain(user.id);
          await this.sendMainMenu(phone, user.name);
      }
    } catch (err) {
      this.logger.error(`Conversation error for ${phone}: ${(err as Error).message}`);
      await this.whatsAppApi.sendText(phone, "Something went wrong with that. Reply MENU to start over.");
      await this.resetToMain(user.id);
    }
  }

  // ---------- session helpers ----------

  private async setSession(userId: string, state: string, context: SessionContext) {
    await this.prisma.whatsAppSession.update({ where: { userId }, data: { state, context: context as any } });
  }

  private async resetToMain(userId: string) {
    await this.setSession(userId, "MAIN", {});
  }

  private async sendMainMenu(phone: string, name: string) {
    await this.whatsAppApi.sendText(
      phone,
      `Hi ${name}! Reply with a number:\n` +
        `1. My Tasks\n` +
        `2. Today's Events\n\n` +
        `(Reply MENU anytime to come back here, CANCEL to abort what you're doing.)`,
    );
  }

  // ---------- task acknowledgment (YES/NO) ----------

  private async handleAcknowledgmentReply(
    phone: string,
    user: AuthenticatedUser,
    taskIndexRaw: string | undefined,
    yesNo: "YES" | "NO",
  ) {
    const awaiting = await this.tasksService.findAwaitingAcknowledgment(user.id);
    if (awaiting.length === 0) {
      await this.whatsAppApi.sendText(phone, "You don't have any tasks awaiting a response right now.");
      return;
    }

    let task = awaiting[0];
    if (awaiting.length > 1) {
      if (!taskIndexRaw) {
        const list = awaiting.map((t, i) => `${i + 1}. ${t.name} (due ${new Date(t.deadline).toDateString()})`);
        await this.whatsAppApi.sendText(
          phone,
          `You have ${awaiting.length} tasks awaiting a response:\n${list.join("\n")}\n\n` +
            `Reply with the number and YES/NO, e.g. "2 YES".`,
        );
        return;
      }
      const picked = awaiting[Number(taskIndexRaw) - 1];
      if (!picked) {
        await this.whatsAppApi.sendText(phone, "That's not one of your pending task numbers. Reply YES or NO to see the list again.");
        return;
      }
      task = picked;
    }

    const acknowledgment = yesNo === "YES" ? "ACCEPTED" : "DECLINED";
    await this.tasksService.acknowledge(task.id, acknowledgment, user);
    await this.whatsAppApi.sendText(
      phone,
      acknowledgment === "ACCEPTED"
        ? `Got it — you've accepted "${task.name}". Reply MENU any time to see your tasks.`
        : `Got it — you've declined "${task.name}". Your Admin has been notified.`,
    );
  }

  // ---------- main menu ----------

  private async handleMainMenuChoice(phone: string, user: AuthenticatedUser, choice: string) {
    switch (choice) {
      case "1": {
        const tasks = await this.tasksService.findMany({ assignedToId: user.id }, user);
        const open = tasks.filter((t) => t.status !== "COMPLETED" && t.status !== "CANCELLED");
        if (open.length === 0) {
          await this.whatsAppApi.sendText(phone, "You have no open tasks right now.");
          await this.sendMainMenu(phone, user.name);
          return;
        }
        const lines = open.map(
          (t, i) => `${i + 1}. ${t.name} (${t.priority}, due ${new Date(t.deadline).toDateString()})`,
        );
        await this.whatsAppApi.sendText(phone, `Your open tasks:\n${lines.join("\n")}\n\nReply with a number.`);
        await this.setSession(user.id, "TASKS_MENU", { taskIds: open.map((t) => t.id) });
        return;
      }
      // Citizen registration and grievance submission are deliberately not
      // offered here — political-leadership scope only. The handlers for
      // CITIZEN_NAME/CITIZEN_PHONE/CITIZEN_ADDRESS/GRIEVANCE_* below are left
      // in place (dormant) rather than deleted, in case this is revisited.
      case "2": {
        // A booth-level Cadre needs events created anywhere up their chain
        // (their polling station, its constituency, its district, ...) — not just events
        // created at their exact region, and not "descendants" (a booth has
        // none). EventsService.findMany() is built for Admin-style downward
        // scoping, so this walks the tree upward directly instead.
        const ancestorIds = await this.getAncestorRegionIds(user.regionId);
        const events = await this.prisma.event.findMany({
          where: { regionId: { in: ancestorIds } },
          orderBy: { startAt: "asc" },
        });
        const upcoming = events.filter((e) => new Date(e.startAt) >= new Date(Date.now() - 86400000));
        if (upcoming.length === 0) {
          await this.whatsAppApi.sendText(phone, "No upcoming events in your area.");
          await this.sendMainMenu(phone, user.name);
          return;
        }
        const lines = upcoming.map((e, i) => `${i + 1}. ${e.name} — ${new Date(e.startAt).toDateString()}`);
        await this.whatsAppApi.sendText(
          phone,
          `Upcoming events:\n${lines.join("\n")}\n\nReply with a number to mark yourself attending.`,
        );
        await this.setSession(user.id, "EVENTS_MENU", { eventIds: upcoming.map((e) => e.id) });
        return;
      }
      default:
        await this.sendMainMenu(phone, user.name);
    }
  }

  // ---------- tasks ----------

  private async handleTaskSelection(phone: string, user: AuthenticatedUser, context: SessionContext, text: string) {
    const index = Number.parseInt(text, 10) - 1;
    const taskId = context.taskIds?.[index];
    if (taskId === undefined) {
      await this.whatsAppApi.sendText(phone, "Please reply with a valid number from the list, or MENU.");
      return;
    }
    const task = await this.tasksService.findById(taskId, user);
    await this.whatsAppApi.sendText(
      phone,
      `"${task.name}"\n${task.description ?? ""}\n\nReply with your completion % (0-100). You can also send a photo as proof first.`,
    );
    await this.setSession(user.id, "TASK_DETAIL", { taskId });
  }

  private async handleTaskDetail(
    phone: string,
    user: AuthenticatedUser,
    context: SessionContext,
    text: string,
    mediaUrl: string | null,
  ) {
    if (mediaUrl) {
      await this.setSession(user.id, "TASK_DETAIL", { ...context, pendingPhoto: mediaUrl });
      await this.whatsAppApi.sendText(phone, "Photo received. Now reply with your completion % (0-100).");
      return;
    }

    const percent = Number.parseInt(text, 10);
    if (Number.isNaN(percent) || percent < 0 || percent > 100) {
      await this.whatsAppApi.sendText(phone, "Please reply with a number between 0 and 100.");
      return;
    }
    if (!context.taskId) {
      await this.resetToMain(user.id);
      await this.sendMainMenu(phone, user.name);
      return;
    }

    await this.tasksService.submitProgress(
      context.taskId,
      { completionPercentage: percent, photos: context.pendingPhoto ? [context.pendingPhoto] : [], videos: [] },
      user,
    );
    await this.whatsAppApi.sendText(phone, `Progress updated to ${percent}%. Thank you!`);
    await this.resetToMain(user.id);
    await this.sendMainMenu(phone, user.name);
  }

  // ---------- citizen registration ----------

  private async handleCitizenName(phone: string, userId: string, context: SessionContext, text: string) {
    if (!text) {
      await this.whatsAppApi.sendText(phone, "Please send the citizen's name.");
      return;
    }
    await this.whatsAppApi.sendText(phone, "Their phone number? (or reply SKIP if unknown)");
    await this.setSession(userId, "CITIZEN_PHONE", { ...context, citizenName: text });
  }

  private async handleCitizenPhone(phone: string, userId: string, context: SessionContext, text: string) {
    const citizenPhone = text.toUpperCase() === "SKIP" ? undefined : text;
    await this.whatsAppApi.sendText(phone, "Their address / area?");
    await this.setSession(userId, "CITIZEN_ADDRESS", { ...context, citizenPhone });
  }

  private async handleCitizenAddress(
    phone: string,
    user: AuthenticatedUser,
    context: SessionContext,
    text: string,
  ) {
    const citizen = await this.citizensService.register(
      { name: context.citizenName ?? "Unknown", phone: context.citizenPhone, address: text },
      user,
    );

    if (context.returnTo === "GRIEVANCE") {
      await this.whatsAppApi.sendText(
        phone,
        `Citizen "${citizen.name}" registered. Now, what's the grievance about?\n` +
          GRIEVANCE_CATEGORIES.map((c, i) => `${i + 1}. ${c}`).join("\n"),
      );
      await this.setSession(user.id, "GRIEVANCE_CATEGORY", { citizenId: citizen.id });
      return;
    }

    await this.whatsAppApi.sendText(phone, `Citizen "${citizen.name}" registered successfully.`);
    await this.resetToMain(user.id);
    await this.sendMainMenu(phone, user.name);
  }

  // ---------- grievances ----------

  private async handleGrievanceCitizenLookup(
    phone: string,
    user: AuthenticatedUser,
    context: SessionContext,
    text: string,
  ) {
    if (text.toUpperCase() === "NEW") {
      await this.whatsAppApi.sendText(phone, "Citizen's full name?");
      await this.setSession(user.id, "CITIZEN_NAME", { returnTo: "GRIEVANCE" });
      return;
    }

    const citizen = await this.prisma.citizen.findFirst({ where: { phone: text } });
    if (!citizen) {
      await this.whatsAppApi.sendText(
        phone,
        "No citizen found with that number. Reply NEW to register them, or try another number.",
      );
      return;
    }

    await this.whatsAppApi.sendText(
      phone,
      `Found "${citizen.name}". What's the grievance about?\n` +
        GRIEVANCE_CATEGORIES.map((c, i) => `${i + 1}. ${c}`).join("\n"),
    );
    await this.setSession(user.id, "GRIEVANCE_CATEGORY", { citizenId: citizen.id });
  }

  private async handleGrievanceCategory(phone: string, userId: string, context: SessionContext, text: string) {
    const category = GRIEVANCE_CATEGORIES[Number.parseInt(text, 10) - 1];
    if (!category) {
      await this.whatsAppApi.sendText(phone, "Please reply with a valid number from the list.");
      return;
    }
    await this.whatsAppApi.sendText(phone, "Briefly describe the issue (you can also send photos first).");
    await this.setSession(userId, "GRIEVANCE_DESCRIPTION", { ...context, category, photos: [] });
  }

  private async handleGrievanceDescription(
    phone: string,
    user: AuthenticatedUser,
    context: SessionContext,
    text: string,
    mediaUrl: string | null,
  ) {
    if (mediaUrl) {
      const photos = [...(context.photos ?? []), mediaUrl];
      await this.setSession(user.id, "GRIEVANCE_DESCRIPTION", { ...context, photos });
      await this.whatsAppApi.sendText(phone, "Photo added. Send the description when ready.");
      return;
    }
    if (!text) {
      await this.whatsAppApi.sendText(phone, "Please describe the issue in a short message.");
      return;
    }
    if (!context.citizenId || !context.category) {
      await this.resetToMain(user.id);
      await this.sendMainMenu(phone, user.name);
      return;
    }

    const citizen = await this.prisma.citizen.findUnique({ where: { id: context.citizenId } });
    if (!citizen) {
      await this.resetToMain(user.id);
      await this.sendMainMenu(phone, user.name);
      return;
    }

    await this.grievancesService.submit(
      {
        citizenId: context.citizenId,
        regionId: citizen.regionId,
        category: context.category,
        description: text,
        attachmentUrls: context.photos ?? [],
      },
      user,
    );
    await this.whatsAppApi.sendText(phone, "Grievance submitted. Your Admin has been notified.");
    await this.resetToMain(user.id);
    await this.sendMainMenu(phone, user.name);
  }

  // ---------- events ----------

  private async handleEventSelection(
    phone: string,
    user: AuthenticatedUser,
    context: SessionContext,
    text: string,
  ) {
    const index = Number.parseInt(text, 10) - 1;
    const eventId = context.eventIds?.[index];
    if (!eventId) {
      await this.whatsAppApi.sendText(phone, "Please reply with a valid number from the list, or MENU.");
      return;
    }
    await this.eventsService.markAttendance(eventId, { userId: user.id, attended: true }, user);
    await this.whatsAppApi.sendText(phone, "You're marked as attending. See you there!");
    await this.resetToMain(user.id);
    await this.sendMainMenu(phone, user.name);
  }

  private async getAncestorRegionIds(regionId: string): Promise<string[]> {
    const ids: string[] = [regionId];
    let current = await this.prisma.region.findUnique({ where: { id: regionId }, select: { parentId: true } });
    let guard = 0;
    while (current?.parentId && guard < 20) {
      ids.push(current.parentId);
      current = await this.prisma.region.findUnique({ where: { id: current.parentId }, select: { parentId: true } });
      guard += 1;
    }
    return ids;
  }
}
