import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { createPollSchema, CreatePollDto, allocatePollSchema, AllocatePollDto } from "../shared-types";
import { PollsService } from "./polls.service";
import { Roles } from "../common/decorators/roles.decorator";
import { RolesGuard } from "../common/guards/roles.guard";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { AuthenticatedUser } from "../auth/types";

@Controller("polls")
@UseGuards(RolesGuard)
export class PollsController {
  constructor(private readonly pollsService: PollsService) {}

  // Both roles can write a poll, but they reach different people: a Super
  // Admin can target any area, while an Admin is confined to their own
  // subtree — create() checks every requested region against the caller's
  // scope, so this is not merely a UI affordance.
  //
  // The Super-Admin-writes / Admin-allocates split still holds for polls the
  // Super Admin creates; this adds the case where an Admin asks their own
  // Cadres something directly, without waiting on anyone.
  @Post()
  @Roles("SUPER_ADMIN", "ADMIN")
  create(@Body(new ZodValidationPipe(createPollSchema)) dto: CreatePollDto, @CurrentUser() user: AuthenticatedUser) {
    return this.pollsService.create(dto, user);
  }

  @Get()
  @Roles("SUPER_ADMIN", "ADMIN")
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.pollsService.list(user);
  }

  @Get(":id")
  @Roles("SUPER_ADMIN", "ADMIN")
  getDetail(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.pollsService.getDetail(id, user);
  }

  @Get(":id/dashboard")
  @Roles("SUPER_ADMIN", "ADMIN")
  getDashboard(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.pollsService.getDashboard(id, user);
  }

  @Post(":id/allocate")
  @Roles("ADMIN")
  allocate(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(allocatePollSchema)) dto: AllocatePollDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.pollsService.allocate(id, dto, user);
  }

  // recipientId is one PollRecipient row, not a poll id — same "id is the
  // per-Cadre row" convention as TasksController's retry-whatsapp.
  @Post("recipients/:recipientId/retry-whatsapp")
  @Roles("SUPER_ADMIN", "ADMIN")
  retryWhatsapp(@Param("recipientId") recipientId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.pollsService.retryWhatsapp(recipientId, user);
  }
}
