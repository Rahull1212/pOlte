import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { GrievanceStatus, SubmitGrievanceDto } from "../shared-types";
import { PrismaService } from "../prisma/prisma.service";
import { AuthenticatedUser } from "../auth/types";
import { RegionsService } from "../regions/regions.service";
import { NotificationsService } from "../notifications/notifications.service";

@Injectable()
export class GrievancesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly regionsService: RegionsService,
    private readonly notificationsService: NotificationsService,
  ) {}

  async submit(dto: SubmitGrievanceDto, user: AuthenticatedUser) {
    if (user.role !== "SUPER_ADMIN") {
      const withinScope = await this.regionsService.isWithinScope(user.regionId, dto.regionId);
      if (!withinScope) throw new ForbiddenException("Region is outside your area");
    }

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
        category: dto.category,
        description: dto.description,
        photos: dto.photos,
      },
    });

    // Notify the submitter's Admin (a Cadre's parentUserId is their Admin).
    const submitter = await this.prisma.user.findUnique({ where: { id: user.id } });
    if (submitter?.parentUserId) {
      await this.notificationsService.notify({
        userId: submitter.parentUserId,
        type: "GRIEVANCE_SUBMITTED",
        title: "New grievance submitted",
        message: citizen ? `${citizen.name}: ${dto.category}` : dto.category,
        relatedEntityType: "Grievance",
        relatedEntityId: grievance.id,
      });
    }

    return grievance;
  }

  async findMany(user: AuthenticatedUser, filters: { status?: GrievanceStatus; regionId?: string } = {}) {
    if (filters.regionId) {
      if (user.role !== "SUPER_ADMIN") {
        const withinScope = await this.regionsService.isWithinScope(user.regionId, filters.regionId);
        if (!withinScope) throw new ForbiddenException("Region is outside your area");
      }
      return this.prisma.grievance.findMany({
        where: { regionId: filters.regionId, status: filters.status },
        include: {
          citizen: true,
          region: { select: { name: true, type: true } },
          submittedBy: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: "desc" },
      });
    }

    const regionIds =
      user.role === "SUPER_ADMIN" ? undefined : await this.regionsService.descendantIds(user.regionId);

    return this.prisma.grievance.findMany({
      where: { regionId: regionIds ? { in: regionIds } : undefined, status: filters.status },
      include: {
        citizen: true,
        region: { select: { name: true, type: true } },
        submittedBy: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: "desc" },
    });
  }

  async resolve(id: string, resolutionNotes: string, user: AuthenticatedUser) {
    const grievance = await this.getForDecision(id, user);
    const updated = await this.prisma.grievance.update({
      where: { id },
      data: { status: "RESOLVED", resolutionNotes, resolvedById: user.id, resolvedAt: new Date() },
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
    await this.getForDecision(id, user);
    return this.prisma.grievance.update({
      where: { id },
      data: { status: "REJECTED", resolutionNotes, resolvedById: user.id, resolvedAt: new Date() },
    });
  }

  /** SUPER_ADMIN can delete any grievance; ADMIN only within their own area. */
  async remove(id: string, user: AuthenticatedUser) {
    const grievance = await this.prisma.grievance.findUnique({ where: { id } });
    if (!grievance) throw new NotFoundException("Grievance not found");
    if (user.role !== "SUPER_ADMIN") {
      const withinScope = await this.regionsService.isWithinScope(user.regionId, grievance.regionId);
      if (!withinScope) throw new ForbiddenException("Grievance is outside your area");
    }
    await this.prisma.grievance.delete({ where: { id } });
    return { message: "Grievance deleted" };
  }

  private async getForDecision(id: string, user: AuthenticatedUser) {
    const grievance = await this.prisma.grievance.findUnique({ where: { id } });
    if (!grievance) throw new NotFoundException("Grievance not found");
    if (grievance.status !== "OPEN" && grievance.status !== "IN_PROGRESS") {
      throw new BadRequestException("Grievance has already been decided");
    }
    if (user.role !== "SUPER_ADMIN") {
      const withinScope = await this.regionsService.isWithinScope(user.regionId, grievance.regionId);
      if (!withinScope) throw new ForbiddenException("Grievance is outside your area");
    }
    return grievance;
  }
}
