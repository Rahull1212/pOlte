import { BadRequestException, Injectable } from "@nestjs/common";
import * as bcrypt from "bcrypt";
import { randomInt } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service";
import { WhatsAppApiService } from "../whatsapp-api/whatsapp-api.service";

const CODE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const RESEND_COOLDOWN_MS = 60 * 1000; // 1 minute between sends
const MAX_ATTEMPTS = 5;

type OtpPurpose = "PHONE_CHANGE" | "PASSWORD_RESET";

/**
 * Shared verification-code primitive for anything that needs proof the
 * caller controls a phone number — used by both "change my phone number"
 * and "forgot password". Delivery is via WhatsAppApiService, which already
 * degrades to a log line when WhatsApp isn't configured for an org (same
 * pattern as the rest of the app), so this works locally without real
 * WhatsApp credentials — the code just shows up in the backend console
 * instead of the user's phone.
 */
@Injectable()
export class OtpService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly whatsapp: WhatsAppApiService,
  ) {}

  async generate(userId: string, phone: string, purpose: OtpPurpose) {
    const recent = await this.prisma.otpCode.findFirst({
      where: { userId, purpose, phone, consumedAt: null, createdAt: { gte: new Date(Date.now() - RESEND_COOLDOWN_MS) } },
    });
    if (recent) {
      throw new BadRequestException("A code was already sent — please wait a minute before requesting another");
    }

    const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
    const codeHash = await bcrypt.hash(code, 10);

    await this.prisma.otpCode.create({
      data: { userId, phone, purpose, codeHash, expiresAt: new Date(Date.now() + CODE_TTL_MS) },
    });

    const label = purpose === "PHONE_CHANGE" ? "phone number change" : "password reset";
    await this.whatsapp.sendText(phone, `Your PoliOS verification code for ${label} is ${code}. It expires in 10 minutes.`);
  }

  /** Verifies and, on success, consumes the code so it can't be reused. */
  async verify(userId: string, phone: string, purpose: OtpPurpose, code: string) {
    const otp = await this.prisma.otpCode.findFirst({
      where: { userId, phone, purpose, consumedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: "desc" },
    });
    // BadRequestException throughout, not Unauthorized — the frontend
    // treats any 401 as "your session expired" and force-logs you out,
    // which is wrong for "you typed the wrong code."
    if (!otp) {
      throw new BadRequestException("Code is invalid or has expired — request a new one");
    }
    if (otp.attempts >= MAX_ATTEMPTS) {
      throw new BadRequestException("Too many incorrect attempts — request a new code");
    }

    const ok = await bcrypt.compare(code, otp.codeHash);
    if (!ok) {
      await this.prisma.otpCode.update({ where: { id: otp.id }, data: { attempts: { increment: 1 } } });
      throw new BadRequestException("Incorrect code");
    }

    await this.prisma.otpCode.update({ where: { id: otp.id }, data: { consumedAt: new Date() } });
  }
}
