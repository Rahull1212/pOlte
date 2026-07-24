import { Injectable, NotFoundException } from "@nestjs/common";
import { RegionType } from "../shared-types";
import { PrismaService } from "../prisma/prisma.service";
import { isRegionWithinScope } from "../common/utils/region-scope.util";

@Injectable()
export class RegionsService {
  constructor(private readonly prisma: PrismaService) {}

  create(input: { name: string; type: RegionType; parentId?: string }) {
    return this.prisma.region.create({ data: input });
  }

  async findById(id: string) {
    const region = await this.prisma.region.findUnique({ where: { id } });
    if (!region) throw new NotFoundException("Region not found");
    return region;
  }

  children(parentId: string) {
    return this.prisma.region.findMany({ where: { parentId } });
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
