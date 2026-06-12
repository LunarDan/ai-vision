export type AssistantPhase = "idle" | "connecting" | "listening" | "thinking" | "speaking" | "error";

export type VisionDetail = "low" | "high";

export type CostMode = "balanced" | "economy" | "detail";

export interface VisionSummary {
  id: string;
  sessionId: string;
  summary: string;
  detail: VisionDetail;
  imageBytes: number;
  objectKey?: string;
  bucket?: string;
  contentType?: string;
  sha256?: string;
  latencyMs: number;
  createdAt: string;
}

export interface SessionMetrics {
  sessionId: string;
  audioSeconds: number;
  visionRequests: number;
  lowDetailRequests: number;
  highDetailRequests: number;
  uploadedImageBytes: number;
  startedAt: string;
  endedAt?: string;
}

export interface RealtimeSessionResponse {
  clientSecret: string;
  model: string;
  realtimeEndpoint: string;
  expiresAt?: number;
}

export type OmniClientEvent =
  | {
      type: "start";
      sessionId: string;
    }
  | {
      type: "audio";
      audioBase64: string;
      mimeType: string;
    }
  | {
      type: "vision_context";
      snapshot: VisionSummary;
    }
  | {
      type: "text";
      text: string;
    }
  | {
      type: "stop";
    };

export type OmniServerEvent =
  | {
      type: "ready";
      provider: "dashscope" | "fallback";
    }
  | {
      type: "text";
      text: string;
      final?: boolean;
    }
  | {
      type: "audio";
      audioBase64: string;
      mimeType: string;
    }
  | {
      type: "error";
      message: string;
    }
  | {
      type: "closed";
    };

export interface AnalyzeVisionRequest {
  sessionId: string;
  imageBase64: string;
  detail: VisionDetail;
  reason: "interval" | "manual" | "visual-question";
}

export interface AnalyzeVisionResponse {
  snapshot: VisionSummary;
}

export interface EndSessionRequest {
  sessionId: string;
  metrics: SessionMetrics;
}

export interface ConversationRequest {
  sessionId: string;
  text: string;
  visionSummary?: VisionSummary | null;
}

export interface ConversationResponse {
  sessionId: string;
  reply: string;
  createdAt: string;
}

export interface ApiErrorResponse {
  message: string;
  code: string;
}
