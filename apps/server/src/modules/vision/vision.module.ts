import { Module } from "@nestjs/common";
import { OpenaiModule } from "../openai/openai.module.js";
import { StorageModule } from "../storage/storage.module.js";
import { VisionController } from "./vision.controller.js";
import { VisionService } from "./vision.service.js";

@Module({
  imports: [OpenaiModule, StorageModule],
  controllers: [VisionController],
  providers: [VisionService],
})
export class VisionModule {}
