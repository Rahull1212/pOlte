import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import {
  GrievanceStatus,
  rejectGrievanceSchema,
  RejectGrievanceDto,
  resolveGrievanceSchema,
  ResolveGrievanceDto,
  submitGrievanceSchema,
  SubmitGrievanceDto,
} from "../shared-types";
import { GrievancesService } from "./grievances.service";
import { Roles } from "../common/decorators/roles.decorator";
import { RolesGuard } from "../common/guards/roles.guard";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { AuthenticatedUser } from "../auth/types";

@Controller("grievances")
@UseGuards(RolesGuard)
export class GrievancesController {
  constructor(private readonly grievancesService: GrievancesService) {}

  @Post()
  submit(
    @Body(new ZodValidationPipe(submitGrievanceSchema)) dto: SubmitGrievanceDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.grievancesService.submit(dto, user);
  }

  @Get()
  findMany(
    @CurrentUser() user: AuthenticatedUser,
    @Query("status") status?: GrievanceStatus,
    @Query("regionId") regionId?: string,
  ) {
    return this.grievancesService.findMany(user, { status, regionId });
  }

  @Patch(":id/resolve")
  @Roles("SUPER_ADMIN", "ADMIN")
  resolve(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(resolveGrievanceSchema)) dto: ResolveGrievanceDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.grievancesService.resolve(id, dto.resolutionNotes, user);
  }

  @Patch(":id/reject")
  @Roles("SUPER_ADMIN", "ADMIN")
  reject(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(rejectGrievanceSchema)) dto: RejectGrievanceDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.grievancesService.reject(id, dto.resolutionNotes, user);
  }
}
