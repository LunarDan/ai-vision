import { Injectable } from "@nestjs/common";
import type { ConversationRequest, ConversationResponse } from "@ai-vision/shared";
import { OpenaiService } from "../openai/openai.service.js";
import { ConversationHistoryService } from "./conversation-history.service.js";

@Injectable()
export class ConversationService {
  constructor(
    private readonly openaiService: OpenaiService,
    private readonly historyService: ConversationHistoryService,
  ) {}

  async respond(request: ConversationRequest): Promise<ConversationResponse> {
    const history = this.historyService.getHistory(request.sessionId);
    const requestWithHistory = { ...request, history };
    const reply = await this.openaiService.createConversationReply(requestWithHistory);
    const turnContext = {
      visionSummary: request.visionSummary ?? null,
      visionTimeline: request.visionTimeline ?? null,
    };

    this.historyService.recordUserTurn(
      request.sessionId,
      request.text,
      turnContext,
    );
    this.historyService.recordAssistantTurn(request.sessionId, reply, {
      ...turnContext,
      imageReference:
        this.historyService.getHistory(request.sessionId).at(-1)?.context
          ?.imageReference ?? null,
    });

    return {
      sessionId: request.sessionId,
      reply,
      createdAt: new Date().toISOString(),
    };
  }
}
