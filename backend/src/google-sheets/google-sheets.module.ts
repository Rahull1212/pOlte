import { Module } from "@nestjs/common";
import { GoogleSheetsService } from "./google-sheets.service";
import { GoogleOAuthService } from "./google-oauth.service";
import { GoogleSheetsController } from "./google-sheets.controller";

@Module({
  controllers: [GoogleSheetsController],
  providers: [GoogleSheetsService, GoogleOAuthService],
  exports: [GoogleSheetsService],
})
export class GoogleSheetsModule {}
