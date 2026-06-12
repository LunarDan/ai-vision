import { Injectable } from "@nestjs/common";
import type { RealtimeSessionResponse } from "@ai-vision/shared";
import { OpenaiService } from "../openai/openai.service.js";

@Injectable()
export class RealtimeService {
  constructor(private readonly openaiService: OpenaiService) {}

  async createSession(): Promise<RealtimeSessionResponse> {
    void this.openaiService;
    throw new Error("OpenAI Realtime WebRTC has been replaced by the Omni WebSocket proxy.");
  }
}
