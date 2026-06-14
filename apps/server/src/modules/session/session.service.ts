import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import type {
  ConversationHistoryItem,
  EndSessionRequest,
  SessionFinalFrameUrlResponse,
  SessionHistoryDetail,
  SessionHistoryFrame,
  SessionHistoryListItem,
  SessionMetrics,
} from "@ai-vision/shared";
import { ConversationHistoryService } from "../conversation/conversation-history.service.js";
import { VisionMemoryService } from "../conversation/vision-memory.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { StorageService } from "../storage/storage.service.js";

const finalFrameReason = "session-final-frame";

@Injectable()
export class SessionService {
  private readonly logger = new Logger(SessionService.name);

  constructor(
    private readonly historyService: ConversationHistoryService,
    private readonly visionMemoryService: VisionMemoryService,
    private readonly prisma: PrismaService,
    private readonly storageService: StorageService,
  ) {}

  async end(request: EndSessionRequest): Promise<SessionMetrics> {
    const endedAt = new Date();
    const history = this.historyService.getHistory(request.sessionId);
    const finalFrame = await this.storeFinalFrame(request);

    await this.prisma.session.upsert({
      where: { id: request.sessionId },
      create: {
        id: request.sessionId,
        status: "ended",
        costMode: "balanced",
        startedAt: new Date(request.metrics.startedAt),
        endedAt,
      },
      update: {
        status: "ended",
        endedAt,
      },
    });

    await this.prisma.message.deleteMany({
      where: { sessionId: request.sessionId },
    });

    if (history.length) {
      await this.prisma.message.createMany({
        data: history.map((item) => ({
          id: item.id,
          sessionId: request.sessionId,
          role: item.role,
          content: item.content,
          createdAt: new Date(item.createdAt),
        })),
      });
    }

    await this.prisma.sessionMetric.upsert({
      where: { sessionId: request.sessionId },
      create: {
        sessionId: request.sessionId,
        audioSeconds: request.metrics.audioSeconds,
        visionRequests: request.metrics.visionRequests,
        lowDetailRequests: request.metrics.lowDetailRequests,
        highDetailRequests: request.metrics.highDetailRequests,
        uploadedImageBytes: request.metrics.uploadedImageBytes,
      },
      update: {
        audioSeconds: request.metrics.audioSeconds,
        visionRequests: request.metrics.visionRequests,
        lowDetailRequests: request.metrics.lowDetailRequests,
        highDetailRequests: request.metrics.highDetailRequests,
        uploadedImageBytes: request.metrics.uploadedImageBytes,
      },
    });

    if (finalFrame) {
      await this.prisma.visionSnapshot.create({
        data: {
          id: finalFrame.id,
          sessionId: request.sessionId,
          summary: "会话结束时保存的最后一帧画面。",
          detail: "low",
          imageBytes: finalFrame.imageBytes,
          objectKey: finalFrame.objectKey || null,
          bucket: finalFrame.bucket || null,
          contentType: finalFrame.contentType || null,
          sha256: finalFrame.sha256 || null,
          latencyMs: 0,
          reason: finalFrameReason,
          createdAt: new Date(finalFrame.createdAt),
        },
      });
    }

    this.historyService.clearSession(request.sessionId);
    this.visionMemoryService.clearSession(request.sessionId);

    return {
      ...request.metrics,
      sessionId: request.sessionId,
      endedAt: endedAt.toISOString(),
    };
  }

  async listHistory(): Promise<SessionHistoryListItem[]> {
    const sessions = await this.prisma.session.findMany({
      where: { status: "ended" },
      orderBy: { endedAt: "desc" },
      include: {
        metrics: true,
        messages: { select: { id: true } },
        snapshots: {
          where: { reason: finalFrameReason },
          orderBy: { createdAt: "desc" },
          take: 1,
        },
      },
    });

    return sessions.map((session) => ({
      sessionId: session.id,
      status: session.status,
      startedAt: session.startedAt.toISOString(),
      endedAt: session.endedAt?.toISOString() ?? null,
      messageCount: session.messages.length,
      finalFrame: this.toHistoryFrame(session.snapshots[0]),
      metrics: this.toSessionMetrics(session),
    }));
  }

  async getHistoryDetail(sessionId: string): Promise<SessionHistoryDetail> {
    const session = await this.prisma.session.findUnique({
      where: { id: sessionId },
      include: {
        metrics: true,
        messages: { orderBy: { createdAt: "asc" } },
        snapshots: {
          where: { reason: finalFrameReason },
          orderBy: { createdAt: "desc" },
          take: 1,
        },
      },
    });

    if (!session) {
      throw new NotFoundException({
        code: "SESSION_HISTORY_NOT_FOUND",
        message: "没有找到对应的历史会话。",
      });
    }

    return {
      sessionId: session.id,
      status: session.status,
      startedAt: session.startedAt.toISOString(),
      endedAt: session.endedAt?.toISOString() ?? null,
      messageCount: session.messages.length,
      finalFrame: this.toHistoryFrame(session.snapshots[0]),
      metrics: this.toSessionMetrics(session),
      messages: session.messages.map(
        (message): ConversationHistoryItem => ({
          id: message.id,
          sessionId: message.sessionId,
          role: message.role === "user" ? "user" : "assistant",
          content: message.content,
          createdAt: message.createdAt.toISOString(),
        }),
      ),
    };
  }

  async getFinalFrameUrl(
    sessionId: string,
  ): Promise<SessionFinalFrameUrlResponse> {
    const snapshot = await this.prisma.visionSnapshot.findFirst({
      where: { sessionId, reason: finalFrameReason },
      orderBy: { createdAt: "desc" },
    });

    if (!snapshot?.objectKey) {
      return { url: null, expiresInSeconds: 600 };
    }

    const expiresInSeconds = 600;
    const url = await this.storageService
      .getPresignedUrl(snapshot.objectKey, expiresInSeconds)
      .catch((error: unknown) => {
        this.logger.warn(`Cannot create final frame URL: ${String(error)}`);
        return null;
      });

    return { url, expiresInSeconds };
  }

  private async storeFinalFrame(request: EndSessionRequest) {
    if (!request.finalFrameImageBase64) return null;

    const snapshotId = crypto.randomUUID();
    const storedObject = await this.storageService
      .uploadVisionFrame({
        sessionId: request.sessionId,
        snapshotId,
        imageBase64: request.finalFrameImageBase64,
      })
      .catch((error: unknown) => {
        this.logger.warn(`Final frame upload failed: ${String(error)}`);
        return null;
      });

    if (!storedObject) return null;

    return {
      id: snapshotId,
      imageBytes: storedObject.bytes,
      objectKey: storedObject.objectKey,
      bucket: storedObject.bucket,
      contentType: storedObject.contentType,
      sha256: storedObject.sha256,
      createdAt: new Date().toISOString(),
    };
  }

  private toHistoryFrame(
    snapshot:
      | {
          id: string;
          objectKey: string | null;
          bucket: string | null;
          contentType: string | null;
          sha256: string | null;
          imageBytes: number;
          createdAt: Date;
        }
      | undefined,
  ): SessionHistoryFrame | null {
    if (!snapshot) return null;
    return {
      id: snapshot.id,
      objectKey: snapshot.objectKey,
      bucket: snapshot.bucket,
      contentType: snapshot.contentType,
      sha256: snapshot.sha256,
      imageBytes: snapshot.imageBytes,
      createdAt: snapshot.createdAt.toISOString(),
    };
  }

  private toSessionMetrics(session: {
    id: string;
    startedAt: Date;
    endedAt: Date | null;
    metrics: {
      audioSeconds: number;
      visionRequests: number;
      lowDetailRequests: number;
      highDetailRequests: number;
      uploadedImageBytes: number;
    } | null;
  }): SessionMetrics | null {
    if (!session.metrics) return null;
    return {
      sessionId: session.id,
      audioSeconds: session.metrics.audioSeconds,
      visionRequests: session.metrics.visionRequests,
      lowDetailRequests: session.metrics.lowDetailRequests,
      highDetailRequests: session.metrics.highDetailRequests,
      uploadedImageBytes: session.metrics.uploadedImageBytes,
      startedAt: session.startedAt.toISOString(),
      endedAt: session.endedAt?.toISOString(),
    };
  }
}
