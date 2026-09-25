import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { createRegionSchema, CreateRegionDto, updateRegionSchema, UpdateRegionDto } from "../shared-types";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { RegionsService } from "./regions.service";
import { Roles } from "../common/decorators/roles.decorator";
import { RolesGuard } from "../common/guards/roles.guard";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { AuthenticatedUser } from "../auth/types";

@Controller("regions")
export class RegionsController {
  constructor(private readonly regionsService: RegionsService) {}

  @Post()
  @UseGuards(RolesGuard)
  @Roles("SUPER_ADMIN", "ADMIN")
  create(
    @Body(new ZodValidationPipe(createRegionSchema)) body: CreateRegionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.regionsService.create(body, user);
  }

  @Get()
  findAll(@CurrentUser() user: AuthenticatedUser) {
    return this.regionsService.findAllInScope(user.role === "SUPER_ADMIN" ? undefined : user.regionId);
  }

  // Scoped like the list above: an Admin can only read areas inside their
  // own subtree. Previously any authenticated user could read any area by id.
  @Get(":id")
  @UseGuards(RolesGuard)
  @Roles("SUPER_ADMIN", "ADMIN")
  findById(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.regionsService.findByIdInScope(id, user);
  }

  @Patch(":id")
  @UseGuards(RolesGuard)
  @Roles("SUPER_ADMIN", "ADMIN")
  update(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateRegionSchema)) body: UpdateRegionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.regionsService.update(id, body, user);
  }

  @Get(":id/children")
  @UseGuards(RolesGuard)
  @Roles("SUPER_ADMIN", "ADMIN")
  async children(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser) {
    // Reading the parent first is the access check — it throws for an area
    // outside the caller's scope.
    await this.regionsService.findByIdInScope(id, user);
    return this.regionsService.children(id);
  }

  @Delete(":id")
  @UseGuards(RolesGuard)
  @Roles("SUPER_ADMIN", "ADMIN")
  remove(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.regionsService.remove(id, user);
  }
}
