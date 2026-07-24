import { Body, Controller, Get, Param, Post, Query, UseGuards } from "@nestjs/common";
import {
  addEventParticipantsSchema,
  AddEventParticipantsDto,
  createEventSchema,
  CreateEventDto,
  markAttendanceSchema,
  MarkAttendanceDto,
} from "../shared-types";
import { EventsService } from "./events.service";
import { Roles } from "../common/decorators/roles.decorator";
import { RolesGuard } from "../common/guards/roles.guard";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { AuthenticatedUser } from "../auth/types";

@Controller("events")
@UseGuards(RolesGuard)
export class EventsController {
  constructor(private readonly eventsService: EventsService) {}

  @Post()
  @Roles("SUPER_ADMIN", "ADMIN")
  create(@Body(new ZodValidationPipe(createEventSchema)) dto: CreateEventDto, @CurrentUser() user: AuthenticatedUser) {
    return this.eventsService.create(dto, user);
  }

  @Get()
  findMany(@CurrentUser() user: AuthenticatedUser, @Query("regionId") regionId?: string) {
    return this.eventsService.findMany(user, { regionId });
  }

  @Get(":id")
  findById(@Param("id") id: string) {
    return this.eventsService.findById(id);
  }

  @Get(":id/report")
  report(@Param("id") id: string) {
    return this.eventsService.attendanceReport(id);
  }

  @Post(":id/participants")
  @Roles("SUPER_ADMIN", "ADMIN")
  addParticipants(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(addEventParticipantsSchema)) dto: AddEventParticipantsDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.eventsService.addParticipants(id, dto, user);
  }

  @Post(":id/attendance")
  markAttendance(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(markAttendanceSchema)) dto: MarkAttendanceDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.eventsService.markAttendance(id, dto, user);
  }
}
