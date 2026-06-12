import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { ConversationModule } from "./conversation/conversation.module.js";
import { RealtimeModule } from "./realtime/realtime.module.js";
import { SessionModule } from "./session/session.module.js";
import { VisionModule } from "./vision/vision.module.js";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ConversationModule,
    RealtimeModule,
    VisionModule,
    SessionModule,
  ],
})
export class AppModule {}
