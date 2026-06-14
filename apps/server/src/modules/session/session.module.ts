import { Module } from "@nestjs/common";
import { ConversationModule } from "../conversation/conversation.module.js";
import { PrismaModule } from "../prisma/prisma.module.js";
import { StorageModule } from "../storage/storage.module.js";
import { SessionController } from "./session.controller.js";
import { SessionService } from "./session.service.js";

@Module({
  imports: [ConversationModule, PrismaModule, StorageModule],
  controllers: [SessionController],
  providers: [SessionService],
})
export class SessionModule {}
