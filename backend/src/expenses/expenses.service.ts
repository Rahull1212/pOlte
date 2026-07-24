import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { ApprovalStatus, CreateExpenseDto } from "../shared-types";
import { PrismaService } from "../prisma/prisma.service";
import { AuthenticatedUser } from "../auth/types";
import { AllocationsService } from "../allocations/allocations.service";
import { NotificationsService } from "../notifications/notifications.service";

@Injectable()
export class ExpensesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly allocationsService: AllocationsService,
    private readonly notificationsService: NotificationsService,
  ) {}

  create(dto: CreateExpenseDto, user: AuthenticatedUser) {
    return this.prisma.expenseRequest.create({
      data: {
        campaignId: dto.campaignId,
        allocationId: dto.allocationId,
        submittedById: user.id,
        expenseType: dto.expenseType,
        amount: dto.amount,
        billUrl: dto.billUrl,
        description: dto.description,
      },
    });
  }

  findMany(filters: { campaignId?: string; approvalStatus?: ApprovalStatus }) {
    return this.prisma.expenseRequest.findMany({
      where: filters,
      include: { submittedBy: { select: { id: true, name: true } } },
      orderBy: { createdAt: "desc" },
    });
  }

  async approve(id: string, approverId: string) {
    const expense = await this.prisma.expenseRequest.findUnique({ where: { id } });
    if (!expense) throw new NotFoundException("Expense not found");
    if (expense.approvalStatus !== "PENDING") {
      throw new BadRequestException("Expense has already been decided");
    }

    const updated = await this.prisma.expenseRequest.update({
      where: { id },
      data: { approvalStatus: "APPROVED", approvedById: approverId, decidedAt: new Date() },
    });

    if (expense.allocationId) {
      await this.allocationsService.recordExpense(expense.allocationId, Number(expense.amount));
    }
    await this.notificationsService.notify({
      userId: expense.submittedById,
      type: "BUDGET_APPROVED",
      title: "Expense approved",
      message: `Your ${expense.expenseType} expense of ₹${expense.amount} was approved`,
      relatedEntityType: "ExpenseRequest",
      relatedEntityId: expense.id,
    });

    return updated;
  }

  async reject(id: string, approverId: string, reason?: string) {
    const expense = await this.prisma.expenseRequest.findUnique({ where: { id } });
    if (!expense) throw new NotFoundException("Expense not found");
    if (expense.approvalStatus !== "PENDING") {
      throw new BadRequestException("Expense has already been decided");
    }

    const updated = await this.prisma.expenseRequest.update({
      where: { id },
      data: {
        approvalStatus: "REJECTED",
        approvedById: approverId,
        rejectionReason: reason,
        decidedAt: new Date(),
      },
    });

    await this.notificationsService.notify({
      userId: expense.submittedById,
      type: "EXPENSE_REJECTED",
      title: "Expense rejected",
      message: reason ?? `Your ${expense.expenseType} expense of ₹${expense.amount} was rejected`,
      relatedEntityType: "ExpenseRequest",
      relatedEntityId: expense.id,
    });

    return updated;
  }
}
