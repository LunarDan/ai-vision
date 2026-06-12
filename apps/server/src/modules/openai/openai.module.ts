import { Module } from "@nestjs/common";
import { OpenaiService } from "./openai.service.js";

@Module({
  providers: [OpenaiService],
  exports: [OpenaiService],
})
export class OpenaiModule {}
