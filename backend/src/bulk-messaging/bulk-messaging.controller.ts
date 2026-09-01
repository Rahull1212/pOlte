import { BadRequestException, Body, Controller, Get, Param, Patch, Post, UploadedFile, UseGuards, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import {
  BulkRecipientSelectionDto,
  bulkRecipientSelectionSchema,
  ComposeBulkMessageDto,
  composeBulkMessageSchema,
} from "../shared-types";
import { BulkMessagingService } from "./bulk-messaging.service";
import { Roles } from "../common/decorators/roles.decorator";
import { RolesGuard } from "../common/guards/roles.guard";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { AuthenticatedUser } from "../auth/types";

const ALLOWED_EXCEL_TYPES = [
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", // .xlsx
  "application/vnd.ms-excel", // .xls
];
const MAX_EXCEL_BYTES = 10 * 1024 * 1024; // 10MB

// Bulk WhatsApp Messaging is Super-Admin-only end to end, per spec — no
// Admin/Cadre access at any point in this flow.
@Controller("bulk-messages")
@UseGuards(RolesGuard)
@Roles("SUPER_ADMIN")
export class BulkMessagingController {
  constructor(private readonly bulkMessagingService: BulkMessagingService) {}

  @Post("upload")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: MAX_EXCEL_BYTES } }))
  async upload(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body("name") name: string | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    if (!file) throw new BadRequestException("No file uploaded");
    if (!ALLOWED_EXCEL_TYPES.includes(file.mimetype)) {
      throw new BadRequestException("Please upload a .xlsx or .xls file");
    }
    return this.bulkMessagingService.uploadExcel(file.buffer, name, user);
  }

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.bulkMessagingService.list(user);
  }

  @Get(":id")
  getCampaign(@Param("id") id: string) {
    return this.bulkMessagingService.getCampaign(id);
  }

  @Get(":id/recipients")
  listRecipients(@Param("id") id: string) {
    return this.bulkMessagingService.listRecipients(id);
  }

  @Get(":id/recipients/filter-options")
  getFilterOptions(@Param("id") id: string) {
    return this.bulkMessagingService.getFilterOptions(id);
  }

  @Patch(":id/recipients/selection")
  updateSelection(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(bulkRecipientSelectionSchema)) dto: BulkRecipientSelectionDto,
  ) {
    return this.bulkMessagingService.updateSelection(id, dto);
  }

  @Patch(":id/message")
  composeMessage(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(composeBulkMessageSchema)) dto: ComposeBulkMessageDto,
  ) {
    return this.bulkMessagingService.composeMessage(id, dto);
  }

  @Post(":id/send")
  send(@Param("id") id: string) {
    return this.bulkMessagingService.send(id);
  }

  @Get(":id/dashboard")
  getDashboard(@Param("id") id: string) {
    return this.bulkMessagingService.getDashboard(id);
  }
}
