import { Module } from "@nestjs/common";
import { SpeechToTextService } from "./speech-to-text.service";

@Module({
  providers: [SpeechToTextService],
  exports: [SpeechToTextService],
})
export class SpeechToTextModule {}
