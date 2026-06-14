export type AssistantPhase = "idle" | "connecting" | "listening" | "thinking" | "speaking" | "error";

export type VisionDetail = "low" | "high";

export type CostMode = "balanced" | "economy" | "detail";

export type SceneMode = "general" | "action" | "study" | "interview" | "life";

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

export interface UsedVisionContext {
  visionSummaryAt?: string | null;
  visionTimelineAt?: string | null;
  waitedForFreshVision: boolean;
  source: "server-memory" | "request-cache" | "none";
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
      sceneMode?: SceneMode;
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
      usedVisionContext?: UsedVisionContext;
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
      type: "vision_memory_status";
      visualContextFreshness: "fresh" | "stale" | "missing";
      analyzing: boolean;
      visionSummaryAt?: string | null;
      visionTimelineAt?: string | null;
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
  sceneMode?: SceneMode;
  visionSummary?: VisionSummary | null;
  visionTimeline?: VisionActionTimeline | null;
  history?: ConversationHistoryItem[];
}

export interface ConversationResponse {
  sessionId: string;
  reply: string;
  createdAt: string;
  usedVisionContext?: UsedVisionContext;
}

export interface ApiErrorResponse {
  message: string;
  code: string;
}
