import { Module } from "@nestjs/common";
import { OpenaiModule } from "../openai/openai.module.js";
import { ConversationController } from "./conversation.controller.js";
import { ConversationService } from "./conversation.service.js";

@Module({
  imports: [OpenaiModule],
  controllers: [ConversationController],
  providers: [ConversationService],
})
export class ConversationModule {}
