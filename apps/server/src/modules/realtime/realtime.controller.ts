import { Controller, InternalServerErrorException, Post } from "@nestjs/common";
import type { RealtimeSessionResponse } from "@ai-vision/shared";
import { RealtimeService } from "./realtime.service.js";

@Controller("realtime")
export class RealtimeController {
  constructor(private readonly realtimeService: RealtimeService) {}

  @Post("session")
  createSession(): Promise<RealtimeSessionResponse> {
    return this.realtimeService.createSession().catch((error: unknown) => {
      throw new InternalServerErrorException({
        code: "REALTIME_SESSION_FAILED",
        message: String(error instanceof Error ? error.message : error),
      });
    });
  }
}
