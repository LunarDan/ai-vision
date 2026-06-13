import { Module } from "@nestjs/common";
import { ConversationModule } from "../conversation/conversation.module.js";
import { SessionController } from "./session.controller.js";
import { SessionService } from "./session.service.js";

@Module({
  imports: [ConversationModule],
  controllers: [SessionController],
  providers: [SessionService],
})
export class SessionModule {}
