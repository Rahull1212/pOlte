import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import {
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

@Controller("tasks")
@UseGuards(RolesGuard)
export class TasksController {
  constructor(private readonly tasksService: TasksService) {}

  @Post()
  @Roles("SUPER_ADMIN", "ADMIN")
  create(@Body(new ZodValidationPipe(createTaskSchema)) dto: CreateTaskDto, @CurrentUser() user: AuthenticatedUser) {
    return this.tasksService.create(dto, user);
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

  @Patch(":id")
  update(@Param("id") id: string, @Body(new ZodValidationPipe(updateTaskSchema)) dto: UpdateTaskDto) {
    return this.tasksService.update(id, dto);
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
