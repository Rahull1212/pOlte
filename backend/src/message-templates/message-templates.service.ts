import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { TemplateButtonReplyDto, AssignMessageTemplateDto } from "../shared-types";
import { PrismaService } from "../prisma/prisma.service";
import { AuthenticatedUser } from "../auth/types";
import { FYXO_TEMPLATES } from "../fyxo-whatsapp/templates";

export interface TemplateOwner {
  userId: string;
  name: string;
  role: string;
  area: string;
  templateName: string | null;
  templateLanguage: string | null;
  templateBody: string | null;
  // What each {{n}} is filled with, in order. Empty means the default
  // who/what/when order is used.
  templateVariables: string[];
  // What each Quick Reply replies with when tapped. Empty means every
  // button keeps its built-in behaviour.
  templateButtons: TemplateButtonReplyDto[];
  // True for the row representing the Super Admin viewing the page.
  isSelf: boolean;
}

/**
 * Which approved WhatsApp template each task-owner's assignments go out with.
 *
 * The rule, matching the Google Sheet's tab rule exactly: the template
 * follows whoever CREATED the task, not whoever pressed send. A task the
 * Super Admin created keeps the Super Admin's template even though an Admin
 * is the one allocating it; a task an Admin created themselves uses that
 * Admin's own. (If it followed the sender instead, the Super Admin's
 * template could never be used at all — only Admins ever allocate to Cadres.)
 *
 * Assignment is Super-Admin-only and lives on the User row
 * (User.fyxoTemplateName). One template per person, but any number of people
 * may share the same one — campaigns have far more Admins than approved
 * templates. Nobody is required to have one: an unassigned owner falls back
 * to the default "polios" template.
 */
@Injectable()
export class MessageTemplatesService {
  constructor(private readonly prisma: PrismaService) {}

  /** The Super Admin plus every Admin, each with the template they own. */
  async list(currentUserId: string): Promise<TemplateOwner[]> {
    const users = await this.prisma.user.findMany({
      where: { role: { in: ["SUPER_ADMIN", "ADMIN"] }, isActive: true },
      select: {
        id: true,
        name: true,
        role: true,
        fyxoTemplateName: true,
        fyxoTemplateLanguage: true,
        fyxoTemplateBody: true,
        fyxoTemplateVariables: true,
        fyxoTemplateButtons: true,
        region: { select: { name: true, type: true } },
      },
      // Super Admins first, then Admins alphabetically — the viewer's own
      // row sits at the top where they'd look for it.
      orderBy: [{ role: "asc" }, { name: "asc" }],
    });

    return users.map((u) => ({
      userId: u.id,
      name: u.name,
      role: u.role,
      area: u.region ? `${u.region.name} (${u.region.type})` : "—",
      templateName: u.fyxoTemplateName,
      templateLanguage: u.fyxoTemplateLanguage,
      templateBody: u.fyxoTemplateBody,
      templateVariables: u.fyxoTemplateVariables,
      templateButtons: (u.fyxoTemplateButtons as TemplateButtonReplyDto[] | null) ?? [],
      isSelf: u.id === currentUserId,
    }));
  }

  /**
   * Points a user at an approved template.
   *
   * A Super Admin may set anyone's. An Admin may set only their own — they
   * change it while creating a task, which is the only place the choice
   * reaches them, and letting them repoint a peer's messaging from there
   * would be a quiet privilege escalation.
   */
  async assign(
    userId: string,
    dto: AssignMessageTemplateDto,
    requester: AuthenticatedUser,
  ): Promise<TemplateOwner[]> {
    if (requester.role !== "SUPER_ADMIN" && userId !== requester.id) {
      throw new ForbiddenException("You can only change your own template");
    }

    const target = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true, role: true } });
    if (!target) throw new NotFoundException("User not found");
    if (target.role === "CADRE") {
      // Cadres receive messages, they don't own the template a task is sent
      // with — assigning one here would never be read by anything.
      throw new BadRequestException("Templates are assigned to Admins, not Cadres");
    }

    // No uniqueness check: several Admins sharing one template is normal and
    // expected, since a campaign has far more Admins than approved templates.
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        fyxoTemplateName: dto.templateName,
        fyxoTemplateLanguage: dto.templateLanguage,
        fyxoTemplateBody: dto.templateBody?.trim() || null,
        fyxoTemplateVariables: dto.templateVariables ?? [],
        // Undefined clears it, which is the honest reading of "no buttons
        // configured" — the router then falls back to built-in behaviour.
        fyxoTemplateButtons: (dto.templateButtons ?? []) as unknown as Prisma.InputJsonValue,
      },
    });

    // A Super Admin gets the whole page's data back; an Admin only their
    // own row, since the full list is not theirs to read.
    return requester.role === "SUPER_ADMIN" ? this.list(requester.id) : this.mine(userId);
  }

  /**
   * The caller's own template row.
   *
   * Queried directly rather than filtering list(): an Admin has no business
   * reading every other Admin's template, and a filter applied after the
   * fact is one refactor away from leaking the lot.
   */
  async mine(userId: string): Promise<TemplateOwner[]> {
    const u = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        role: true,
        fyxoTemplateName: true,
        fyxoTemplateLanguage: true,
        fyxoTemplateBody: true,
        fyxoTemplateVariables: true,
        fyxoTemplateButtons: true,
        region: { select: { name: true, type: true } },
      },
    });
    if (!u) return [];
    return [
      {
        userId: u.id,
        name: u.name,
        role: u.role,
        area: u.region ? `${u.region.name} (${u.region.type})` : "—",
        templateName: u.fyxoTemplateName,
        templateLanguage: u.fyxoTemplateLanguage,
        templateBody: u.fyxoTemplateBody,
        templateVariables: u.fyxoTemplateVariables,
        templateButtons: (u.fyxoTemplateButtons as TemplateButtonReplyDto[] | null) ?? [],
        isSelf: true,
      },
    ];
  }

  async clear(userId: string, currentUserId: string): Promise<TemplateOwner[]> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { fyxoTemplateName: null, fyxoTemplateLanguage: null, fyxoTemplateBody: null, fyxoTemplateVariables: [] },
    });
    return this.list(currentUserId);
  }

  /**
   * How many {{n}} placeholders a template declares, from the synced
   * catalogue. Fyxo reports this per template (§9 `variables`), so PoliOS
   * can fill exactly the right number instead of assuming one — a mismatch
   * is a hard 400 from Fyxo before anything is sent (§5).
   *
   * Defaults to 1 for a template not in the catalogue (never synced, or
   * approved since the last sync), which matches every template this app has
   * used and is the safest guess.
   */
  async variableCountFor(templateName: string): Promise<number> {
    const row = await this.prisma.availableTemplate.findUnique({
      where: { name: templateName },
      select: { variables: true },
    });
    return row?.variables ?? 1;
  }

  /**
   * The template a task owner's assignment messages go out with — their own
   * if one is assigned, else the shared default. Callers pass the *task
   * creator*, not the sender (see this class's doc comment).
   */
  static resolveFor(owner: {
    fyxoTemplateName: string | null;
    fyxoTemplateLanguage: string | null;
    fyxoTemplateBody: string | null;
  }): { name: string; language: string; body?: string } {
    if (!owner.fyxoTemplateName) return { ...FYXO_TEMPLATES.TASK_ASSIGNED };
    return {
      name: owner.fyxoTemplateName,
      language: owner.fyxoTemplateLanguage ?? "en",
      body: owner.fyxoTemplateBody ?? undefined,
    };
  }
}
