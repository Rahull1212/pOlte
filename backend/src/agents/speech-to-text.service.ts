import { Injectable, Logger } from "@nestjs/common";

export interface TranscriptionResult {
  transcript: string;
  detectedLanguage: string | null;
}

/**
 * Thin wrapper around OpenAI's Whisper API (audio/transcriptions) — the
 * provider chosen for Cadre voice-report transcription. Raw fetch + a
 * multipart form, same minimal-dependency style as WhatsAppApiService's
 * direct Meta Graph API calls, rather than pulling in the full `openai` SDK
 * for one endpoint. Degrades to a logged no-op when OPENAI_API_KEY is unset,
 * same "simulate when unconfigured" pattern as every other integration in
 * this app.
 */
@Injectable()
export class SpeechToTextService {
  private readonly logger = new Logger(SpeechToTextService.name);

  get isConfigured(): boolean {
    return Boolean(process.env.OPENAI_API_KEY);
  }

  async transcribe(audio: Buffer, filename: string, mimeType: string): Promise<TranscriptionResult | null> {
    if (!this.isConfigured) {
      this.logger.warn(`[Whisper not configured] would transcribe ${filename} (${audio.length} bytes)`);
      return null;
    }

    try {
      const form = new FormData();
      form.append("file", new Blob([audio], { type: mimeType }), filename);
      form.append("model", "whisper-1");
      form.append("response_format", "verbose_json"); // includes Whisper's own detected `language`

      const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
        method: "POST",
        headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
        body: form,
      });

      if (!response.ok) {
        const errorBody = await response.text();
        this.logger.error(`Whisper transcription failed (${response.status}): ${errorBody}`);
        return null;
      }

      const data = (await response.json()) as { text?: string; language?: string };
      if (!data.text) return null;
      return { transcript: data.text, detectedLanguage: data.language ?? null };
    } catch (err) {
      this.logger.error(`Whisper transcription threw: ${(err as Error).message}`);
      return null;
    }
  }
}
