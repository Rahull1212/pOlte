import { Injectable, NotFoundException } from "@nestjs/common";
import { CampaignStatus, CreateCampaignDto, UpdateCampaignDto } from "../shared-types";
import { PrismaService } from "../prisma/prisma.service";
import { AuthenticatedUser } from "../auth/types";

@Injectable()
export class CampaignsService {
  constructor(private readonly prisma: PrismaService) {}

  create(dto: CreateCampaignDto, user: AuthenticatedUser) {
    return this.prisma.campaign.create({
      data: {
        name: dto.name,
        description: dto.description,
        objective: dto.objective,
        category: dto.category,
        startDate: dto.startDate,
        endDate: dto.endDate,
        priority: dto.priority,
        bannerUrl: dto.bannerUrl,
        totalTarget: dto.totalTarget,
        totalBudget: dto.totalBudget,
        expectedVolunteers: dto.expectedVolunteers,
        requiredDocuments: dto.requiredDocuments,
        status: "DRAFT",
        createdById: user.id,
      },
    });
  }

  findAll(filters: { status?: CampaignStatus; priority?: string }) {
    return this.prisma.campaign.findMany({
      where: {
        status: filters.status,
        priority: filters.priority as any,
      },
      orderBy: { createdAt: "desc" },
    });
  }

  async findById(id: string) {
    const campaign = await this.prisma.campaign.findUnique({
      where: { id },
      include: {
        attachments: true,
        allocations: { where: { parentAllocationId: null } },
        _count: { select: { tasks: true, expenses: true } },
      },
    });
    if (!campaign) throw new NotFoundException("Campaign not found");
    return campaign;
  }

  async update(id: string, dto: UpdateCampaignDto) {
    await this.findById(id);
    return this.prisma.campaign.update({ where: { id }, data: dto as any });
  }

  async setStatus(id: string, status: CampaignStatus) {
    await this.findById(id);
    return this.prisma.campaign.update({ where: { id }, data: { status } });
  }

  /** Powers the Campaign Dashboard (active/upcoming/completed + totals + overall progress). */
  async dashboardSummary() {
    const [active, upcoming, completed, campaigns] = await Promise.all([
      this.prisma.campaign.count({ where: { status: "ACTIVE" } }),
      this.prisma.campaign.count({ where: { status: "UPCOMING" } }),
      this.prisma.campaign.count({ where: { status: "COMPLETED" } }),
      this.prisma.campaign.findMany({
        select: { totalTarget: true, totalBudget: true, id: true },
      }),
    ]);

    const totalTarget = campaigns.reduce((sum, c) => sum + c.totalTarget, 0);
    const totalBudget = campaigns.reduce((sum, c) => sum + Number(c.totalBudget), 0);

    const rootAllocations = await this.prisma.targetAllocation.findMany({
      where: { campaignId: { in: campaigns.map((c) => c.id) } },
      select: { achievedCount: true, target: true },
    });
    const achieved = rootAllocations.reduce((sum, a) => sum + a.achievedCount, 0);
    const target = rootAllocations.reduce((sum, a) => sum + a.target, 0);
    const overallProgress = target > 0 ? Math.round((achieved / target) * 100) : 0;

    return { active, upcoming, completed, totalTarget, totalBudget, overallProgress };
  }
}
