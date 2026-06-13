import { Body, Controller, Post } from "@nestjs/common";
import type {
  AnalyzeVisionRequest,
  AnalyzeVisionResponse,
  AnalyzeVisionSequenceRequest,
  AnalyzeVisionSequenceResponse,
} from "@ai-vision/shared";
import { VisionService } from "./vision.service.js";

@Controller("vision")
export class VisionController {
  constructor(private readonly visionService: VisionService) {}

  @Post("analyze")
  analyze(@Body() body: AnalyzeVisionRequest): Promise<AnalyzeVisionResponse> {
    return this.visionService.analyze(body);
  }

  @Post("analyze-sequence")
  analyzeSequence(
    @Body() body: AnalyzeVisionSequenceRequest,
  ): Promise<AnalyzeVisionSequenceResponse> {
    return this.visionService.analyzeSequence(body);
  }
}
