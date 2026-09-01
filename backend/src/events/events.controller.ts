import { BadRequestException, Body, Controller, Get, Param, Post, Query, UploadedFiles, UseGuards, UseInterceptors } from "@nestjs/common";
import { FilesInterceptor } from "@nestjs/platform-express";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  addEventParticipantsSchema,
  AddEventParticipantsDto,
  createEventSchema,
  CreateEventDto,
  markAttendanceSchema,
  MarkAttendanceDto,
  updateEventRsvpSchema,
  UpdateEventRsvpDto,
} from "../shared-types";
import { EventsService } from "./events.service";
import { Roles } from "../common/decorators/roles.decorator";
import { RolesGuard } from "../common/guards/roles.guard";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { AuthenticatedUser } from "../auth/types";

const UPLOADS_DIR = join(process.cwd(), "uploads");
const ALLOWED_ATTACHMENT_TYPES = ["image/jpeg", "image/png", "image/webp", "application/pdf"];
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024; // 10MB per file
const MAX_ATTACHMENT_COUNT = 5;

@Controller("events")
@UseGuards(RolesGuard)
export class EventsController {
  constructor(private readonly eventsService: EventsService) {}

  @Post()
  @Roles("SUPER_ADMIN", "ADMIN")
  create(@Body(new ZodValidationPipe(createEventSchema)) dto: CreateEventDto, @CurrentUser() user: AuthenticatedUser) {
    return this.eventsService.create(dto, user);
  }

  // Same two-step pattern as task attachments: upload first, then include
  // the returned URLs in the create-event payload.
  @Post("attachments")
  @Roles("SUPER_ADMIN", "ADMIN")
  @UseInterceptors(FilesInterceptor("files", MAX_ATTACHMENT_COUNT, { limits: { fileSize: MAX_ATTACHMENT_BYTES } }))
  async uploadAttachments(@UploadedFiles() files: Express.Multer.File[] | undefined) {
    if (!files || files.length === 0) throw new BadRequestException("No files uploaded");

    const publicUrl = process.env.API_PUBLIC_URL ?? `http://localhost:${process.env.API_PORT ?? 4000}`;
    await mkdir(UPLOADS_DIR, { recursive: true });

    const urls = await Promise.all(
      files.map(async (file) => {
        if (!ALLOWED_ATTACHMENT_TYPES.includes(file.mimetype)) {
          throw new BadRequestException(`Unsupported file type: ${file.mimetype}`);
        }
        const extension = file.mimetype.split("/")[1];
        const filename = `${randomUUID()}.${extension}`;
        await writeFile(join(UPLOADS_DIR, filename), file.buffer);
        return `${publicUrl}/uploads/${filename}`;
      }),
    );

    return { urls };
  }

  @Get()
  findMany(@CurrentUser() user: AuthenticatedUser, @Query("regionId") regionId?: string) {
    return this.eventsService.listEvents(user, { regionId });
  }

  @Get(":id")
  findById(@Param("id") id: string) {
    return this.eventsService.findById(id);
  }

  @Get(":id/detail")
  getDetail(@Param("id") id: string) {
    return this.eventsService.getEventDetail(id);
  }

  @Get(":id/dashboard")
  getDashboard(@Param("id") id: string) {
    return this.eventsService.getEventDashboard(id);
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

  @Post(":id/rsvp")
  updateRsvp(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateEventRsvpSchema)) dto: UpdateEventRsvpDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.eventsService.updateRsvp(id, dto, user);
  }
}
