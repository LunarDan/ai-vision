import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { RealtimeModule } from "./realtime/realtime.module.js";
import { SessionModule } from "./session/session.module.js";
import { VisionModule } from "./vision/vision.module.js";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    RealtimeModule,
    VisionModule,
    SessionModule,
  ],
})
export class AppModule {}
