import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import * as bcrypt from "bcrypt";
import { Role, UpdateUserDto } from "../shared-types";
import { PrismaService } from "../prisma/prisma.service";
import { AuthenticatedUser } from "../auth/types";
import { RegionsService } from "../regions/regions.service";

export interface CreateUserInput {
  name: string;
  phone: string;
  email?: string;
  password: string;
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

    const passwordHash = await bcrypt.hash(input.password, 10);
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
