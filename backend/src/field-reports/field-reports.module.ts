import { Module } from "@nestjs/common";
import { FieldReportsService } from "./field-reports.service";
import { FieldReportsController } from "./field-reports.controller";
import { AiModule } from "../ai/ai.module";
import { SpeechToTextModule } from "../agents/speech-to-text.module";
import { RegionsModule } from "../regions/regions.module";

@Module({
  imports: [AiModule, SpeechToTextModule, RegionsModule],
  controllers: [FieldReportsController],
  providers: [FieldReportsService],
  exports: [FieldReportsService],
})
export class FieldReportsModule {}
