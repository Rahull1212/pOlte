import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { CreateAllocationDto, SubAllocateDto } from "../shared-types";
import { PrismaService } from "../prisma/prisma.service";
import { AuthenticatedUser } from "../auth/types";
import { RegionsService } from "../regions/regions.service";
import { NotificationsService } from "../notifications/notifications.service";

@Injectable()
export class AllocationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly regionsService: RegionsService,
    private readonly notificationsService: NotificationsService,
  ) {}

  /** Root allocation: State Admin assigns a target+budget straight to a District (etc). */
  async createRoot(campaignId: string, dto: CreateAllocationDto, user: AuthenticatedUser) {
    const campaign = await this.prisma.campaign.findUnique({ where: { id: campaignId } });
    if (!campaign) throw new NotFoundException("Campaign not found");

    const existingRoots = await this.prisma.targetAllocation.findMany({
      where: { campaignId, parentAllocationId: null },
      select: { target: true, allocatedBudget: true },
    });
    const allocatedTarget = existingRoots.reduce((s, a) => s + a.target, 0);
    const allocatedBudget = existingRoots.reduce((s, a) => s + Number(a.allocatedBudget), 0);

    // A campaign need not declare an overall target or budget — the create
    // form no longer asks for them. Where one IS declared it still caps what
    // can be handed out; where it isn't, there is nothing to exceed and the
    // per-area allocations are the whole plan.
    if (campaign.totalTarget !== null && allocatedTarget + dto.target > campaign.totalTarget) {
      throw new BadRequestException("Allocation exceeds the campaign's total target");
    }
    if (
      campaign.totalBudget !== null &&
      allocatedBudget + dto.allocatedBudget > Number(campaign.totalBudget)
    ) {
      throw new BadRequestException("Allocation exceeds the campaign's total budget");
    }

    const allocation = await this.prisma.targetAllocation.create({
      data: {
        campaignId,
        regionId: dto.regionId,
        ownerUserId: dto.ownerUserId,
        assignedById: user.id,
        target: dto.target,
        allocatedBudget: dto.allocatedBudget,
        deadline: dto.deadline,
        notes: dto.notes,
      },
    });

    await this.notifyAreaCadres(dto.regionId, campaign.name, dto.target, dto.deadline);
    return allocation;
  }

  /**
   * A District/Constituency/Booth Head splits their own allocation among their
   * direct reports' regions. Only the current owner of the parent row (or a
   * State Admin) may perform the split, and the sum of children can never
   * exceed what the parent itself was given.
   */
  async subAllocate(dto: SubAllocateDto, user: AuthenticatedUser) {
    const parent = await this.prisma.targetAllocation.findUnique({
      where: { id: dto.parentAllocationId },
      include: { childAllocations: true },
    });
    if (!parent) throw new NotFoundException("Parent allocation not found");

    if (parent.ownerUserId !== user.id && user.role !== "SUPER_ADMIN") {
      throw new ForbiddenException("Only the allocation owner can sub-allocate it");
    }

    const alreadySplitTarget = parent.childAllocations.reduce((s, a) => s + a.target, 0);
    const alreadySplitBudget = parent.childAllocations.reduce((s, a) => s + Number(a.allocatedBudget), 0);
    const newTarget = dto.splits.reduce((s, a) => s + a.target, 0);
    const newBudget = dto.splits.reduce((s, a) => s + a.allocatedBudget, 0);

    if (alreadySplitTarget + newTarget > parent.target) {
      throw new BadRequestException("Split exceeds the remaining unallocated target");
    }
    if (alreadySplitBudget + newBudget > Number(parent.allocatedBudget)) {
      throw new BadRequestException("Split exceeds the remaining unallocated budget");
    }

    const created = await this.prisma.$transaction(
      dto.splits.map((split) =>
        this.prisma.targetAllocation.create({
          data: {
            campaignId: parent.campaignId,
            regionId: split.regionId,
            ownerUserId: split.ownerUserId,
            assignedById: user.id,
            parentAllocationId: parent.id,
            target: split.target,
            allocatedBudget: split.allocatedBudget,
            deadline: split.deadline,
            notes: split.notes,
          },
        }),
      ),
    );

    const campaign = await this.prisma.campaign.findUnique({ where: { id: parent.campaignId } });
    await Promise.all(
      dto.splits.map((split) =>
        this.notifyAreaCadres(split.regionId, campaign?.name ?? "a campaign", split.target, split.deadline),
      ),
    );

    return created;
  }

  /**
   * Every Cadre within (or under) the region a target lands on gets a
   * WhatsApp/notification heads-up that their area now has campaign work —
   * this is separate from Task assignment, which tells one specific Cadre
   * about one specific piece of work once an Admin/Booth President hands it
   * out.
   */
  private async notifyAreaCadres(regionId: string, campaignName: string, target: number, deadline: Date) {
    const regionIds = await this.regionsService.descendantIds(regionId);
    const cadres = await this.prisma.user.findMany({
      where: { regionId: { in: regionIds }, role: "CADRE", isActive: true },
      select: { id: true },
    });
    if (cadres.length === 0) return;

    await this.notificationsService.notifyMany(
      cadres.map((c) => c.id),
      {
        type: "NEW_CAMPAIGN",
        title: `New campaign target: ${campaignName}`,
        message: `Your area has been allocated a target of ${target}, due ${new Date(deadline).toDateString()}.`,
        relatedEntityType: "Campaign",
      },
    );
  }

  async approveBudget(allocationId: string, approvedBudget: number) {
    const allocation = await this.prisma.targetAllocation.findUnique({ where: { id: allocationId } });
    if (!allocation) throw new NotFoundException("Allocation not found");
    if (approvedBudget > Number(allocation.allocatedBudget)) {
      throw new BadRequestException("Approved budget cannot exceed allocated budget");
    }
    return this.prisma.targetAllocation.update({
      where: { id: allocationId },
      data: { approvedBudget },
    });
  }

  /** Full hierarchy tree for a campaign, State -> ... -> Booth, nested. */
  async tree(campaignId: string) {
    const all = await this.prisma.targetAllocation.findMany({
      where: { campaignId },
      include: { region: true, ownerUser: { select: { id: true, name: true, role: true } } },
    });

    const byParent = new Map<string | null, typeof all>();
    for (const allocation of all) {
      const key = allocation.parentAllocationId;
      if (!byParent.has(key)) byParent.set(key, [] as any);
      byParent.get(key)!.push(allocation);
    }

    const build = (parentId: string | null): any[] =>
      (byParent.get(parentId) ?? []).map((allocation) => ({
        ...allocation,
        remainingBudget: Number(allocation.allocatedBudget) - Number(allocation.spentBudget),
        children: build(allocation.id),
      }));

    return build(null);
  }

  /**
   * Called when a task's progress changes the achieved count. Applies the
   * delta to the allocation and walks up parentAllocationId so every
   * ancestor level (Booth -> Constituency -> District -> State) stays in sync.
   */
  async propagateAchievedDelta(allocationId: string, delta: number) {
    if (delta === 0) return;
    let currentId: string | null = allocationId;
    let guard = 0;
    while (currentId && guard < 20) {
      const updated: { parentAllocationId: string | null } = await this.prisma.targetAllocation.update({
        where: { id: currentId },
        data: { achievedCount: { increment: delta } },
        select: { parentAllocationId: true },
      });
      currentId = updated.parentAllocationId;
      guard += 1;
    }
  }

  async recordExpense(allocationId: string, amount: number) {
    await this.prisma.targetAllocation.update({
      where: { id: allocationId },
      data: { spentBudget: { increment: amount } },
    });
  }
}
