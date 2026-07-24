import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { AuditService } from "./audit.service";
import { Roles } from "../common/decorators/roles.decorator";
import { RolesGuard } from "../common/guards/roles.guard";

@Controller("audit-logs")
@UseGuards(RolesGuard)
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get()
  @Roles("SUPER_ADMIN")
  recent(@Query("limit") limit?: string) {
    return this.auditService.recent(limit ? Number.parseInt(limit, 10) : undefined);
  }
}
