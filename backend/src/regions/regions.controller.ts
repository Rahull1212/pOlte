import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from "@nestjs/common";
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
  create(@Body() body: { name: string; type: any; parentId?: string }, @CurrentUser() user: AuthenticatedUser) {
    return this.regionsService.create(body, user);
  }

  @Get()
  findAll(@CurrentUser() user: AuthenticatedUser) {
    return this.regionsService.findAllInScope(user.role === "SUPER_ADMIN" ? undefined : user.regionId);
  }

  @Get(":id")
  findById(@Param("id") id: string) {
    return this.regionsService.findById(id);
  }

  @Patch(":id")
  @UseGuards(RolesGuard)
  @Roles("SUPER_ADMIN", "ADMIN")
  update(
    @Param("id") id: string,
    @Body() body: { name?: string; parentId?: string },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.regionsService.update(id, body, user);
  }

  @Get(":id/children")
  children(@Param("id") id: string) {
    return this.regionsService.children(id);
  }

  @Delete(":id")
  @UseGuards(RolesGuard)
  @Roles("SUPER_ADMIN", "ADMIN")
  remove(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.regionsService.remove(id, user);
  }
}
