import { Body, Controller, Get, Param, Patch, Post, UseGuards } from "@nestjs/common";
import {
  approveBudgetSchema,
  ApproveBudgetDto,
  createAllocationSchema,
  CreateAllocationDto,
  subAllocateSchema,
  SubAllocateDto,
} from "../shared-types";
import { AllocationsService } from "./allocations.service";
import { Roles } from "../common/decorators/roles.decorator";
import { RolesGuard } from "../common/guards/roles.guard";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { AuthenticatedUser } from "../auth/types";

@Controller()
@UseGuards(RolesGuard)
export class AllocationsController {
  constructor(private readonly allocationsService: AllocationsService) {}

  @Post("campaigns/:campaignId/allocations")
  @Roles("SUPER_ADMIN")
  createRoot(
    @Param("campaignId") campaignId: string,
    @Body(new ZodValidationPipe(createAllocationSchema)) dto: CreateAllocationDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.allocationsService.createRoot(campaignId, dto, user);
  }

  @Get("campaigns/:campaignId/allocations/tree")
  @Roles("SUPER_ADMIN", "ADMIN")
  tree(@Param("campaignId") campaignId: string) {
    return this.allocationsService.tree(campaignId);
  }

  @Post("allocations/sub-allocate")
  @Roles("ADMIN", "SUPER_ADMIN")
  subAllocate(
    @Body(new ZodValidationPipe(subAllocateSchema)) dto: SubAllocateDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.allocationsService.subAllocate(dto, user);
  }

  @Patch("allocations/:id/budget/approve")
  @Roles("SUPER_ADMIN", "ADMIN")
  approveBudget(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(approveBudgetSchema)) dto: ApproveBudgetDto,
  ) {
    return this.allocationsService.approveBudget(id, dto.approvedBudget);
  }
}
