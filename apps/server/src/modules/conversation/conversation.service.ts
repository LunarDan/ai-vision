import { Injectable } from "@nestjs/common";
import type { ConversationRequest, ConversationResponse } from "@ai-vision/shared";
import { OpenaiService } from "../openai/openai.service.js";

@Injectable()
export class ConversationService {
  constructor(private readonly openaiService: OpenaiService) {}

  async respond(request: ConversationRequest): Promise<ConversationResponse> {
    const reply = await this.openaiService.createConversationReply(request);

    return {
      sessionId: request.sessionId,
      reply,
      createdAt: new Date().toISOString(),
    };
  }
}
