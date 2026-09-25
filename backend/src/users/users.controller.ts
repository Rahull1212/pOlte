import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { createUserSchema, CreateUserDto, Role, updateUserSchema, UpdateUserDto } from "../shared-types";
import { UsersService } from "./users.service";
import { UserDashboardService } from "./user-dashboard.service";
import { Roles } from "../common/decorators/roles.decorator";
import { RolesGuard } from "../common/guards/roles.guard";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { AuthenticatedUser } from "../auth/types";

@Controller("users")
@UseGuards(RolesGuard)
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly userDashboard: UserDashboardService,
  ) {}

  @Post()
  @Roles("SUPER_ADMIN", "ADMIN")
  create(@Body(new ZodValidationPipe(createUserSchema)) dto: CreateUserDto, @CurrentUser() user: AuthenticatedUser) {
    return this.usersService.create({ ...dto, parentUserId: dto.parentUserId ?? user.id }, user);
  }

  @Get()
  findAll(@CurrentUser() user: AuthenticatedUser, @Query("role") role?: Role) {
    return this.usersService.findAll(user, { role });
  }

  @Get("direct-reports")
  directReports(@CurrentUser() user: AuthenticatedUser) {
    return this.usersService.findDirectReports(user.id);
  }

  /**
   * One user's work summary. Listed before :id purely for readability —
   * Nest matches the more specific path regardless. Super Admin only: this
   * reports on somebody else's performance, which is supervisory.
   */
  @Get(":id/dashboard")
  @Roles("SUPER_ADMIN")
  dashboard(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.userDashboard.build(id, user);
  }

  @Get(":id")
  findById(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.usersService.findByIdVisibleTo(id, user);
  }

  @Patch(":id")
  @Roles("SUPER_ADMIN", "ADMIN")
  update(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateUserSchema)) dto: UpdateUserDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.usersService.update(id, dto, user);
  }

  @Delete(":id")
  @Roles("SUPER_ADMIN", "ADMIN")
  remove(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.usersService.remove(id, user);
  }
}
