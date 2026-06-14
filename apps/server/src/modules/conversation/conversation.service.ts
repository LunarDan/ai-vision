import { Injectable } from "@nestjs/common";
import type { ConversationRequest, ConversationResponse } from "@ai-vision/shared";
import { OpenaiService } from "../openai/openai.service.js";
import { ConversationHistoryService } from "./conversation-history.service.js";
import { VisionMemoryService } from "./vision-memory.service.js";

@Injectable()
export class ConversationService {
  constructor(
    private readonly openaiService: OpenaiService,
    private readonly historyService: ConversationHistoryService,
    private readonly visionMemoryService: VisionMemoryService,
  ) {}

  async respond(request: ConversationRequest): Promise<ConversationResponse> {
    const waitedForFreshVision =
      await this.visionMemoryService.waitForFreshContext(request.sessionId);
    const resolvedContext = this.visionMemoryService.resolveContext(
      request.sessionId,
      request,
      waitedForFreshVision,
    );
    const history = this.historyService.getHistory(request.sessionId);
    const requestWithHistory = {
      ...request,
      history,
      visionSummary: resolvedContext.visionSummary,
      visionTimeline: resolvedContext.visionTimeline,
    };
    const reply = await this.openaiService.createConversationReply(requestWithHistory);
    const turnContext = {
      visionSummary: resolvedContext.visionSummary,
      visionTimeline: resolvedContext.visionTimeline,
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
      usedVisionContext: resolvedContext.usedVisionContext,
    };
  }
}
