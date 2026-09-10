import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { AssignMessageTemplateDto } from "../shared-types";
import { PrismaService } from "../prisma/prisma.service";
import { FYXO_TEMPLATES } from "../fyxo-whatsapp/templates";

export interface TemplateOwner {
  userId: string;
  name: string;
  role: string;
  area: string;
  templateName: string | null;
  templateLanguage: string | null;
  templateBody: string | null;
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
      isSelf: u.id === currentUserId,
    }));
  }

  async assign(userId: string, dto: AssignMessageTemplateDto): Promise<TemplateOwner[]> {
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
      },
    });

    return this.list(userId);
  }

  async clear(userId: string, currentUserId: string): Promise<TemplateOwner[]> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { fyxoTemplateName: null, fyxoTemplateLanguage: null, fyxoTemplateBody: null },
    });
    return this.list(currentUserId);
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
