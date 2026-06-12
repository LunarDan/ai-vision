import { Module } from "@nestjs/common";
import { OpenaiModule } from "../openai/openai.module.js";
import { RealtimeController } from "./realtime.controller.js";
import { RealtimeService } from "./realtime.service.js";

@Module({
  imports: [OpenaiModule],
  controllers: [RealtimeController],
  providers: [RealtimeService],
})
export class RealtimeModule {}
