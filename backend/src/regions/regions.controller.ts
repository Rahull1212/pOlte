import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
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
  @Roles("SUPER_ADMIN")
  create(@Body() body: { name: string; type: any; parentId?: string }) {
    return this.regionsService.create(body);
  }

  @Get()
  findAll(@CurrentUser() user: AuthenticatedUser) {
    return this.regionsService.findAllInScope(user.role === "SUPER_ADMIN" ? undefined : user.regionId);
  }

  @Get(":id")
  findById(@Param("id") id: string) {
    return this.regionsService.findById(id);
  }

  @Get(":id/children")
  children(@Param("id") id: string) {
    return this.regionsService.children(id);
  }
}
