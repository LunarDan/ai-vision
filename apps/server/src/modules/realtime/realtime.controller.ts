import { Controller, Post } from "@nestjs/common";
import type { RealtimeSessionResponse } from "@ai-vision/shared";
import { RealtimeService } from "./realtime.service.js";

@Controller("realtime")
export class RealtimeController {
  constructor(private readonly realtimeService: RealtimeService) {}

  @Post("session")
  createSession(): Promise<RealtimeSessionResponse> {
    return this.realtimeService.createSession();
  }
}
