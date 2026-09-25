import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { RegisterCitizenDto } from "../shared-types";
import { PrismaService } from "../prisma/prisma.service";
import { AuthenticatedUser } from "../auth/types";
import { RegionsService } from "../regions/regions.service";

@Injectable()
export class CitizensService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly regionsService: RegionsService,
  ) {}

  /**
   * Citizens are data records only — they never log in. A Cadre registers
   * one within their own booth by default; an Admin/Super Admin may specify
   * any regionId within their own area.
   */
  async register(dto: RegisterCitizenDto, user: AuthenticatedUser) {
    let regionId = dto.regionId ?? user.regionId;

    if (user.role !== "SUPER_ADMIN") {
      const withinScope = await this.regionsService.isWithinScope(user.regionId, regionId);
      if (!withinScope) {
        throw new ForbiddenException("You can only register citizens within your own area");
      }
    }

    return this.prisma.citizen.create({
      data: {
        name: dto.name,
        phone: dto.phone,
        address: dto.address,
        regionId,
        registeredById: user.id,
      },
    });
  }

  async findMany(user: AuthenticatedUser, filters: { regionId?: string } = {}) {
    if (filters.regionId) {
      if (user.role !== "SUPER_ADMIN") {
        const withinScope = await this.regionsService.isWithinScope(user.regionId, filters.regionId);
        if (!withinScope) throw new ForbiddenException("Region is outside your area");
      }
      return this.prisma.citizen.findMany({
        where: { regionId: filters.regionId },
        orderBy: { createdAt: "desc" },
      });
    }

    if (user.role === "SUPER_ADMIN") {
      return this.prisma.citizen.findMany({ orderBy: { createdAt: "desc" } });
    }

    const regionIds = await this.regionsService.descendantIds(user.regionId);
    return this.prisma.citizen.findMany({
      where: { regionId: { in: regionIds } },
      orderBy: { createdAt: "desc" },
    });
  }

  /**
   * Scoped like findMany above. Without `user` this returned any citizen's
   * record — name, phone, address and their grievance history — to any
   * authenticated caller, which quietly undid the region scoping the list
   * endpoint takes care to apply.
   *
   * Out of scope reports "not found" rather than "forbidden": a 403 would
   * confirm the record exists, which is itself information about a private
   * individual.
   */
  async findById(id: string, user: AuthenticatedUser) {
    const citizen = await this.prisma.citizen.findUnique({
      where: { id },
      include: { grievances: { orderBy: { createdAt: "desc" } } },
    });
    if (!citizen) throw new NotFoundException("Citizen not found");
    if (user.role === "SUPER_ADMIN") return citizen;

    const scoped = await this.regionsService.descendantIds(user.regionId);
    if (!scoped.includes(citizen.regionId)) throw new NotFoundException("Citizen not found");
    return citizen;
  }
}
