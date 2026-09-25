import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { assignMessageTemplateSchema, AssignMessageTemplateDto } from "../shared-types";
import { MessageTemplatesService } from "./message-templates.service";
import { TemplateSyncService } from "./template-sync.service";
import { Roles } from "../common/decorators/roles.decorator";
import { RolesGuard } from "../common/guards/roles.guard";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { AuthenticatedUser } from "../auth/types";

/**
 * Who owns which approved template.
 *
 * A Super Admin manages everyone's from the WhatsApp Templates page. An
 * Admin has no such page — they change their own while creating a task,
 * which is the only moment the choice matters to them — so the routes they
 * need are opened individually rather than the whole controller.
 */
@Controller("message-templates")
@UseGuards(RolesGuard)
export class MessageTemplatesController {
  constructor(
    private readonly templates: MessageTemplatesService,
    private readonly sync: TemplateSyncService,
  ) {}

  /** Every owner and their template. Super Admin only: this is everyone's. */
  @Get()
  @Roles("SUPER_ADMIN")
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.templates.list(user.id);
  }

  /**
   * Just the caller's own template. Listed before :userId so it can't be
   * read as a user id, and open to Admins because it is only ever theirs.
   */
  @Get("mine")
  @Roles("SUPER_ADMIN", "ADMIN")
  mine(@CurrentUser() user: AuthenticatedUser) {
    return this.templates.mine(user.id);
  }

  /** The synced catalogue a template is picked from. */
  @Get("available")
  @Roles("SUPER_ADMIN", "ADMIN")
  listAvailable() {
    return this.sync.list();
  }

  /** Re-reads the provider's catalogue. Super Admin only — it calls Fyxo. */
  @Post("sync")
  @Roles("SUPER_ADMIN")
  syncFromProvider() {
    return this.sync.sync();
  }

  /**
   * Assign a template. A Super Admin may set anyone's; an Admin only their
   * own — enforced in the service, so the path param can't be swapped for
   * someone else's id.
   */
  @Patch(":userId")
  @Roles("SUPER_ADMIN", "ADMIN")
  assign(
    @Param("userId") userId: string,
    @Body(new ZodValidationPipe(assignMessageTemplateSchema)) dto: AssignMessageTemplateDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.templates.assign(userId, dto, user);
  }

  @Delete(":userId")
  @Roles("SUPER_ADMIN")
  clear(@Param("userId") userId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.templates.clear(userId, user.id);
  }
}
