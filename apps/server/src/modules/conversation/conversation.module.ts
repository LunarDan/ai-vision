import { Module } from "@nestjs/common";
import { OpenaiModule } from "../openai/openai.module.js";
import { ConversationController } from "./conversation.controller.js";
import { ConversationHistoryService } from "./conversation-history.service.js";
import { ConversationService } from "./conversation.service.js";
import { VisionMemoryService } from "./vision-memory.service.js";

@Module({
  imports: [OpenaiModule],
  controllers: [ConversationController],
  providers: [ConversationHistoryService, ConversationService, VisionMemoryService],
  exports: [ConversationHistoryService, VisionMemoryService],
})
export class ConversationModule {}
