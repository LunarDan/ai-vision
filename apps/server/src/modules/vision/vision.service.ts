import { Injectable } from "@nestjs/common";
import type { AnalyzeVisionRequest, AnalyzeVisionResponse } from "@ai-vision/shared";
import { OpenaiService } from "../openai/openai.service.js";
import { StorageService } from "../storage/storage.service.js";

@Injectable()
export class VisionService {
  constructor(
    private readonly openaiService: OpenaiService,
    private readonly storageService: StorageService,
  ) {}

  async analyze(request: AnalyzeVisionRequest): Promise<AnalyzeVisionResponse> {
    const startedAt = Date.now();
    const snapshotId = crypto.randomUUID();
    const storedObject = await this.storageService.uploadVisionFrame({
      sessionId: request.sessionId,
      snapshotId,
      imageBase64: request.imageBase64,
    });
    const summary = await this.openaiService.analyzeImage(request.imageBase64, request.detail);

    return {
      snapshot: {
        id: snapshotId,
        sessionId: request.sessionId,
        summary,
        detail: request.detail,
        imageBytes: storedObject.bytes,
        objectKey: storedObject.objectKey,
        bucket: storedObject.bucket,
        contentType: storedObject.contentType,
        sha256: storedObject.sha256,
        latencyMs: Date.now() - startedAt,
        createdAt: new Date().toISOString(),
      },
    };
  }
}
