import {
  BadRequestException,
  Body,
  Controller,
  Delete,
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
import {
  GrievanceStatus,
  rejectGrievanceSchema,
  RejectGrievanceDto,
  resolveGrievanceSchema,
  ResolveGrievanceDto,
  submitGrievanceSchema,
  SubmitGrievanceDto,
  updateGrievanceStatusSchema,
  UpdateGrievanceStatusDto,
} from "../shared-types";
import { GrievancesService } from "./grievances.service";
import { Roles } from "../common/decorators/roles.decorator";
import { RolesGuard } from "../common/guards/roles.guard";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { AuthenticatedUser } from "../auth/types";
import {
  GRIEVANCE_ATTACHMENT_TYPES,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENT_COUNT,
  storeAttachments,
} from "../common/uploads/attachment-storage";

@Controller("grievances")
@UseGuards(RolesGuard)
export class GrievancesController {
  constructor(private readonly grievancesService: GrievancesService) {}

  /**
   * Raising a grievance is for the people on the ground. A Super Admin is
   * refused here *and* in the service, so neither this decorator nor a
   * future internal caller is the only thing standing in the way.
   */
  @Post()
  @Roles("ADMIN", "CADRE")
  submit(
    @Body(new ZodValidationPipe(submitGrievanceSchema)) dto: SubmitGrievanceDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.grievancesService.submit(dto, user);
  }

  /**
   * Upload evidence first, then pass the returned URLs to POST /grievances
   * — the same two-step pattern as task attachments and profile pictures.
   * Only the roles that may file a grievance may upload for one.
   */
  @Post("attachments")
  @Roles("ADMIN", "CADRE")
  @UseInterceptors(
    FilesInterceptor("files", MAX_ATTACHMENT_COUNT, { limits: { fileSize: MAX_ATTACHMENT_BYTES } }),
  )
  async uploadAttachments(@UploadedFiles() files: Express.Multer.File[] | undefined) {
    if (!files || files.length === 0) throw new BadRequestException("No files uploaded");
    const stored = await storeAttachments(files, GRIEVANCE_ATTACHMENT_TYPES);
    return { urls: stored.map((s) => s.url), files: stored };
  }

  @Get()
  findMany(
    @CurrentUser() user: AuthenticatedUser,
    @Query("status") status?: GrievanceStatus,
    @Query("regionId") regionId?: string,
  ) {
    return this.grievancesService.findMany(user, { status, regionId });
  }

  @Get(":id")
  findById(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.grievancesService.findById(id, user);
  }

  @Patch(":id/status")
  @Roles("SUPER_ADMIN")
  setStatus(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateGrievanceStatusSchema)) dto: UpdateGrievanceStatusDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.grievancesService.setStatus(id, dto.status, dto.resolutionNotes, user);
  }

  @Patch(":id/resolve")
  @Roles("SUPER_ADMIN")
  resolve(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(resolveGrievanceSchema)) dto: ResolveGrievanceDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.grievancesService.resolve(id, dto.resolutionNotes, user);
  }

  @Patch(":id/reject")
  @Roles("SUPER_ADMIN")
  reject(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(rejectGrievanceSchema)) dto: RejectGrievanceDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.grievancesService.reject(id, dto.resolutionNotes, user);
  }

  @Delete(":id")
  @Roles("SUPER_ADMIN")
  remove(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.grievancesService.remove(id, user);
  }
}
