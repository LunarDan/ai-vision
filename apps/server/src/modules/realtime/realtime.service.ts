import { Injectable } from "@nestjs/common";
import type { RealtimeSessionResponse } from "@ai-vision/shared";
import { OpenaiService } from "../openai/openai.service.js";

@Injectable()
export class RealtimeService {
  constructor(private readonly openaiService: OpenaiService) {}

  async createSession(): Promise<RealtimeSessionResponse> {
    const session = await this.openaiService.createRealtimeSession();

    return {
      clientSecret: session.client_secret?.value ?? "",
      expiresAt: session.client_secret?.expires_at,
      model: process.env.OPENAI_REALTIME_MODEL ?? "gpt-realtime",
    };
  }
}
