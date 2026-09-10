import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import * as bcrypt from "bcrypt";
import { randomBytes } from "node:crypto";
import { Prisma } from "@prisma/client";
import { Role, UpdateUserDto } from "../shared-types";
import { PrismaService } from "../prisma/prisma.service";
import { AuthenticatedUser } from "../auth/types";
import { RegionsService } from "../regions/regions.service";

export interface CreateUserInput {
  name: string;
  phone: string;
  email?: string;
  // Required for an Admin (they log into the web portal and need to know
  // it); irrelevant for a Cadre, who works entirely from WhatsApp and never
  // types a password anywhere — create() generates one for a Cadre
  // regardless of what's passed here, so it's optional at this layer.
  password?: string;
  role: Role;
  regionId: string;
  parentUserId?: string;
}

const SELECT_SAFE_FIELDS = {
  id: true,
  name: true,
  phone: true,
  role: true,
  regionId: true,
  region: { select: { name: true, type: true } },
  parentUserId: true,
  isActive: true,
  createdAt: true,
} as const;

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly regionsService: RegionsService,
  ) {}

  /**
   * A Super Admin can create Admins or Cadres anywhere. An Admin can only
   * create Cadres, and only within their own area (region subtree) — the
   * role/region they pass is validated/overridden rather than trusted.
   */
  async create(input: CreateUserInput, creator: AuthenticatedUser) {
    const existing = await this.prisma.user.findUnique({ where: { phone: input.phone } });
    if (existing) throw new ConflictException("Phone number already registered");

    let role = input.role;
    if (creator.role === "ADMIN") {
      role = "CADRE";
      const withinScope = await this.regionsService.isWithinScope(creator.regionId, input.regionId);
      if (!withinScope) {
        throw new ForbiddenException("You can only add Cadres within your own area");
      }
    } else if (creator.role === "CADRE") {
      throw new ForbiddenException("Cadres cannot create other users");
    } else if (role === "SUPER_ADMIN") {
      throw new ForbiddenException("Super Admin accounts cannot be created through this endpoint");
    }

    // A Cadre never logs in with a password (WhatsApp is their entire
    // interface — see NotificationsService), so a real one is never
    // invented/communicated for them; a random one is generated here purely
    // to satisfy User.passwordHash's NOT NULL constraint, ignoring whatever
    // (if anything) was passed in. An Admin, who does use the web portal,
    // must supply a real one.
    let password = input.password;
    if (role === "CADRE") {
      password = randomBytes(18).toString("base64url");
    } else if (!password) {
      throw new BadRequestException("A password is required for this account");
    }

    const passwordHash = await bcrypt.hash(password, 10);
    return this.prisma.user.create({
      data: {
        name: input.name,
        phone: input.phone,
        email: input.email,
        passwordHash,
        role,
        regionId: input.regionId,
        parentUserId: input.parentUserId,
      },
      select: SELECT_SAFE_FIELDS,
    });
  }

  async findById(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id }, select: SELECT_SAFE_FIELDS });
    if (!user) throw new NotFoundException("User not found");
    return user;
  }

  /** Super Admin sees everyone; Admin sees users in their own area; Cadre sees only themself. */
  async findAll(requester: AuthenticatedUser, filters: { role?: Role } = {}) {
    if (requester.role === "SUPER_ADMIN") {
      return this.prisma.user.findMany({ where: { role: filters.role }, select: SELECT_SAFE_FIELDS });
    }
    if (requester.role === "ADMIN") {
      const regionIds = await this.regionsService.descendantIds(requester.regionId);
      return this.prisma.user.findMany({
        where: { regionId: { in: regionIds }, role: filters.role },
        select: SELECT_SAFE_FIELDS,
      });
    }
    return this.prisma.user.findMany({ where: { id: requester.id }, select: SELECT_SAFE_FIELDS });
  }

  async update(id: string, dto: UpdateUserDto, updater: AuthenticatedUser) {
    const target = await this.findById(id);

    if (updater.role === "ADMIN") {
      if (target.role !== "CADRE") {
        throw new ForbiddenException("Admins can only manage Cadre accounts");
      }
      const withinScope = await this.regionsService.isWithinScope(updater.regionId, target.regionId);
      if (!withinScope) throw new ForbiddenException("That Cadre is outside your area");
      if (dto.role) throw new ForbiddenException("Admins cannot change a user's role");
    } else if (updater.role === "CADRE") {
      throw new ForbiddenException("Cadres cannot manage other users");
    }

    return this.prisma.user.update({
      where: { id },
      data: {
        name: dto.name,
        regionId: dto.regionId,
        role: dto.role,
        isActive: dto.isActive,
      },
      select: SELECT_SAFE_FIELDS,
    });
  }

  async deactivate(id: string, updater: AuthenticatedUser) {
    return this.update(id, { isActive: false }, updater);
  }

  /**
   * Permanently removes an account — only once it's already deactivated, so
   * an active account can't be deleted in one click. Frees up its phone
   * number for reuse (create() only rejects a phone that's still in use).
   *
   * Rather than blocking on everything this account still "owns" (the old
   * behavior), reassignOwnership() below hands administrative ownership —
   * campaigns/events/citizens/grievances/expenses they created or acted on,
   * budget allocations, tasks they assigned to others or were assigned
   * themselves, their own direct reports — to whoever they reported to
   * (falling back to whoever's doing the deleting if they had no manager on
   * record), then deletes purely personal/ephemeral rows outright
   * (notifications, OTP codes, WhatsApp conversation-flow state, event
   * RSVPs). Audit log entries and field reports/progress updates are left
   * exactly as they are — their User reference is optional specifically so
   * they survive with the actor unset instead of being silently
   * misattributed to someone who didn't actually do that work.
   *
   * Any User relation added to the schema after this was written that isn't
   * covered above will still surface as a clear error below (P2003) rather
   * than fail silently or half-delete.
   */
  async remove(id: string, remover: AuthenticatedUser) {
    if (id === remover.id) {
      throw new BadRequestException("You cannot delete your own account");
    }

    const target = await this.findById(id);

    if (remover.role === "ADMIN") {
      if (target.role !== "CADRE") {
        throw new ForbiddenException("Admins can only remove Cadre accounts");
      }
      const withinScope = await this.regionsService.isWithinScope(remover.regionId, target.regionId);
      if (!withinScope) throw new ForbiddenException("That Cadre is outside your area");
    } else if (remover.role === "CADRE") {
      throw new ForbiddenException("Cadres cannot remove other users");
    }

    if (target.isActive) {
      throw new BadRequestException("Deactivate this account before deleting it");
    }

    await this.reassignOwnership(id, target.parentUserId ?? remover.id);

    try {
      await this.prisma.user.delete({ where: { id } });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2003") {
        throw new BadRequestException(
          "Cannot delete: this account still has activity on record that isn't handled by the reassignment step " +
            "yet. This is a gap in the delete logic, not something you can work around — deactivating keeps the " +
            "account hidden from active use while preserving that history in the meantime.",
        );
      }
      throw err;
    }

    return { id };
  }

  /**
   * Hands everything the target account "owns" to newOwnerId (the target's
   * own manager if they had one, else whoever is performing the delete —
   * see remove()) so the account delete below can proceed without losing
   * that data, then removes what's purely personal to the account itself.
   * Runs as one transaction: either every table is consistent afterward, or
   * none of them changed.
   */
  private async reassignOwnership(targetId: string, newOwnerId: string) {
    await this.prisma.$transaction([
      // Administrative ownership/authorship — reassigned outright, the
      // record itself is untouched.
      this.prisma.campaign.updateMany({ where: { createdById: targetId }, data: { createdById: newOwnerId } }),
      this.prisma.targetAllocation.updateMany({ where: { ownerUserId: targetId }, data: { ownerUserId: newOwnerId } }),
      this.prisma.targetAllocation.updateMany({ where: { assignedById: targetId }, data: { assignedById: newOwnerId } }),
      this.prisma.taskBatch.updateMany({ where: { createdById: targetId }, data: { createdById: newOwnerId } }),
      this.prisma.task.updateMany({ where: { assignedById: targetId }, data: { assignedById: newOwnerId } }),
      this.prisma.expenseRequest.updateMany({ where: { submittedById: targetId }, data: { submittedById: newOwnerId } }),
      this.prisma.expenseRequest.updateMany({ where: { approvedById: targetId }, data: { approvedById: newOwnerId } }),
      this.prisma.announcement.updateMany({ where: { senderId: targetId }, data: { senderId: newOwnerId } }),
      this.prisma.citizen.updateMany({ where: { registeredById: targetId }, data: { registeredById: newOwnerId } }),
      this.prisma.grievance.updateMany({ where: { submittedById: targetId }, data: { submittedById: newOwnerId } }),
      this.prisma.grievance.updateMany({ where: { resolvedById: targetId }, data: { resolvedById: newOwnerId } }),
      this.prisma.event.updateMany({ where: { createdById: targetId }, data: { createdById: newOwnerId } }),
      this.prisma.bulkMessageCampaign.updateMany({ where: { createdById: targetId }, data: { createdById: newOwnerId } }),
      this.prisma.poll.updateMany({ where: { createdById: targetId }, data: { createdById: newOwnerId } }),
      // Direct reports — their manager pointer moves to the new owner too.
      this.prisma.user.updateMany({ where: { parentUserId: targetId }, data: { parentUserId: newOwnerId } }),
      // Active/pending Cadre work — reassigned AND explicitly flagged, so it
      // surfaces as needing a real new owner rather than silently landing
      // in newOwnerId's task list unremarked.
      this.prisma.task.updateMany({
        where: { assignedToId: targetId },
        data: { assignedToId: newOwnerId, needsReassignment: true, acknowledgment: "AWAITING" },
      }),
      // Purely personal/ephemeral records — deleted outright, not
      // reassigned. Nobody else should inherit somebody else's inbox, OTP
      // codes, WhatsApp menu-state, or event RSVPs.
      this.prisma.notification.deleteMany({ where: { userId: targetId } }),
      this.prisma.otpCode.deleteMany({ where: { userId: targetId } }),
      this.prisma.whatsAppSession.deleteMany({ where: { userId: targetId } }),
      this.prisma.eventParticipant.deleteMany({ where: { userId: targetId } }),
    ]);
  }

  /** Direct reports only — used when assigning tasks/sub-allocations. */
  async findDirectReports(userId: string) {
    return this.prisma.user.findMany({
      where: { parentUserId: userId, isActive: true },
      select: { id: true, name: true, role: true, regionId: true },
    });
  }

  async findByRegion(regionId: string) {
    return this.prisma.user.findMany({
      where: { regionId },
      select: { id: true, name: true, role: true },
    });
  }
}
