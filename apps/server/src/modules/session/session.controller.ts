import { Body, Controller, Post } from "@nestjs/common";
import type { EndSessionRequest, SessionMetrics } from "@ai-vision/shared";
import { SessionService } from "./session.service.js";

@Controller("session")
export class SessionController {
  constructor(private readonly sessionService: SessionService) {}

  @Post("end")
  end(@Body() body: EndSessionRequest): Promise<SessionMetrics> {
    return this.sessionService.end(body);
  }
}
