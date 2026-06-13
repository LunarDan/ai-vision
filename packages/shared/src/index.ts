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

export interface VisionSequenceFrame {
  id: string;
  imageBase64: string;
  capturedAt: string;
  offsetMs: number;
}

export interface VisionActionStep {
  timeRange: string;
  description: string;
}

export interface VisionActionTimeline {
  id: string;
  sessionId: string;
  summary: string;
  steps: VisionActionStep[];
  confidenceNote: string;
  frameCount: number;
  dedupedFrameCount: number;
  startedAt: string;
  endedAt: string;
  latencyMs: number;
  createdAt: string;
}

export interface ConversationImageReference {
  objectKey?: string;
  bucket?: string;
  contentType?: string;
  sha256?: string;
}

export interface ConversationTurnContext {
  visionSummary?: VisionSummary | null;
  visionTimeline?: VisionActionTimeline | null;
  imageReference?: ConversationImageReference | null;
}

export interface ConversationHistoryItem {
  id: string;
  sessionId: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  context?: ConversationTurnContext | null;
}

export interface VideoStreamFrame {
  id: string;
  imageBase64: string;
  capturedAt: string;
  fingerprint: number[];
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
      type: "video_frame";
      frame: VideoStreamFrame;
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
      type: "video_summary";
      snapshot: VisionSummary;
    }
  | {
      type: "action_timeline";
      timeline: VisionActionTimeline;
    }
    | {
        type: "video_status";
        receivedFrames: number;
        bufferedFrames: number;
        cloudAnalyses: number;
        timelineAnalyses: number;
        timelineErrors: number;
        lastTimelineAt?: string | null;
        lastError?: string | null;
        updatedAt: string;
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

export interface AnalyzeVisionSequenceRequest {
  sessionId: string;
  frames: VisionSequenceFrame[];
  sampledFrameCount: number;
  dedupedFrameCount: number;
}

export interface AnalyzeVisionSequenceResponse {
  timeline: VisionActionTimeline;
}

export interface EndSessionRequest {
  sessionId: string;
  metrics: SessionMetrics;
}

export interface ConversationRequest {
  sessionId: string;
  text: string;
  visionSummary?: VisionSummary | null;
  visionTimeline?: VisionActionTimeline | null;
  history?: ConversationHistoryItem[];
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
