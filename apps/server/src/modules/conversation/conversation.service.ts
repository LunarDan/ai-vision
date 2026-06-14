import { Injectable } from "@nestjs/common";
import type {
  ConversationRequest,
  ConversationResponse,
  ConversationStreamEvent,
  ConversationTurnContext,
  UsedVisionContext,
} from "@ai-vision/shared";
import { OpenaiService } from "../openai/openai.service.js";
import { ConversationHistoryService } from "./conversation-history.service.js";
import { VisionMemoryService } from "./vision-memory.service.js";

type PreparedConversation = {
  requestWithHistory: ConversationRequest;
  turnContext: Omit<ConversationTurnContext, "imageReference">;
  usedVisionContext: UsedVisionContext;
};

@Injectable()
export class ConversationService {
  constructor(
    private readonly openaiService: OpenaiService,
    private readonly historyService: ConversationHistoryService,
    private readonly visionMemoryService: VisionMemoryService,
  ) {}

  private async prepareConversation(
    request: ConversationRequest,
  ): Promise<PreparedConversation> {
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
    const turnContext = {
      visionSummary: resolvedContext.visionSummary,
      visionTimeline: resolvedContext.visionTimeline,
    };

    return {
      requestWithHistory,
      turnContext,
      usedVisionContext: resolvedContext.usedVisionContext,
    };
  }

  private recordCompletedTurn(
    request: ConversationRequest,
    reply: string,
    turnContext: Omit<ConversationTurnContext, "imageReference">,
  ) {
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
  }

  async respond(request: ConversationRequest): Promise<ConversationResponse> {
    const prepared = await this.prepareConversation(request);
    const reply = await this.openaiService.createConversationReply(
      prepared.requestWithHistory,
    );

    this.recordCompletedTurn(request, reply, prepared.turnContext);

    return {
      sessionId: request.sessionId,
      reply,
      createdAt: new Date().toISOString(),
      usedVisionContext: prepared.usedVisionContext,
    };
  }

  async streamRespond(
    request: ConversationRequest,
    onEvent: (event: ConversationStreamEvent) => void,
  ) {
    const prepared = await this.prepareConversation(request);
    onEvent({
      type: "meta",
      usedVisionContext: prepared.usedVisionContext,
    });

    let reply = "";
    for await (const delta of this.openaiService.streamConversationReply(
      prepared.requestWithHistory,
    )) {
      reply += delta;
      onEvent({ type: "delta", text: delta });
    }

    this.recordCompletedTurn(request, reply, prepared.turnContext);

    const createdAt = new Date().toISOString();
    onEvent({
      type: "done",
      reply,
      createdAt,
      usedVisionContext: prepared.usedVisionContext,
    });

    return {
      sessionId: request.sessionId,
      reply,
      createdAt,
      usedVisionContext: prepared.usedVisionContext,
    };
  }
}
