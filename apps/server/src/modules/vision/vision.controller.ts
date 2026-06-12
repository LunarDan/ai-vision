import { Body, Controller, Post } from "@nestjs/common";
import type { AnalyzeVisionRequest, AnalyzeVisionResponse } from "@ai-vision/shared";
import { VisionService } from "./vision.service.js";

@Controller("vision")
export class VisionController {
  constructor(private readonly visionService: VisionService) {}

  @Post("analyze")
  analyze(@Body() body: AnalyzeVisionRequest): Promise<AnalyzeVisionResponse> {
    return this.visionService.analyze(body);
  }
}
