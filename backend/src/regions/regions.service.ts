import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { RegionType } from "../shared-types";
import { PrismaService } from "../prisma/prisma.service";
import { isRegionWithinScope } from "../common/utils/region-scope.util";
import { AuthenticatedUser } from "../auth/types";

// The enforced hierarchy is State -> District -> Mandal -> Booth. Mandal's
// required parent is District (not Constituency) even though the
// RegionType enum still has a CONSTITUENCY level for legacy/future use —
// no real data uses it, and every rule the product defines skips straight
// from District to Mandal. STATE has no entry: it's the root and can never
// have a parent.
const REQUIRED_PARENT_TYPE: Partial<Record<RegionType, RegionType>> = {
  DISTRICT: "STATE",
  CONSTITUENCY: "DISTRICT",
  MANDAL: "DISTRICT",
  BOOTH: "MANDAL",
};

const TYPE_LABEL: Record<RegionType, string> = {
  STATE: "State",
  DISTRICT: "District",
  CONSTITUENCY: "Constituency",
  MANDAL: "Mandal",
  BOOTH: "Booth",
};

@Injectable()
export class RegionsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Validates a (type, parentId) pair against the enforced hierarchy —
   * shared by create() and update() so a Mandal can never end up under
   * anything but a District, a Booth under anything but a Mandal, etc.,
   * regardless of role. Returns the parent region so callers that also need
   * it (e.g. for a scope check) don't have to re-fetch it.
   */
  private async assertValidParent(type: RegionType, parentId: string | undefined) {
    if (type === "STATE") {
      if (parentId) {
        throw new BadRequestException("A State is the root of the hierarchy and cannot have a parent area");
      }
      return null;
    }

    if (!parentId) {
      throw new BadRequestException(`A parent area is required for a ${TYPE_LABEL[type]}`);
    }
    const parent = await this.prisma.region.findUnique({ where: { id: parentId } });
    if (!parent) throw new BadRequestException("Parent area not found");

    const requiredParentType = REQUIRED_PARENT_TYPE[type]!;
    if (parent.type !== requiredParentType) {
      throw new BadRequestException(
        `A ${TYPE_LABEL[type]} must be created directly under a ${TYPE_LABEL[requiredParentType]} — "${parent.name}" is a ${TYPE_LABEL[parent.type]}`,
      );
    }
    return parent;
  }

  /**
   * SUPER_ADMIN can create any area anywhere in the hierarchy. ADMIN is
   * limited to adding Booths under a Mandal within their own region subtree
   * — they can't create new Districts/Mandals or reach outside their own
   * area. Every role is bound by the same State->District->Mandal->Booth
   * parent-type rule via assertValidParent().
   */
  async create(input: { name: string; type: RegionType; parentId?: string }, creator: AuthenticatedUser) {
    if (creator.role === "ADMIN" && input.type !== "BOOTH") {
      throw new ForbiddenException("Admins can only add Booths");
    }

    await this.assertValidParent(input.type, input.parentId);

    if (creator.role === "ADMIN") {
      const withinScope = await isRegionWithinScope(this.prisma, creator.regionId, input.parentId!);
      if (!withinScope) {
        throw new ForbiddenException("That Mandal is outside your area");
      }
    }

    return this.prisma.region.create({ data: input });
  }

  async findById(id: string) {
    const region = await this.prisma.region.findUnique({ where: { id } });
    if (!region) throw new NotFoundException("Region not found");
    return region;
  }

  /**
   * SUPER_ADMIN can rename or move any area. ADMIN can only rename (never
   * move) a Booth within their own region subtree — same restriction shape
   * as create()/remove().
   */
  async update(id: string, data: { name?: string; parentId?: string }, updater: AuthenticatedUser) {
    const region = await this.findById(id);

    if (updater.role === "ADMIN") {
      if (region.type !== "BOOTH") {
        throw new ForbiddenException("Admins can only rename Booths");
      }
      if (data.parentId !== undefined) {
        throw new ForbiddenException("Admins cannot move areas");
      }
      const withinScope = await isRegionWithinScope(this.prisma, updater.regionId, id);
      if (!withinScope) {
        throw new ForbiddenException("That Booth is outside your area");
      }
    }

    if (data.parentId !== undefined) {
      if (data.parentId === id) {
        throw new BadRequestException("An area cannot be its own parent");
      }
      if (data.parentId) {
        const descendants = await this.descendantIds(id);
        if (descendants.includes(data.parentId)) {
          throw new BadRequestException("Cannot move an area under its own descendant");
        }
      }
      // A move keeps the region's existing type, so the new parent must
      // satisfy the exact same State->District->Mandal->Booth rule create()
      // does (including rejecting an empty/missing parentId for anything
      // but a State) — otherwise moving would be a backdoor around it.
      await this.assertValidParent(region.type, data.parentId);
    }

    return this.prisma.region.update({ where: { id }, data });
  }

  children(parentId: string) {
    return this.prisma.region.findMany({ where: { parentId } });
  }

  /**
   * Refuses to delete anything still in use — a region with sub-areas, or
   * with users/citizens/grievances/events/allocations pointing at it —
   * rather than cascading, since a cascade here would silently orphan or
   * wipe out real operational data (accounts, citizen records, campaign
   * allocations). Callers must clear those out (or reassign them) first.
   *
   * SUPER_ADMIN can delete any area; ADMIN is limited to Booths within
   * their own region subtree (mirrors the restriction on create()).
   */
  async remove(id: string, remover: AuthenticatedUser) {
    const region = await this.findById(id);

    if (remover.role === "ADMIN") {
      if (region.type !== "BOOTH") {
        throw new ForbiddenException("Admins can only delete Booths");
      }
      const withinScope = await isRegionWithinScope(this.prisma, remover.regionId, id);
      if (!withinScope) {
        throw new ForbiddenException("That Booth is outside your area");
      }
    }

    const childCount = await this.prisma.region.count({ where: { parentId: id } });
    if (childCount > 0) {
      throw new BadRequestException(
        `Cannot delete: this area has ${childCount} sub-area(s). Delete those first.`,
      );
    }

    const [users, citizens, grievances, events, allocations] = await Promise.all([
      this.prisma.user.count({ where: { regionId: id } }),
      this.prisma.citizen.count({ where: { regionId: id } }),
      this.prisma.grievance.count({ where: { regionId: id } }),
      this.prisma.event.count({ where: { regionId: id } }),
      this.prisma.targetAllocation.count({ where: { regionId: id } }),
    ]);

    const blockers: string[] = [];
    if (users > 0) blockers.push(`${users} user(s)`);
    if (citizens > 0) blockers.push(`${citizens} citizen(s)`);
    if (grievances > 0) blockers.push(`${grievances} grievance(s)`);
    if (events > 0) blockers.push(`${events} event(s)`);
    if (allocations > 0) blockers.push(`${allocations} campaign allocation(s)`);

    if (blockers.length > 0) {
      throw new BadRequestException(`Cannot delete: this area still has ${blockers.join(", ")} assigned to it.`);
    }

    return this.prisma.region.delete({ where: { id } });
  }

  /** Flat list for area pickers: Super Admin sees everything, Admin sees their own subtree. */
  async findAllInScope(scopeRegionId?: string) {
    if (!scopeRegionId) {
      return this.prisma.region.findMany({ orderBy: { name: "asc" } });
    }
    const ids = await this.descendantIds(scopeRegionId);
    return this.prisma.region.findMany({ where: { id: { in: ids } }, orderBy: { name: "asc" } });
  }

  /** Full subtree under a region, flattened — useful for scoping dashboard queries. */
  async descendantIds(regionId: string): Promise<string[]> {
    const ids: string[] = [regionId];
    const queue = [regionId];
    while (queue.length) {
      const current = queue.shift()!;
      const children = await this.prisma.region.findMany({
        where: { parentId: current },
        select: { id: true },
      });
      for (const child of children) {
        ids.push(child.id);
        queue.push(child.id);
      }
    }
    return ids;
  }

  isWithinScope(scopeRegionId: string, targetRegionId: string) {
    return isRegionWithinScope(this.prisma, scopeRegionId, targetRegionId);
  }
}
