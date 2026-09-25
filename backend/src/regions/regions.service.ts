import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { RegionType } from "../shared-types";
import { PrismaService } from "../prisma/prisma.service";
import { isRegionWithinScope } from "../common/utils/region-scope.util";
import { AuthenticatedUser } from "../auth/types";

// The Election Commission's hierarchy, and only that: State -> District ->
// Assembly Constituency -> Polling Station. STATE has no entry: it's the
// root and can never have a parent.
const REQUIRED_PARENT_TYPE: Partial<Record<RegionType, RegionType>> = {
  DISTRICT: "STATE",
  CONSTITUENCY: "DISTRICT",
  BOOTH: "CONSTITUENCY",
};

/** "a District" but "an Assembly Constituency" — the messages read as prose. */
function withArticle(label: string) {
  return `${/^[AEIOU]/i.test(label) ? "an" : "a"} ${label}`;
}

function capitalize(text: string) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

const TYPE_LABEL: Record<RegionType, string> = {
  STATE: "State",
  DISTRICT: "District",
  CONSTITUENCY: "Assembly Constituency",
  BOOTH: "Polling Station",
};

@Injectable()
export class RegionsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Validates a (type, parentId) pair against the enforced hierarchy —
   * shared by create() and update() so an Assembly Constituency can never
   * end up under anything but a District, a Polling Station under anything
   * but an AC,
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
      throw new BadRequestException(`A parent area is required for ${withArticle(TYPE_LABEL[type])}`);
    }
    const parent = await this.prisma.region.findUnique({ where: { id: parentId } });
    if (!parent) throw new BadRequestException("Parent area not found");

    const requiredParentType = REQUIRED_PARENT_TYPE[type]!;
    if (parent.type !== requiredParentType) {
      throw new BadRequestException(
        `${capitalize(withArticle(TYPE_LABEL[type]))} must be created directly under ${withArticle(TYPE_LABEL[requiredParentType])} — "${parent.name}" is ${withArticle(TYPE_LABEL[parent.type])}`,
      );
    }
    return parent;
  }

  /**
   * Rejects a name or official number that already exists among the areas
   * sharing this parent. Scoped to the parent, never global: "Station 1"
   * legitimately exists under every Constituency, and every Constituency
   * numbers its polling stations from 1 — a global rule would make the
   * second Constituency unusable.
   *
   * Names compare case-insensitively, so "Station 2" and "station 2" collide;
   * they're the same place to anyone reading the tree.
   *
   * `excludeId` lets an update ignore the row being edited, so saving an
   * area without changing its name isn't a conflict with itself.
   */
  private async assertNoDuplicateUnderParent(
    parentId: string | null | undefined,
    name: string | undefined,
    number: string | null | undefined,
    excludeId?: string,
  ) {
    const siblings = await this.prisma.region.findMany({
      where: { parentId: parentId ?? null, ...(excludeId ? { id: { not: excludeId } } : {}) },
      select: { name: true, number: true },
    });

    if (name) {
      const clash = siblings.find((s) => s.name.trim().toLowerCase() === name.trim().toLowerCase());
      if (clash) {
        throw new BadRequestException(`An area named "${clash.name}" already exists under the same parent area`);
      }
    }
    if (number) {
      const clash = siblings.find((s) => s.number && s.number.trim().toLowerCase() === number.trim().toLowerCase());
      if (clash) {
        throw new BadRequestException(
          `Polling Station number "${clash.number}" is already used under the same parent area`,
        );
      }
    }
  }

  /**
   * SUPER_ADMIN can create any area anywhere in the hierarchy. ADMIN is
   * limited to adding Polling Stations under a Constituency within their
   * own region subtree — they can't create new Districts/Constituencies or
   * reach outside their own area. Every role is bound by the same
   * State->District->Constituency->Polling Station parent-type rule via
   * assertValidParent().
   */
  async create(
    input: { name: string; type: RegionType; parentId?: string; number?: string },
    creator: AuthenticatedUser,
  ) {
    if (creator.role === "ADMIN" && input.type !== "BOOTH") {
      throw new ForbiddenException("Admins can only add Polling Stations");
    }

    await this.assertValidParent(input.type, input.parentId);
    await this.assertNoDuplicateUnderParent(input.parentId, input.name, input.number);

    if (creator.role === "ADMIN") {
      const withinScope = await isRegionWithinScope(this.prisma, creator.regionId, input.parentId!);
      if (!withinScope) {
        throw new ForbiddenException("That Constituency is outside your area");
      }
    }

    return this.prisma.region.create({
      data: {
        name: input.name.trim(),
        type: input.type,
        parentId: input.parentId,
        // Constituencies carry their AC number and Polling Stations their
        // station number; an empty string is stored as null so the duplicate
        // check doesn't treat "" as a used number.
        number: input.type === "BOOTH" || input.type === "CONSTITUENCY" ? input.number?.trim() || null : null,
      },
    });
  }

  async findById(id: string) {
    const region = await this.prisma.region.findUnique({ where: { id } });
    if (!region) throw new NotFoundException("Region not found");
    return region;
  }

  /**
   * findById, but only for an area the caller may see: a Super Admin sees
   * everything, an Admin only their own region and its descendants — the
   * same scope GET /regions already applies to the list.
   *
   * Out-of-scope reports "not found" rather than "forbidden", so the
   * endpoint can't be used to probe which area ids exist.
   */
  async findByIdInScope(id: string, user: AuthenticatedUser) {
    const region = await this.findById(id);
    if (user.role === "SUPER_ADMIN") return region;

    const scoped = await this.descendantIds(user.regionId);
    if (!scoped.includes(id)) throw new NotFoundException("Region not found");
    return region;
  }

  /**
   * SUPER_ADMIN can rename or move any area. ADMIN can only rename (never
   * move) a Polling Station within their own region subtree — same
   * restriction shape as create()/remove().
   */
  async update(
    id: string,
    data: { name?: string; parentId?: string; type?: RegionType; number?: string },
    updater: AuthenticatedUser,
  ) {
    const region = await this.findById(id);

    if (updater.role === "ADMIN") {
      if (region.type !== "BOOTH") {
        throw new ForbiddenException("Admins can only rename Polling Stations");
      }
      if (data.parentId !== undefined) {
        throw new ForbiddenException("Admins cannot move areas");
      }
      if (data.type !== undefined && data.type !== region.type) {
        throw new ForbiddenException("Admins cannot change an area's type");
      }
      const withinScope = await isRegionWithinScope(this.prisma, updater.regionId, id);
      if (!withinScope) {
        throw new ForbiddenException("That Polling Station is outside your area");
      }
    }

    // The type an area will have after this update — a change of type and a
    // change of parent are validated together, because each only makes sense
    // against the other (a Constituency moved under a State is invalid; the
    // same move is correct if it's becoming a District at the same time).
    const nextType = data.type ?? region.type;
    const typeChanged = nextType !== region.type;
    const parentChanged = data.parentId !== undefined && (data.parentId || null) !== region.parentId;

    if (parentChanged) {
      if (data.parentId === id) {
        throw new BadRequestException("An area cannot be its own parent");
      }
      if (data.parentId) {
        const descendants = await this.descendantIds(id);
        if (descendants.includes(data.parentId)) {
          throw new BadRequestException("Cannot move an area under its own descendant");
        }
      }
    }

    if (parentChanged || typeChanged) {
      // Whether moving, retyping or both, the result must satisfy the same
      // State->District->Constituency->Polling Station rule create()
      // enforces — otherwise either operation would be a backdoor around it.
      const nextParentId = data.parentId !== undefined ? data.parentId : (region.parentId ?? undefined);
      await this.assertValidParent(nextType, nextParentId);
    }

    if (typeChanged) {
      // An area's children are bound to its type just as it is to its
      // parent's. Retyping a Constituency to a District would strand its
      // Polling Stations under something that can't hold them, so it's
      // refused rather than silently leaving the tree invalid.
      const children = await this.prisma.region.findMany({ where: { parentId: id }, select: { type: true } });
      const offending = children.find((c) => REQUIRED_PARENT_TYPE[c.type] !== nextType);
      if (offending) {
        throw new BadRequestException(
          `This area holds ${TYPE_LABEL[offending.type]} areas, which must sit under ${withArticle(TYPE_LABEL[REQUIRED_PARENT_TYPE[offending.type]!])} — move or delete them before changing it to ${withArticle(TYPE_LABEL[nextType])}`,
        );
      }
      if (nextType !== "BOOTH" && nextType !== "CONSTITUENCY" && region.number) {
        // An official number is meaningless on a State or District; drop it
        // rather than leave a stale value behind.
        data.number = undefined;
      }
    }

    // Checked against the parent it will have after this update, not the one
    // it has now.
    const finalParentId = data.parentId !== undefined ? data.parentId : region.parentId;
    if (data.name !== undefined || data.number !== undefined || parentChanged) {
      await this.assertNoDuplicateUnderParent(finalParentId, data.name ?? region.name, data.number ?? region.number, id);
    }

    return this.prisma.region.update({
      where: { id },
      data: {
        ...(data.name !== undefined ? { name: data.name.trim() } : {}),
        ...(data.parentId !== undefined ? { parentId: data.parentId || null } : {}),
        ...(data.type !== undefined ? { type: data.type } : {}),
        ...(data.number !== undefined ? { number: data.number?.trim() || null } : {}),
        ...(typeChanged && nextType !== "BOOTH" && nextType !== "CONSTITUENCY" ? { number: null } : {}),
      },
    });
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
   * SUPER_ADMIN can delete any area; ADMIN is limited to Polling Stations
   * within their own region subtree (mirrors the restriction on create()).
   */
  async remove(id: string, remover: AuthenticatedUser) {
    const region = await this.findById(id);

    if (remover.role === "ADMIN") {
      if (region.type !== "BOOTH") {
        throw new ForbiddenException("Admins can only delete Polling Stations");
      }
      const withinScope = await isRegionWithinScope(this.prisma, remover.regionId, id);
      if (!withinScope) {
        throw new ForbiddenException("That Polling Station is outside your area");
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

  /**
   * Every active Admin responsible for the given areas.
   *
   * Responsibility runs both ways down the tree: an Admin whose own area
   * sits inside a target covers it (a Constituency Admin under a targeted
   * District), and so does an Admin whose area CONTAINS a target (a
   * District Admin when a single Polling Station is targeted). Matching
   * only one direction would miss half the people who actually own the
   * work.
   *
   * Shared by TasksService (routing a task batch) and CampaignsService
   * (assigning a campaign by area) so both answer "who covers this?"
   * identically.
   */
  async adminsCovering(targetRegionIds: string[]): Promise<{ id: string }[]> {
    if (targetRegionIds.length === 0) return [];

    const admins = await this.prisma.user.findMany({
      where: { role: "ADMIN", isActive: true },
      select: { id: true, regionId: true },
    });

    const targetScope = new Set((await Promise.all(targetRegionIds.map((id) => this.descendantIds(id)))).flat());

    const matches: { id: string }[] = [];
    for (const admin of admins) {
      if (targetScope.has(admin.regionId)) {
        matches.push({ id: admin.id });
        continue;
      }
      const adminDescendants = await this.descendantIds(admin.regionId);
      if (targetRegionIds.some((t) => adminDescendants.includes(t))) {
        matches.push({ id: admin.id });
      }
    }
    return matches;
  }

  isWithinScope(scopeRegionId: string, targetRegionId: string) {
    return isRegionWithinScope(this.prisma, scopeRegionId, targetRegionId);
  }
}
