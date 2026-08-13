import { BadRequestException, Injectable, NotFoundException, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import * as bcrypt from "bcrypt";
import {
  ChangePasswordDto,
  ConfirmPhoneChangeDto,
  ForgotPasswordDto,
  LoginDto,
  RequestPhoneChangeDto,
  ResetPasswordDto,
  UpdateProfileDto,
} from "../shared-types";
import { PrismaService } from "../prisma/prisma.service";
import { JwtPayload } from "./types";
import { OtpService } from "./otp.service";
import { WhatsAppApiService } from "../whatsapp-api/whatsapp-api.service";

const SELECT_PROFILE_FIELDS = {
  id: true,
  name: true,
  phone: true,
  email: true,
  gender: true,
  profilePicture: true,
  role: true,
  regionId: true,
  region: { select: { name: true, type: true } },
  createdAt: true,
} as const;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly otp: OtpService,
    private readonly whatsapp: WhatsAppApiService,
  ) {}

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({ where: { phone: dto.phone } });
    if (!user || !user.isActive) {
      throw new UnauthorizedException("Invalid credentials");
    }

    const passwordOk = await bcrypt.compare(dto.password, user.passwordHash);
    if (!passwordOk) {
      throw new UnauthorizedException("Invalid credentials");
    }

    const payload: JwtPayload = { sub: user.id, role: user.role, regionId: user.regionId };

    const accessToken = await this.jwt.signAsync(payload, {
      secret: process.env.JWT_ACCESS_SECRET,
      expiresIn: process.env.JWT_ACCESS_EXPIRES_IN ?? "15m",
    });
    const refreshToken = await this.jwt.signAsync(payload, {
      secret: process.env.JWT_REFRESH_SECRET,
      expiresIn: process.env.JWT_REFRESH_EXPIRES_IN ?? "7d",
    });

    return {
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        name: user.name,
        role: user.role,
        regionId: user.regionId,
      },
    };
  }

  async refresh(refreshToken: string) {
    try {
      const payload = await this.jwt.verifyAsync<JwtPayload>(refreshToken, {
        secret: process.env.JWT_REFRESH_SECRET,
      });
      const accessToken = await this.jwt.signAsync(
        { sub: payload.sub, role: payload.role, regionId: payload.regionId },
        { secret: process.env.JWT_ACCESS_SECRET, expiresIn: process.env.JWT_ACCESS_EXPIRES_IN ?? "15m" },
      );
      return { accessToken };
    } catch {
      throw new UnauthorizedException("Invalid refresh token");
    }
  }

  getProfile(userId: string) {
    return this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: SELECT_PROFILE_FIELDS });
  }

  async updateProfile(userId: string, dto: UpdateProfileDto) {
    if (dto.email) {
      const existing = await this.prisma.user.findUnique({ where: { email: dto.email } });
      if (existing && existing.id !== userId) {
        throw new BadRequestException("That email is already in use by another account");
      }
    }
    return this.prisma.user.update({ where: { id: userId }, data: dto, select: SELECT_PROFILE_FIELDS });
  }

  async changePassword(userId: string, dto: ChangePasswordDto) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const currentOk = await bcrypt.compare(dto.currentPassword, user.passwordHash);
    if (!currentOk) {
      // BadRequestException, not Unauthorized — the frontend treats any 401
      // as "your session expired" and force-logs you out. A wrong current
      // password while you're legitimately logged in isn't that.
      throw new BadRequestException("Current password is incorrect");
    }
    const passwordHash = await bcrypt.hash(dto.newPassword, 10);
    await this.prisma.user.update({ where: { id: userId }, data: { passwordHash } });
    await this.whatsapp.sendText(user.phone, "Your PoliOS password was just changed. If this wasn't you, contact your admin immediately.");
    return { message: "Password updated" };
  }

  updateProfilePicture(userId: string, url: string) {
    return this.prisma.user.update({
      where: { id: userId },
      data: { profilePicture: url },
      select: SELECT_PROFILE_FIELDS,
    });
  }

  async requestPhoneChange(userId: string, dto: RequestPhoneChangeDto) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const passwordOk = await bcrypt.compare(dto.currentPassword, user.passwordHash);
    if (!passwordOk) {
      throw new BadRequestException("Current password is incorrect");
    }
    if (dto.newPhone === user.phone) {
      throw new BadRequestException("That's already your current number");
    }
    const existing = await this.prisma.user.findUnique({ where: { phone: dto.newPhone } });
    if (existing) {
      throw new BadRequestException("That phone number is already registered to another account");
    }

    await this.otp.generate(userId, dto.newPhone, "PHONE_CHANGE");
    return { message: "Verification code sent to the new number" };
  }

  async confirmPhoneChange(userId: string, dto: ConfirmPhoneChangeDto) {
    await this.otp.verify(userId, dto.newPhone, "PHONE_CHANGE", dto.code);

    // Re-check uniqueness — the number could have been claimed by someone
    // else in the window between requesting and confirming the code.
    const existing = await this.prisma.user.findUnique({ where: { phone: dto.newPhone } });
    if (existing) {
      throw new BadRequestException("That phone number is already registered to another account");
    }

    const previous = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { phone: dto.newPhone },
      select: SELECT_PROFILE_FIELDS,
    });

    await this.whatsapp.sendText(
      previous.phone,
      `Your PoliOS account's phone number was changed to ${dto.newPhone}. If this wasn't you, contact your admin immediately.`,
    );
    return updated;
  }

  async forgotPassword(dto: ForgotPasswordDto) {
    const user = await this.prisma.user.findUnique({ where: { phone: dto.phone } });
    // Always return the same response regardless of whether the number is
    // registered — otherwise this endpoint becomes a way to enumerate valid
    // phone numbers/accounts.
    if (user && user.isActive) {
      await this.otp.generate(user.id, user.phone, "PASSWORD_RESET").catch(() => undefined);
    }
    return { message: "If that phone number is registered, a verification code has been sent to it." };
  }

  async resetPassword(dto: ResetPasswordDto) {
    const user = await this.prisma.user.findUnique({ where: { phone: dto.phone } });
    if (!user) {
      throw new NotFoundException("No account found for that phone number");
    }

    await this.otp.verify(user.id, dto.phone, "PASSWORD_RESET", dto.code);

    const passwordHash = await bcrypt.hash(dto.newPassword, 10);
    await this.prisma.user.update({ where: { id: user.id }, data: { passwordHash } });
    await this.whatsapp.sendText(user.phone, "Your PoliOS password was just reset. If this wasn't you, contact your admin immediately.");
    return { message: "Password reset — you can now sign in with your new password" };
  }
}
