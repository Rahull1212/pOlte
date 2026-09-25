import { BadRequestException, Body, Controller, Get, Patch, Post, UploadedFile, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { Throttle } from "@nestjs/throttler";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  ChangePasswordDto,
  changePasswordSchema,
  ConfirmPhoneChangeDto,
  confirmPhoneChangeSchema,
  ForgotPasswordDto,
  forgotPasswordSchema,
  LoginDto,
  loginSchema,
  RequestPhoneChangeDto,
  requestPhoneChangeSchema,
  ResetPasswordDto,
  resetPasswordSchema,
  UpdateProfileDto,
  updateProfileSchema, refreshTokenSchema, RefreshTokenDto } from "../shared-types";
import { AuthService } from "./auth.service";
import { Public } from "../common/decorators/public.decorator";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { AuthenticatedUser } from "./types";

const UPLOADS_DIR = join(process.cwd(), "uploads");
const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024; // 5MB

@Controller("auth")
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  // Password guessing. 5/min per IP still lets a real person mistype a few times.
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post("login")
  login(@Body(new ZodValidationPipe(loginSchema)) dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Public()
  // Generous — legitimate clients refresh on a timer — but bounded.
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post("refresh")
  refresh(@Body(new ZodValidationPipe(refreshTokenSchema)) body: RefreshTokenDto) {
    return this.authService.refresh(body.refreshToken);
  }

  // Fetches the current profile fresh from the DB (email/gender/profile
  // picture aren't in the JWT payload) rather than echoing the decoded
  // token — the token only carries what's needed for authorization checks.
  @Get("me")
  me(@CurrentUser() user: AuthenticatedUser) {
    return this.authService.getProfile(user.id);
  }

  @Patch("profile")
  updateProfile(
    @Body(new ZodValidationPipe(updateProfileSchema)) dto: UpdateProfileDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.authService.updateProfile(user.id, dto);
  }

  // Verifies the current password, so it is a guessing surface too.
  @Throttle({ default: { limit: 5, ttl: 300_000 } })
  @Post("change-password")
  changePassword(
    @Body(new ZodValidationPipe(changePasswordSchema)) dto: ChangePasswordDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.authService.changePassword(user.id, dto);
  }

  // Sends an SMS and checks a password.
  @Throttle({ default: { limit: 3, ttl: 300_000 } })
  @Post("phone-change/request")
  requestPhoneChange(
    @Body(new ZodValidationPipe(requestPhoneChangeSchema)) dto: RequestPhoneChangeDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.authService.requestPhoneChange(user.id, dto);
  }

  // Checks a 6-digit OTP.
  @Throttle({ default: { limit: 5, ttl: 300_000 } })
  @Post("phone-change/confirm")
  confirmPhoneChange(
    @Body(new ZodValidationPipe(confirmPhoneChangeSchema)) dto: ConfirmPhoneChangeDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.authService.confirmPhoneChange(user.id, dto);
  }

  @Public()
  // Each call sends an SMS to the given number — rate-limited to stop both OTP guessing and using us as an SMS cannon.
  @Throttle({ default: { limit: 3, ttl: 300_000 } })
  @Post("forgot-password")
  forgotPassword(@Body(new ZodValidationPipe(forgotPasswordSchema)) dto: ForgotPasswordDto) {
    return this.authService.forgotPassword(dto);
  }

  @Public()
  // A 6-digit OTP is only 10^6 wide; unlimited attempts make it guessable in minutes.
  @Throttle({ default: { limit: 5, ttl: 300_000 } })
  @Post("reset-password")
  resetPassword(@Body(new ZodValidationPipe(resetPasswordSchema)) dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto);
  }

  @Post("profile-picture")
  // Memory storage (the default with no `storage` option) so we get the raw
  // buffer and write it ourselves — same disk-write pattern used for WhatsApp
  // media in whatsapp-api.service.ts.
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: MAX_UPLOAD_BYTES } }))
  async uploadProfilePicture(
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    if (!file) throw new BadRequestException("No file uploaded");
    if (!ALLOWED_IMAGE_TYPES.includes(file.mimetype)) {
      throw new BadRequestException("Only JPEG, PNG, or WebP images are allowed");
    }

    const extension = file.mimetype.split("/")[1];
    const filename = `${randomUUID()}.${extension}`;
    await mkdir(UPLOADS_DIR, { recursive: true });
    await writeFile(join(UPLOADS_DIR, filename), file.buffer);

    const publicUrl = process.env.API_PUBLIC_URL ?? `http://localhost:${process.env.API_PORT ?? 4000}`;
    return this.authService.updateProfilePicture(user.id, `${publicUrl}/uploads/${filename}`);
  }
}
