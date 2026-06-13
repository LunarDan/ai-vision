import { Injectable } from "@nestjs/common";
import type {
  AnalyzeVisionRequest,
  AnalyzeVisionResponse,
  AnalyzeVisionSequenceRequest,
  AnalyzeVisionSequenceResponse,
} from "@ai-vision/shared";
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
    const summary = await this.openaiService.analyzeImage(request.imageBase64, request.detail).catch((error: unknown) => {
      return `视觉模型调用失败：${String(error instanceof Error ? error.message : error)}`;
    });

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

  async analyzeSequence(
    request: AnalyzeVisionSequenceRequest,
  ): Promise<AnalyzeVisionSequenceResponse> {
    const startedAt = Date.now();
    const timelineId = crypto.randomUUID();
    const sortedFrames = [...request.frames].sort(
      (left, right) =>
        new Date(left.capturedAt).getTime() - new Date(right.capturedAt).getTime(),
    );
    const startedFrameAt = sortedFrames[0]?.capturedAt ?? new Date().toISOString();
    const endedFrameAt =
      sortedFrames[sortedFrames.length - 1]?.capturedAt ?? startedFrameAt;

    const timeline = await this.openaiService
      .analyzeImageSequence(sortedFrames)
      .catch((error: unknown) => ({
        summary: `动作序列模型调用失败：${String(error instanceof Error ? error.message : error)}`,
        steps: [],
        confidenceNote: "模型调用失败，无法判断动作序列。",
      }));

    return {
      timeline: {
        id: timelineId,
        sessionId: request.sessionId,
        summary: timeline.summary,
        steps: timeline.steps,
        confidenceNote: timeline.confidenceNote,
        frameCount: request.sampledFrameCount,
        dedupedFrameCount: request.dedupedFrameCount,
        startedAt: startedFrameAt,
        endedAt: endedFrameAt,
        latencyMs: Date.now() - startedAt,
        createdAt: new Date().toISOString(),
      },
    };
  }
}
