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
  expiresAt?: number;
}

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

export interface ApiErrorResponse {
  message: string;
  code: string;
}
