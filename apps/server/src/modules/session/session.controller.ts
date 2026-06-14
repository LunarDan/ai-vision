import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import type {
  EndSessionRequest,
  SessionFinalFrameUrlResponse,
  SessionHistoryDetail,
  SessionHistoryListItem,
  SessionMetrics,
} from "@ai-vision/shared";
import { SessionService } from "./session.service.js";

@Controller("session")
export class SessionController {
  constructor(private readonly sessionService: SessionService) {}

  @Get("history")
  history(): Promise<SessionHistoryListItem[]> {
    return this.sessionService.listHistory();
  }

  @Get("history/:sessionId")
  historyDetail(
    @Param("sessionId") sessionId: string,
  ): Promise<SessionHistoryDetail> {
    return this.sessionService.getHistoryDetail(sessionId);
  }

  @Get("history/:sessionId/final-frame-url")
  finalFrameUrl(
    @Param("sessionId") sessionId: string,
  ): Promise<SessionFinalFrameUrlResponse> {
    return this.sessionService.getFinalFrameUrl(sessionId);
  }

  @Post("end")
  end(@Body() body: EndSessionRequest): Promise<SessionMetrics> {
    return this.sessionService.end(body);
  }
}
