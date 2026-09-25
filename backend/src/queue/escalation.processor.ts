import { Processor, WorkerHost } from "@nestjs/bullmq";
import { Job } from "bullmq";
import { Logger } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { NotificationsService } from "../notifications/notifications.service";

const ESCALATION_THRESHOLD_MS = 48 * 60 * 60 * 1000; // 48 hours past deadline

@Processor("escalations")
export class EscalationProcessor extends WorkerHost {
  private readonly logger = new Logger(EscalationProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
  ) {
    super();
  }

  async process(job: Job): Promise<void> {
    if (job.name !== "check-overdue") return;

    const now = new Date();

    // 1. Mark newly-overdue tasks and remind the assigner.
    const newlyOverdue = await this.prisma.task.findMany({
      where: { deadline: { lt: now }, status: { in: ["PENDING", "IN_PROGRESS"] } },
    });

    for (const task of newlyOverdue) {
      await this.prisma.task.update({ where: { id: task.id }, data: { status: "OVERDUE" } });
      await this.notificationsService.notify({
        userId: task.assignedById,
        type: "DEADLINE_REMINDER",
        title: "Task overdue",
        message: `"${task.name}" is now overdue`,
        relatedEntityType: "Task",
        relatedEntityId: task.id,
      });
    }

    // 2. Escalate tasks that have been overdue for more than 48h to the
    //    assigner's own parent in the hierarchy (Booth -> Constituency -> ...).
    const longOverdue = await this.prisma.task.findMany({
      where: { status: "OVERDUE", deadline: { lt: new Date(now.getTime() - ESCALATION_THRESHOLD_MS) } },
      include: { assignedBy: { select: { parentUserId: true } } },
    });

    for (const task of longOverdue) {
      const escalateTo = task.assignedBy.parentUserId;
      if (!escalateTo) continue;
      await this.notificationsService.notify({
        userId: escalateTo,
        type: "ESCALATION",
        title: "Escalated: overdue task",
        message: `"${task.name}" has been overdue for more than 48 hours`,
        relatedEntityType: "Task",
        relatedEntityId: task.id,
      });
    }

    this.logger.log(`Escalation sweep: ${newlyOverdue.length} newly overdue, ${longOverdue.length} escalated`);
  }
}
