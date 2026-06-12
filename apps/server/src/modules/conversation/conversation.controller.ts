import { Body, Controller, InternalServerErrorException, Post } from "@nestjs/common";
import type { ConversationRequest, ConversationResponse } from "@ai-vision/shared";
import { ConversationService } from "./conversation.service.js";

@Controller("conversation")
export class ConversationController {
  constructor(private readonly conversationService: ConversationService) {}

  @Post("respond")
  respond(@Body() body: ConversationRequest): Promise<ConversationResponse> {
    return this.conversationService.respond(body).catch((error: unknown) => {
      throw new InternalServerErrorException({
        code: "CONVERSATION_FAILED",
        message: String(error instanceof Error ? error.message : error),
      });
    });
  }
}
