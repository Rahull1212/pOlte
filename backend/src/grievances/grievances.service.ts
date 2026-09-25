import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { GrievanceStatus, SubmitGrievanceDto } from "../shared-types";
import { PrismaService } from "../prisma/prisma.service";
import { AuthenticatedUser } from "../auth/types";
import { RegionsService } from "../regions/regions.service";
import { NotificationsService } from "../notifications/notifications.service";

/**
 * What each status may become next.
 *
 * ADMIN submits -> OPEN -> Super Admin reviews -> IN_PROGRESS -> RESOLVED,
 * with OPEN -> REJECTED available for anything that shouldn't proceed.
 * RESOLVED and REJECTED are terminal: a decision that has been communicated
 * to the submitter can't be quietly walked back.
 */
const ALLOWED_TRANSITIONS: Record<GrievanceStatus, GrievanceStatus[]> = {
  OPEN: ["IN_PROGRESS", "RESOLVED", "REJECTED"],
  IN_PROGRESS: ["RESOLVED", "REJECTED"],
  RESOLVED: [],
  REJECTED: [],
};

/** Everything a caller is allowed to see about a grievance. */
const GRIEVANCE_INCLUDE = {
  citizen: true,
  region: { select: { id: true, name: true, type: true } },
  submittedBy: { select: { id: true, name: true, role: true } },
  resolvedBy: { select: { id: true, name: true } },
} as const;

@Injectable()
export class GrievancesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly regionsService: RegionsService,
    private readonly notificationsService: NotificationsService,
  ) {}

  /**
   * Filed by an Admin on the web, or by a Cadre through the WhatsApp flow
   * (WhatsAppConversationService calls this directly, which is why the role
   * check lives here and not only on the controller).
   *
   * A Super Admin can never be the submitter: they are the authority that
   * decides grievances, and letting them raise one would put them on both
   * sides of their own decision.
   */
  async submit(dto: SubmitGrievanceDto, user: AuthenticatedUser) {
    if (user.role === "SUPER_ADMIN") {
      throw new ForbiddenException(
        "Super Admins review and resolve grievances rather than raising them — ask the Admin for the area to submit it.",
      );
    }

    const withinScope = await this.regionsService.isWithinScope(user.regionId, dto.regionId);
    if (!withinScope) throw new ForbiddenException("Region is outside your area");

    let citizen = null;
    if (dto.citizenId) {
      citizen = await this.prisma.citizen.findUnique({ where: { id: dto.citizenId } });
      if (!citizen) throw new NotFoundException("Citizen not found");
    }

    const grievance = await this.prisma.grievance.create({
      data: {
        citizenId: dto.citizenId,
        regionId: dto.regionId,
        submittedById: user.id,
        submittedByRole: user.role,
        category: dto.category,
        description: dto.description,
        attachmentUrls: dto.attachmentUrls,
      },
      include: GRIEVANCE_INCLUDE,
    });

    await this.notifyReviewers(grievance.id, user, dto.category, citizen?.name);

    return grievance;
  }

  /**
   * A Cadre's grievance goes to their own Admin, as before. An Admin's goes
   * to the Super Admins, who are the only people who can act on it —
   * without this an Admin could file one and nobody would ever be told.
   */
  private async notifyReviewers(
    grievanceId: string,
    submitter: AuthenticatedUser,
    category: string,
    citizenName?: string,
  ) {
    const message = citizenName ? `${citizenName}: ${category}` : category;
    const payload = {
      type: "GRIEVANCE_SUBMITTED" as const,
      title: "New grievance submitted",
      message,
      relatedEntityType: "Grievance",
      relatedEntityId: grievanceId,
    };

    if (submitter.role === "ADMIN") {
      const superAdmins = await this.prisma.user.findMany({
        where: { role: "SUPER_ADMIN", isActive: true },
        select: { id: true },
      });
      if (superAdmins.length > 0) {
        await this.notificationsService.notifyMany(
          superAdmins.map((s) => s.id),
          payload,
        );
      }
      return;
    }

    const record = await this.prisma.user.findUnique({ where: { id: submitter.id } });
    if (record?.parentUserId) {
      await this.notificationsService.notify({ userId: record.parentUserId, ...payload });
    }
  }

  /**
   * SUPER_ADMIN sees every grievance — that is the whole point of their
   * review queue. Everyone else sees their own area's, which includes the
   * ones they submitted themselves and the ones their Cadres filed over
   * WhatsApp (those are what the Admin gets notified about).
   */
  async findMany(user: AuthenticatedUser, filters: { status?: GrievanceStatus; regionId?: string } = {}) {
    if (filters.regionId && user.role !== "SUPER_ADMIN") {
      const withinScope = await this.regionsService.isWithinScope(user.regionId, filters.regionId);
      if (!withinScope) throw new ForbiddenException("Region is outside your area");
    }

    const scopedRegionIds =
      user.role === "SUPER_ADMIN" ? undefined : await this.regionsService.descendantIds(user.regionId);

    return this.prisma.grievance.findMany({
      where: {
        status: filters.status,
        regionId: filters.regionId ?? (scopedRegionIds ? { in: scopedRegionIds } : undefined),
      },
      include: GRIEVANCE_INCLUDE,
      orderBy: { createdAt: "desc" },
    });
  }

  /**
   * Full detail for one grievance. Out of scope reports "not found" rather
   * than "forbidden", so the endpoint can't be used to discover which
   * grievance ids exist — the same rule the rest of PoliOS follows.
   */
  async findById(id: string, user: AuthenticatedUser) {
    const grievance = await this.prisma.grievance.findUnique({
      where: { id },
      include: GRIEVANCE_INCLUDE,
    });
    if (!grievance) throw new NotFoundException("Grievance not found");

    if (user.role !== "SUPER_ADMIN") {
      const withinScope = await this.regionsService.isWithinScope(user.regionId, grievance.regionId);
      if (!withinScope) throw new NotFoundException("Grievance not found");
    }
    return grievance;
  }

  /**
   * Moves a grievance along the workflow. Super Admin only — an Admin
   * marking their own grievance RESOLVED would be marking their own
   * homework, which is exactly what this module is meant to prevent.
   */
  async setStatus(id: string, status: GrievanceStatus, resolutionNotes: string | undefined, user: AuthenticatedUser) {
    const grievance = await this.assertCanDecide(id, user);

    if (status === grievance.status) {
      throw new BadRequestException(`This grievance is already ${status.replace("_", " ")}`);
    }
    if (!ALLOWED_TRANSITIONS[grievance.status].includes(status)) {
      const from = grievance.status.replace("_", " ");
      throw new BadRequestException(
        `${/^[AEIOU]/.test(from) ? "An" : "A"} ${from} grievance cannot be moved to ${status.replace("_", " ")}`,
      );
    }
    // A terminal decision has to say why — the submitter is told the outcome
    // and an unexplained "REJECTED" is not an answer.
    if ((status === "RESOLVED" || status === "REJECTED") && !resolutionNotes) {
      throw new BadRequestException(`A resolution note is required to mark a grievance ${status}`);
    }

    if (status === "RESOLVED") return this.resolve(id, resolutionNotes!, user);
    if (status === "REJECTED") return this.reject(id, resolutionNotes!, user);

    return this.prisma.grievance.update({
      where: { id },
      data: { status, ...(resolutionNotes ? { resolutionNotes } : {}) },
      include: GRIEVANCE_INCLUDE,
    });
  }

  async resolve(id: string, resolutionNotes: string, user: AuthenticatedUser) {
    const grievance = await this.assertCanDecide(id, user);
    const updated = await this.prisma.grievance.update({
      where: { id },
      data: { status: "RESOLVED", resolutionNotes, resolvedById: user.id, resolvedAt: new Date() },
      include: GRIEVANCE_INCLUDE,
    });

    await this.notificationsService.notify({
      userId: grievance.submittedById,
      type: "GRIEVANCE_RESOLVED",
      title: "Grievance resolved",
      message: resolutionNotes,
      relatedEntityType: "Grievance",
      relatedEntityId: id,
    });

    return updated;
  }

  async reject(id: string, resolutionNotes: string, user: AuthenticatedUser) {
    const grievance = await this.assertCanDecide(id, user);
    const updated = await this.prisma.grievance.update({
      where: { id },
      data: { status: "REJECTED", resolutionNotes, resolvedById: user.id, resolvedAt: new Date() },
      include: GRIEVANCE_INCLUDE,
    });

    // The submitter is told either way — a rejection they never hear about
    // reads to them as a grievance that was ignored.
    await this.notificationsService.notify({
      userId: grievance.submittedById,
      type: "GRIEVANCE_RESOLVED",
      title: "Grievance rejected",
      message: resolutionNotes,
      relatedEntityType: "Grievance",
      relatedEntityId: id,
    });

    return updated;
  }

  /** Super Admin only: deleting is how a decision gets erased, not made. */
  async remove(id: string, user: AuthenticatedUser) {
    if (user.role !== "SUPER_ADMIN") {
      throw new ForbiddenException("Only a Super Admin can delete a grievance");
    }
    const grievance = await this.prisma.grievance.findUnique({ where: { id } });
    if (!grievance) throw new NotFoundException("Grievance not found");
    await this.prisma.grievance.delete({ where: { id } });
    return { message: "Grievance deleted" };
  }

  /**
   * The single gate every decision passes through. Enforced here rather than
   * only on the controller so an internal caller can't route around it.
   */
  private async assertCanDecide(id: string, user: AuthenticatedUser) {
    if (user.role !== "SUPER_ADMIN") {
      throw new ForbiddenException("Only a Super Admin can manage grievances");
    }
    const grievance = await this.prisma.grievance.findUnique({ where: { id } });
    if (!grievance) throw new NotFoundException("Grievance not found");
    if (grievance.status === "RESOLVED" || grievance.status === "REJECTED") {
      throw new BadRequestException("Grievance has already been decided");
    }
    return grievance;
  }
}
