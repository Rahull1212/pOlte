import { Controller, ForbiddenException, Get, NotFoundException, Param, Patch, UseGuards } from "@nestjs/common";
import { FieldReportsService } from "./field-reports.service";
import { PrismaService } from "../prisma/prisma.service";
import { RegionsService } from "../regions/regions.service";
import { Roles } from "../common/decorators/roles.decorator";
import { RolesGuard } from "../common/guards/roles.guard";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { AuthenticatedUser } from "../auth/types";

// Admin-facing surface for the field intelligence an Admin's Cadres send in
// on WhatsApp (Part 22's dashboard integration) — Cadres never call this
// directly, they only ever produce FieldReport rows via the WhatsApp/AI
// agent layer (FyxoAgentWebhookController -> ConversationRouter ->
// FieldReportsService).
@Controller("field-reports")
@UseGuards(RolesGuard)
@Roles("SUPER_ADMIN", "ADMIN")
export class FieldReportsController {
  constructor(
    private readonly fieldReportsService: FieldReportsService,
    private readonly prisma: PrismaService,
    private readonly regionsService: RegionsService,
  ) {}

  private async assertTaskVisible(taskId: string, user: AuthenticatedUser) {
    if (user.role === "SUPER_ADMIN") return;
    const task = await this.prisma.task.findUnique({ where: { id: taskId }, select: { assignedTo: { select: { regionId: true } } } });
    if (!task) throw new NotFoundException("Task not found");
    const withinScope = await this.regionsService.isWithinScope(user.regionId, task.assignedTo.regionId);
    if (!withinScope) throw new ForbiddenException("This task is outside your area");
  }

  @Get("task/:taskId")
  async listForTask(@Param("taskId") taskId: string, @CurrentUser() user: AuthenticatedUser) {
    await this.assertTaskVisible(taskId, user);
    return this.fieldReportsService.listForTask(taskId);
  }

  @Patch(":id/verify")
  async verify(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser) {
    const report = await this.prisma.fieldReport.findUnique({ where: { id }, select: { taskId: true } });
    if (!report) throw new NotFoundException("Field report not found");
    if (report.taskId) await this.assertTaskVisible(report.taskId, user);
    return this.fieldReportsService.reviewedVerify(id);
  }
}
