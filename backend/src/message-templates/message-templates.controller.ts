import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { assignMessageTemplateSchema, AssignMessageTemplateDto } from "../shared-types";
import { MessageTemplatesService } from "./message-templates.service";
import { TemplateSyncService } from "./template-sync.service";
import { Roles } from "../common/decorators/roles.decorator";
import { RolesGuard } from "../common/guards/roles.guard";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { AuthenticatedUser } from "../auth/types";

// Super Admin only: which template an Admin owns is set from the Super
// Admin's page alone — an Admin can't repoint their own messaging.
@Controller("message-templates")
@UseGuards(RolesGuard)
@Roles("SUPER_ADMIN")
export class MessageTemplatesController {
  constructor(
    private readonly templates: MessageTemplatesService,
    private readonly sync: TemplateSyncService,
  ) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.templates.list(user.id);
  }

  /** The synced catalogue an Admin's template is picked from. */
  @Get("available")
  listAvailable() {
    return this.sync.list();
  }

  @Post("sync")
  syncFromProvider() {
    return this.sync.sync();
  }

  @Patch(":userId")
  assign(
    @Param("userId") userId: string,
    @Body(new ZodValidationPipe(assignMessageTemplateSchema)) dto: AssignMessageTemplateDto,
  ) {
    return this.templates.assign(userId, dto);
  }

  @Delete(":userId")
  clear(@Param("userId") userId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.templates.clear(userId, user.id);
  }
}
