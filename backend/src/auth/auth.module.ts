import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { PassportModule } from "@nestjs/passport";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { JwtStrategy } from "./jwt.strategy";
import { OtpService } from "./otp.service";
import { WhatsAppApiModule } from "../whatsapp-api/whatsapp-api.module";

@Module({
  imports: [PassportModule, JwtModule.register({}), WhatsAppApiModule],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy, OtpService],
  exports: [AuthService],
})
export class AuthModule {}
