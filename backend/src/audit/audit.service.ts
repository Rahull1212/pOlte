import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  /** Powers the Activity Feed — most recent platform-wide actions, newest first. */
  async recent(limit = 15) {
    const logs = await this.prisma.auditLog.findMany({
      orderBy: { createdAt: "desc" },
      take: limit,
      include: { user: { select: { name: true, role: true } } },
    });

    return logs.map((log) => ({
      id: log.id,
      action: log.action,
      entityType: log.entityType,
      entityId: log.entityId,
      // The actor is optional — their account may have since been deleted
      // (see UsersService.remove()), in which case the entry itself is
      // deliberately kept rather than reassigned to someone who didn't
      // actually do this.
      userName: log.user?.name ?? "Deleted user",
      userRole: log.user?.role ?? null,
      createdAt: log.createdAt,
    }));
  }
}
