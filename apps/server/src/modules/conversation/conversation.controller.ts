import {
  Body,
  Controller,
  InternalServerErrorException,
  Post,
  Res,
} from "@nestjs/common";
import type {
  ConversationRequest,
  ConversationResponse,
  ConversationStreamEvent,
} from "@ai-vision/shared";
import { ConversationService } from "./conversation.service.js";

type StreamResponse = {
  setHeader: (name: string, value: string) => void;
  write: (chunk: string) => void;
  end: () => void;
  flushHeaders?: () => void;
};

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

  @Post("respond-stream")
  async respondStream(
    @Body() body: ConversationRequest,
    @Res() response: StreamResponse,
  ) {
    response.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    response.setHeader("Cache-Control", "no-cache, no-transform");
    response.setHeader("Connection", "keep-alive");
    response.flushHeaders?.();

    const sendEvent = (event: ConversationStreamEvent) => {
      response.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    try {
      await this.conversationService.streamRespond(body, sendEvent);
    } catch (error) {
      sendEvent({
        type: "error",
        message: String(error instanceof Error ? error.message : error),
      });
    } finally {
      response.end();
    }
  }
}
