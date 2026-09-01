import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FilesInterceptor } from "@nestjs/platform-express";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  acknowledgeTaskSchema,
  AcknowledgeTaskDto,
  allocateTaskSchema,
  AllocateTaskDto,
  createTaskBatchSchema,
  CreateTaskBatchDto,
  createTaskSchema,
  CreateTaskDto,
  progressUpdateSchema,
  ProgressUpdateDto,
  TaskStatus,
  updateTaskSchema,
  UpdateTaskDto,
} from "../shared-types";
import { TasksService } from "./tasks.service";
import { Roles } from "../common/decorators/roles.decorator";
import { RolesGuard } from "../common/guards/roles.guard";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { AuthenticatedUser } from "../auth/types";

const UPLOADS_DIR = join(process.cwd(), "uploads");
const ALLOWED_ATTACHMENT_TYPES = ["image/jpeg", "image/png", "image/webp", "application/pdf"];
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024; // 10MB per file
const MAX_ATTACHMENT_COUNT = 5;

@Controller("tasks")
@UseGuards(RolesGuard)
export class TasksController {
  constructor(private readonly tasksService: TasksService) {}

  @Post()
  @Roles("SUPER_ADMIN", "ADMIN")
  create(@Body(new ZodValidationPipe(createTaskSchema)) dto: CreateTaskDto, @CurrentUser() user: AuthenticatedUser) {
    return this.tasksService.create(dto, user);
  }

  @Post("batch")
  @Roles("SUPER_ADMIN", "ADMIN")
  createBatch(
    @Body(new ZodValidationPipe(createTaskBatchSchema)) dto: CreateTaskBatchDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.tasksService.createBatch(dto, user);
  }

  // Upload attachments first, then include the returned URLs in the
  // POST /tasks/batch payload — same two-step pattern as the profile
  // picture upload (multipart form here, plain JSON for the create call).
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

  // Main Tasks page: every task-creation unit (batch or legacy single task),
  // region-scoped. Named "list" (not the bare GET / below) so it can't
  // collide with the existing campaign-board query the frontend already uses.
  @Get("list")
  @Roles("SUPER_ADMIN", "ADMIN")
  listTasks(@CurrentUser() user: AuthenticatedUser) {
    return this.tasksService.listTasks(user);
  }

  // Tasks a Super Admin routed to this Admin's area that still need
  // allocating to Cadres. Named distinctly (not under /:id) for the same
  // reason "list" is — avoids being swallowed by the bare GET()/GET(:id).
  @Get("pending-allocation")
  @Roles("ADMIN")
  listPendingAllocation(@CurrentUser() user: AuthenticatedUser) {
    return this.tasksService.listPendingAllocation(user);
  }

  @Get()
  findMany(
    @Query("assignedToId") assignedToId?: string,
    @Query("status") status?: TaskStatus,
    @Query("campaignId") campaignId?: string,
  ) {
    return this.tasksService.findMany({ assignedToId, status, campaignId });
  }

  @Get(":id")
  findById(@Param("id") id: string) {
    return this.tasksService.findById(id);
  }

  @Get(":id/detail")
  @Roles("SUPER_ADMIN", "ADMIN")
  getTaskDetail(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.tasksService.getTaskDetail(id, user);
  }

  @Get(":id/dashboard")
  @Roles("SUPER_ADMIN", "ADMIN")
  getTaskDashboard(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.tasksService.getTaskDashboard(id, user);
  }

  @Post(":id/insights")
  @Roles("SUPER_ADMIN", "ADMIN")
  generateInsights(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.tasksService.generateInsights(id, user);
  }

  @Get(":id/insights")
  @Roles("SUPER_ADMIN", "ADMIN")
  getSavedInsights(@Param("id") id: string) {
    return this.tasksService.getSavedInsights(id);
  }

  @Post(":id/allocate")
  @Roles("ADMIN")
  allocateToCadres(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(allocateTaskSchema)) dto: AllocateTaskDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.tasksService.allocateToCadres(id, dto.regionIds, user);
  }

  @Patch(":id")
  update(@Param("id") id: string, @Body(new ZodValidationPipe(updateTaskSchema)) dto: UpdateTaskDto) {
    return this.tasksService.update(id, dto);
  }

  @Patch(":id/acknowledge")
  @Roles("CADRE", "ADMIN")
  acknowledge(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(acknowledgeTaskSchema)) dto: AcknowledgeTaskDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.tasksService.acknowledge(id, dto.acknowledgment, user);
  }

  @Post(":id/progress")
  @Roles("CADRE", "ADMIN")
  submitProgress(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(progressUpdateSchema)) dto: ProgressUpdateDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.tasksService.submitProgress(id, dto, user);
  }
}
