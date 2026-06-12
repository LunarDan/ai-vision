import { Injectable } from "@nestjs/common";
import type { EndSessionRequest, SessionMetrics } from "@ai-vision/shared";

@Injectable()
export class SessionService {
  async end(request: EndSessionRequest): Promise<SessionMetrics> {
    return {
      ...request.metrics,
      sessionId: request.sessionId,
      endedAt: new Date().toISOString(),
    };
  }
}
