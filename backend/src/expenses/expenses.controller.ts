import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { ApprovalStatus, createExpenseSchema, CreateExpenseDto, decideExpenseSchema, DecideExpenseDto } from "../shared-types";
import { ExpensesService } from "./expenses.service";
import { Roles } from "../common/decorators/roles.decorator";
import { RolesGuard } from "../common/guards/roles.guard";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { AuthenticatedUser } from "../auth/types";

@Controller("expenses")
@UseGuards(RolesGuard)
export class ExpensesController {
  constructor(private readonly expensesService: ExpensesService) {}

  @Post()
  create(@Body(new ZodValidationPipe(createExpenseSchema)) dto: CreateExpenseDto, @CurrentUser() user: AuthenticatedUser) {
    return this.expensesService.create(dto, user);
  }

  @Get()
  findMany(@Query("campaignId") campaignId?: string, @Query("status") approvalStatus?: ApprovalStatus) {
    return this.expensesService.findMany({ campaignId, approvalStatus });
  }

  @Patch(":id/approve")
  @Roles("SUPER_ADMIN", "ADMIN")
  approve(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.expensesService.approve(id, user.id);
  }

  @Patch(":id/reject")
  @Roles("SUPER_ADMIN", "ADMIN")
  reject(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(decideExpenseSchema)) dto: DecideExpenseDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.expensesService.reject(id, user.id, dto.rejectionReason);
  }
}
