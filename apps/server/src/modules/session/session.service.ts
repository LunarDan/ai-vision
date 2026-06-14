import { Injectable } from "@nestjs/common";
import type { EndSessionRequest, SessionMetrics } from "@ai-vision/shared";
import { ConversationHistoryService } from "../conversation/conversation-history.service.js";
import { VisionMemoryService } from "../conversation/vision-memory.service.js";

@Injectable()
export class SessionService {
  constructor(
    private readonly historyService: ConversationHistoryService,
    private readonly visionMemoryService: VisionMemoryService,
  ) {}

  async end(request: EndSessionRequest): Promise<SessionMetrics> {
    this.historyService.clearSession(request.sessionId);
    this.visionMemoryService.clearSession(request.sessionId);

    return {
      ...request.metrics,
      sessionId: request.sessionId,
      endedAt: new Date().toISOString(),
    };
  }
}
