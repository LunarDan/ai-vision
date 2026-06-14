import {
  Activity,
  AlertTriangle,
  Camera,
  CheckCircle2,
  CircleStop,
  Eye,
  Mic,
  MicOff,
  PhoneCall,
  Radio,
  MessageCircle,
  RotateCcw,
  ScanEye,
  Send,
  Sparkles,
  Video,
  VideoOff,
  Volume2,
  Wifi,
  XCircle,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, KeyboardEvent } from "react";
import type {
  AssistantPhase,
  BuiltInSceneMode,
  ConversationResponse,
  ConversationStreamEvent,
  CustomSceneModeProfile,
  OmniServerEvent,
  SceneMode,
  SessionFinalFrameUrlResponse,
  SessionHistoryDetail,
  SessionHistoryListItem,
  SessionMetrics,
  UsedVisionContext,
  VideoStreamFrame,
  VisionActionTimeline,
  VisionSummary,
} from "@ai-vision/shared";
import { Alert } from "./components/ui/alert.js";
import { Badge } from "./components/ui/badge.js";
import { Button } from "./components/ui/button.js";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "./components/ui/card.js";
import { Separator } from "./components/ui/separator.js";
import { Tabs, TabsList, TabsTrigger } from "./components/ui/tabs.js";
import { appCopy, phaseLabels, sceneModeCopy } from "./copy.js";

const apiBase = "/api";
const defaultAutoObserveIntervalMs = 10000;
const slowAutoObserveIntervalMs = 25000;
const staleVisionContextMs = 30000;
const maxAutoVisionRequestsPerMinute = 6;
const frameDiffThreshold = 10;
const stableFrameSlowdownThreshold = 3;
const actionSampleIntervalMs = 500;
const actionWindowMs = 12000;
const actionAnalyzeIntervalMs = 6000;
const actionTimelineStaleMs = 10000;
const maxActionFrames = 24;
const maxSequenceFrames = 8;
const actionFrameDiffThreshold = 4;
const minActionFramesForSequence = 2;
const actionFrameWidth = 384;
const actionFrameQuality = 0.5;
const actionQuestionBurstFrames = 6;
const customSceneModesStorageKey = "ai-vision.customSceneModes.v1";
const selectedCustomSceneModeStorageKey = "ai-vision.selectedCustomSceneMode.v1";
const speechRateStorageKey = "ai-vision.speechRate.v1";
const maxCustomSceneModes = 5;
const minSpeechRate = 0.5;
const maxSpeechRate = 3;
const defaultSpeechRate = 1;

type TimelineMessage = {
  id: string;
  role: "assistant" | "system" | "user";
  content: string;
};

type VisionContextSyncState = "idle" | "pending" | "synced" | "failed";
type BackendStatus = "unknown" | "online" | "offline";
type VideoStreamStatus = "idle" | "connecting" | "connected" | "fallback";
type AssistantReplyPayload = {
  reply: string;
  usedVisionContext?: UsedVisionContext;
};

const sceneModeOptions = Object.entries(sceneModeCopy) as Array<
  [BuiltInSceneMode, (typeof sceneModeCopy)[BuiltInSceneMode]]
>;
const normalizeSceneMode = (value: string): SceneMode =>
  value === "custom" || value in sceneModeCopy
    ? (value as SceneMode)
    : "general";

type CustomSceneModeDraft = Omit<CustomSceneModeProfile, "id"> & {
  id?: string;
};

const createEmptyCustomModeDraft = (): CustomSceneModeDraft => ({
  label: "",
  description: "",
  role: "",
  mission: "",
  style: "",
  focus: [],
  examples: [],
  nextSteps: [],
  guardrail: "",
});

const trimText = (value: string, maxLength: number) =>
  value.trim().slice(0, maxLength);

const clampSpeechRate = (value: number) =>
  Math.min(maxSpeechRate, Math.max(minSpeechRate, value));

const parseStoredSpeechRate = () => {
  const storedRate = Number(window.localStorage.getItem(speechRateStorageKey));
  return Number.isFinite(storedRate)
    ? clampSpeechRate(storedRate)
    : defaultSpeechRate;
};

const normalizeList = (items: string[]) =>
  items
    .flatMap((item) => item.split("\n"))
    .map((item) => trimText(item, 40))
    .filter(Boolean)
    .slice(0, 5);

const sanitizeCustomSceneMode = (
  draft: CustomSceneModeDraft,
): CustomSceneModeProfile => ({
  id: draft.id || crypto.randomUUID(),
  label: trimText(draft.label, 20) || "自定义模式",
  description: trimText(draft.description, 120) || "用户自定义场景",
  role: trimText(draft.role, 120) || "你是用户自定义的视觉对话助手。",
  mission: trimText(draft.mission, 120) || "根据用户指定的场景目标理解画面并回答问题。",
  style: trimText(draft.style, 120) || "回答自然、简短、具体。",
  focus: normalizeList(draft.focus),
  examples: normalizeList(draft.examples),
  nextSteps: normalizeList(draft.nextSteps),
  guardrail: trimText(draft.guardrail, 120) || "不确定时要说明限制，不要编造看不清的内容。",
});

const parseStoredCustomSceneModes = () => {
  try {
    const raw = window.localStorage.getItem(customSceneModesStorageKey);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as CustomSceneModeProfile[];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => sanitizeCustomSceneMode(item))
      .slice(0, maxCustomSceneModes);
  } catch {
    return [];
  }
};

type CameraDiagnostics = {
  label: string;
  width: number;
  height: number;
  readyState: MediaStreamTrackState;
  muted: boolean;
  enabled: boolean;
};

type CapturedFrame = {
  imageBase64: string;
  fingerprint: number[];
};

type ActionFrame = CapturedFrame & {
  id: string;
  capturedAt: string;
};

type MediaStreamResult = {
  stream: MediaStream;
  hasAudio: boolean;
  audioError?: unknown;
};

type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  onresult:
    | ((event: {
        results: ArrayLike<{ 0: { transcript: string }; isFinal: boolean }>;
      }) => void)
    | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
};

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

const createInitialMetrics = (sessionId: string): SessionMetrics => ({
  sessionId,
  audioSeconds: 0,
  visionRequests: 0,
  lowDetailRequests: 0,
  highDetailRequests: 0,
  uploadedImageBytes: 0,
  startedAt: new Date().toISOString(),
});

const getSpeechRecognition = () => {
  const windowWithSpeech = window as Window &
    typeof globalThis & {
      SpeechRecognition?: SpeechRecognitionConstructor;
      webkitSpeechRecognition?: SpeechRecognitionConstructor;
    };
  return (
    windowWithSpeech.SpeechRecognition ??
    windowWithSpeech.webkitSpeechRecognition
  );
};

export const App = () => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const timelineRef = useRef<HTMLDivElement>(null);
  const typedQuestionInputRef = useRef<HTMLTextAreaElement>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const recognitionRestartTimerRef = useRef<number | null>(null);
  const shouldKeepListeningRef = useRef(false);
  const backendStatusRef = useRef<BackendStatus>("unknown");
  const mediaSessionActiveRef = useRef(false);
  const streamRef = useRef<MediaStream | null>(null);
  const phaseRef = useRef<AssistantPhase>("idle");
  const cameraEnabledRef = useRef(false);
  const videoReadyRef = useRef(false);
  const visionSummaryRef = useRef<VisionSummary | null>(null);
  const autoObserveEnabledRef = useRef(true);
  const autoObserveTimerRef = useRef<number | null>(null);
  const autoVisionTimestampsRef = useRef<number[]>([]);
  const lastFrameFingerprintRef = useRef<number[] | null>(null);
  const stableFrameCountRef = useRef(0);
  const visionRequestInFlightRef = useRef(false);
  const actionFramesRef = useRef<ActionFrame[]>([]);
  const actionSampleTimerRef = useRef<number | null>(null);
  const actionAnalyzeTimerRef = useRef<number | null>(null);
  const lastActionFingerprintRef = useRef<number[] | null>(null);
  const actionSequenceInFlightRef = useRef(false);
  const lastActionTimelineRef = useRef<VisionActionTimeline | null>(null);
  const actionSampleCountRef = useRef(0);
  const dedupedActionFrameCountRef = useRef(0);
  const actionAnalyzeErrorNotifiedRef = useRef(false);
  const videoStreamSocketRef = useRef<WebSocket | null>(null);
  const videoStreamStatusRef = useRef<VideoStreamStatus>("idle");
  const videoStreamReplyResolverRef = useRef<
    ((reply: AssistantReplyPayload | null) => void) | null
  >(null);
  const lastVideoStreamErrorAtRef = useRef(0);
  const currentUtteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const speechFallbackTimerRef = useRef<number | null>(null);
  const replyStreamAbortRef = useRef<AbortController | null>(null);
  const [videoElement, setVideoElement] = useState<HTMLVideoElement | null>(
    null,
  );
  const [phase, setPhase] = useState<AssistantPhase>("idle");
  const [sessionId, setSessionId] = useState(() => crypto.randomUUID());
  const [sceneMode, setSceneMode] = useState<SceneMode>("general");
  const [customSceneModes, setCustomSceneModes] = useState<
    CustomSceneModeProfile[]
  >(() => parseStoredCustomSceneModes());
  const [selectedCustomSceneModeId, setSelectedCustomSceneModeId] = useState(
    () =>
      window.localStorage.getItem(selectedCustomSceneModeStorageKey) ?? "",
  );
  const [customSceneDraft, setCustomSceneDraft] =
    useState<CustomSceneModeDraft>(() => createEmptyCustomModeDraft());
  const [metrics, setMetrics] = useState(() => createInitialMetrics(sessionId));
  const [cameraEnabled, setCameraEnabled] = useState(false);
  const [micEnabled, setMicEnabled] = useState(true);
  const [videoReady, setVideoReady] = useState(false);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [cameraDevices, setCameraDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedCameraDeviceId, setSelectedCameraDeviceId] = useState("");
  const [cameraDiagnostics, setCameraDiagnostics] =
    useState<CameraDiagnostics | null>(null);
  const [backendStatus, setBackendStatus] = useState<BackendStatus>("unknown");
  const [videoStreamStatus, setVideoStreamStatus] =
    useState<VideoStreamStatus>("idle");
  const [streamedVideoFrameCount, setStreamedVideoFrameCount] = useState(0);
  const [videoStreamCloudAnalyses, setVideoStreamCloudAnalyses] = useState(0);
  const [videoStreamTimelineAnalyses, setVideoStreamTimelineAnalyses] =
    useState(0);
  const [videoStreamTimelineErrors, setVideoStreamTimelineErrors] = useState(0);
  const [videoStreamBufferedFrames, setVideoStreamBufferedFrames] = useState(0);
  const [lastVideoStreamAt, setLastVideoStreamAt] = useState<string | null>(
    null,
  );
  const [lastVideoStreamError, setLastVideoStreamError] = useState<string | null>(
    null,
  );
  const [autoObserveEnabled, setAutoObserveEnabled] = useState(true);
  const [autoObserveIntervalMs] = useState(defaultAutoObserveIntervalMs);
  const [lastAutoVisionAt, setLastAutoVisionAt] = useState<string | null>(null);
  const [lastFrameFingerprint, setLastFrameFingerprint] = useState<
    number[] | null
  >(null);
  const [autoVisionRequestCount, setAutoVisionRequestCount] = useState(0);
  const [skippedFrameCount, setSkippedFrameCount] = useState(0);
  const [actionFrames, setActionFrames] = useState<ActionFrame[]>([]);
  const [lastActionTimeline, setLastActionTimeline] =
    useState<VisionActionTimeline | null>(null);
  const [actionSampleCount, setActionSampleCount] = useState(0);
  const [dedupedActionFrameCount, setDedupedActionFrameCount] = useState(0);
  const [actionSequenceRequestCount, setActionSequenceRequestCount] =
    useState(0);
  const [lastActionTimelineAt, setLastActionTimelineAt] = useState<
    string | null
  >(null);
  const [visionSummary, setVisionSummary] = useState<VisionSummary | null>(
    null,
  );
  const [visionContextSyncState, setVisionContextSyncState] =
    useState<VisionContextSyncState>("idle");
  const [visionContextSyncedAt, setVisionContextSyncedAt] = useState<
    string | null
  >(null);
  const [visualContextFreshness, setVisualContextFreshness] = useState<
    "fresh" | "stale" | "missing"
  >("missing");
  const [waitingForFreshVision, setWaitingForFreshVision] = useState(false);
  const [replyContextTimestamp, setReplyContextTimestamp] = useState<
    string | null
  >(null);
  const [replyGenerationId, setReplyGenerationId] = useState(0);
  const [visionUpdatedDuringReply, setVisionUpdatedDuringReply] = useState(false);
  const [typedQuestion, setTypedQuestion] = useState("");
  const [speechRate, setSpeechRate] = useState(() => parseStoredSpeechRate());
  const [lastAssistantReply, setLastAssistantReply] = useState("");
  const [lastHeardText, setLastHeardText] = useState("");
  const [voiceStatusHint, setVoiceStatusHint] = useState<string>(
    appCopy.voiceHintIdle,
  );
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const [sessionHistory, setSessionHistory] = useState<SessionHistoryListItem[]>(
    [],
  );
  const [selectedHistory, setSelectedHistory] =
    useState<SessionHistoryDetail | null>(null);
  const [selectedHistoryFrameUrl, setSelectedHistoryFrameUrl] = useState<
    string | null
  >(null);
  const [debugPanelOpen, setDebugPanelOpen] = useState(false);
  const [messages, setMessages] = useState<TimelineMessage[]>([
    {
      id: crypto.randomUUID(),
      role: "assistant",
      content: appCopy.initialAssistantMessage,
    },
  ]);
  const isInterruptible = phase === "speaking" || phase === "thinking";

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  useEffect(() => {
    window.localStorage.setItem(speechRateStorageKey, speechRate.toFixed(1));
  }, [speechRate]);

  useEffect(() => {
    if (lastHeardText && (phase === "thinking" || phase === "speaking")) {
      return;
    }

    if (phase === "listening") {
      setVoiceStatusHint(appCopy.voiceHintListening);
    } else if (phase === "thinking") {
      setVoiceStatusHint(appCopy.voiceHintThinking);
    } else if (phase === "speaking") {
      setVoiceStatusHint(appCopy.voiceHintSpeaking);
    } else if (phase === "error") {
      setVoiceStatusHint(appCopy.voiceHintError);
    } else {
      setVoiceStatusHint(appCopy.voiceHintIdle);
    }
  }, [lastHeardText, phase]);

  useEffect(() => {
    backendStatusRef.current = backendStatus;
  }, [backendStatus]);

  useEffect(() => {
    autoObserveEnabledRef.current = autoObserveEnabled;
  }, [autoObserveEnabled]);

  useEffect(() => {
    videoStreamStatusRef.current = videoStreamStatus;
  }, [videoStreamStatus]);

  useEffect(() => {
    streamRef.current = stream;
  }, [stream]);

  useEffect(() => {
    cameraEnabledRef.current = cameraEnabled;
  }, [cameraEnabled]);

  useEffect(() => {
    videoReadyRef.current = videoReady;
  }, [videoReady]);

  useEffect(() => {
    visionSummaryRef.current = visionSummary;
  }, [visionSummary]);

  useEffect(() => {
    window.localStorage.setItem(
      customSceneModesStorageKey,
      JSON.stringify(customSceneModes.slice(0, maxCustomSceneModes)),
    );
    const selectedExists = customSceneModes.some(
      (mode) => mode.id === selectedCustomSceneModeId,
    );
    if (!selectedExists && customSceneModes[0]) {
      setSelectedCustomSceneModeId(customSceneModes[0].id);
    }
    if (!selectedExists && customSceneModes.length === 0) {
      setSelectedCustomSceneModeId("");
      if (sceneMode === "custom") {
        setCustomSceneDraft(createEmptyCustomModeDraft());
      }
    }
  }, [customSceneModes, sceneMode, selectedCustomSceneModeId]);

  useEffect(() => {
    window.localStorage.setItem(
      selectedCustomSceneModeStorageKey,
      selectedCustomSceneModeId,
    );
  }, [selectedCustomSceneModeId]);

  useEffect(() => {
    const selected = customSceneModes.find(
      (mode) => mode.id === selectedCustomSceneModeId,
    );
    if (selected) {
      setCustomSceneDraft(selected);
    }
  }, [customSceneModes, selectedCustomSceneModeId]);

  useEffect(() => {
    const timeline = timelineRef.current;
    if (!timeline) return;
    timeline.scrollTo({ top: timeline.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const costLevel = useMemo(() => {
    if (metrics.highDetailRequests > 3 || metrics.visionRequests > 20)
      return appCopy.costLevels.high;
    if (metrics.visionRequests > 8) return appCopy.costLevels.medium;
    return appCopy.costLevels.low;
  }, [metrics.highDetailRequests, metrics.visionRequests]);

  const videoStreamStatusLabel =
    videoStreamStatus === "connected"
      ? appCopy.videoStreamConnected
      : videoStreamStatus === "connecting"
        ? appCopy.videoStreamConnecting
        : videoStreamStatus === "fallback"
          ? appCopy.videoStreamFallback
          : appCopy.videoStreamIdle;

  const bindVideoElement = useCallback((node: HTMLVideoElement | null) => {
    videoRef.current = node;
    setVideoElement(node);
  }, []);

  const refreshCameraDevices = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return;

    const devices = await navigator.mediaDevices.enumerateDevices();
    const videoInputs = devices.filter(
      (device) => device.kind === "videoinput",
    );
    setCameraDevices(videoInputs);
    setSelectedCameraDeviceId(
      (current) => current || videoInputs[0]?.deviceId || "",
    );
  }, []);

  const updateCameraDiagnostics = useCallback(
    (mediaStream: MediaStream, video?: HTMLVideoElement | null) => {
      const track = mediaStream.getVideoTracks()[0];
      if (!track) {
        setCameraDiagnostics(null);
        return;
      }

      const settings = track.getSettings();
      setCameraDiagnostics({
        label: track.label || appCopy.unknownCamera,
        width: video?.videoWidth || settings.width || 0,
        height: video?.videoHeight || settings.height || 0,
        readyState: track.readyState,
        muted: track.muted,
        enabled: track.enabled,
      });
    },
    [],
  );

  useEffect(() => {
    if (!videoElement || !stream) {
      setVideoReady(false);
      setCameraDiagnostics(null);
      return;
    }

    const videoTrack = stream.getVideoTracks()[0];
    let cancelled = false;
    const playVideo = async () => {
      try {
        await videoElement.play();
        if (
          !cancelled &&
          videoElement.videoWidth > 0 &&
          videoElement.videoHeight > 0
        ) {
          setVideoReady(true);
          updateCameraDiagnostics(stream, videoElement);
        }
      } catch {
        if (!cancelled) {
          appendSystemMessage(appCopy.cameraPlaybackError);
        }
      }
    };
    const markReady = () => {
      const isReady =
        videoElement.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
        videoElement.videoWidth > 0 &&
        videoElement.videoHeight > 0;
      videoReadyRef.current = isReady;
      setVideoReady(isReady);
      updateCameraDiagnostics(stream, videoElement);
    };
    const frameTimer = window.setTimeout(() => {
      if (
        !cancelled &&
        (!videoElement.videoWidth || !videoElement.videoHeight)
      ) {
        appendSystemMessage(appCopy.cameraFrameWaiting);
      }
    }, 2500);
    const updateFromTrack = () => updateCameraDiagnostics(stream, videoElement);

    videoElement.srcObject = stream;
    videoElement.muted = true;
    videoElement.playsInline = true;
    videoElement.addEventListener("loadedmetadata", playVideo);
    videoElement.addEventListener("loadeddata", markReady);
    videoElement.addEventListener("canplay", markReady);
    videoElement.addEventListener("playing", markReady);
    videoTrack?.addEventListener("mute", updateFromTrack);
    videoTrack?.addEventListener("unmute", updateFromTrack);
    videoTrack?.addEventListener("ended", updateFromTrack);
    updateCameraDiagnostics(stream, videoElement);
    void playVideo();

    return () => {
      cancelled = true;
      window.clearTimeout(frameTimer);
      videoElement.removeEventListener("loadedmetadata", playVideo);
      videoElement.removeEventListener("loadeddata", markReady);
      videoElement.removeEventListener("canplay", markReady);
      videoElement.removeEventListener("playing", markReady);
      videoTrack?.removeEventListener("mute", updateFromTrack);
      videoTrack?.removeEventListener("unmute", updateFromTrack);
      videoTrack?.removeEventListener("ended", updateFromTrack);
      if (videoElement.srcObject === stream) {
        videoElement.srcObject = null;
      }
    };
  }, [stream, videoElement, updateCameraDiagnostics]);

  const appendMessage = (message: Omit<TimelineMessage, "id">) => {
    const id = crypto.randomUUID();
    setMessages((items) => [...items, { ...message, id }]);
    return id;
  };

  const appendSystemMessage = (content: string) =>
    appendMessage({ role: "system", content });
  const appendAssistantMessage = (content: string) =>
    appendMessage({ role: "assistant", content });
  const updateMessageContent = (id: string, content: string) => {
    setMessages((items) =>
      items.map((item) => (item.id === id ? { ...item, content } : item)),
    );
  };

  const resetConversationState = () => {
    const nextSessionId = crypto.randomUUID();
    setSessionId(nextSessionId);
    setMetrics(createInitialMetrics(nextSessionId));
    setMessages([
      {
        id: crypto.randomUUID(),
        role: "assistant",
        content: appCopy.initialAssistantMessage,
      },
    ]);
    setVisionSummary(null);
    visionSummaryRef.current = null;
    setVisionContextSyncState("idle");
    setVisionContextSyncedAt(null);
    setVisualContextFreshness("missing");
    setReplyContextTimestamp(null);
    setVisionUpdatedDuringReply(false);
    setTypedQuestion("");
    setLastAssistantReply("");
    setLastHeardText("");
    setVoiceStatusHint(appCopy.voiceHintIdle);
  };

  const clearSpeechFallbackTimer = () => {
    if (speechFallbackTimerRef.current === null) return;
    window.clearTimeout(speechFallbackTimerRef.current);
    speechFallbackTimerRef.current = null;
  };

  const clearRecognitionRestartTimer = () => {
    if (recognitionRestartTimerRef.current === null) return;
    window.clearTimeout(recognitionRestartTimerRef.current);
    recognitionRestartTimerRef.current = null;
  };

  const stopSpeechRecognition = (keepListening = false) => {
    shouldKeepListeningRef.current = keepListening;
    clearRecognitionRestartTimer();
    const recognition = recognitionRef.current;
    recognitionRef.current = null;
    try {
      recognition?.stop();
    } catch {
      // Chrome can throw if recognition already stopped.
    }
  };

  const resumeSpeechRecognition = () => {
    if (
      !mediaSessionActiveRef.current ||
      backendStatusRef.current !== "online" ||
      !streamRef.current
    ) {
      return false;
    }

    shouldKeepListeningRef.current = true;
    return startSpeechRecognition();
  };

  const finishAssistantSpeech = () => {
    clearSpeechFallbackTimer();
    currentUtteranceRef.current = null;
    if (!mediaSessionActiveRef.current) return;
    setPhase("listening");
    resumeSpeechRecognition();
  };

  const interruptAssistantSpeech = () => {
    if (phaseRef.current !== "speaking" && phaseRef.current !== "thinking") return;
    replyStreamAbortRef.current?.abort();
    replyStreamAbortRef.current = null;
    clearSpeechFallbackTimer();
    currentUtteranceRef.current = null;
    window.speechSynthesis?.cancel();
    setPhase("listening");
    resumeSpeechRecognition();
  };

  const speakAssistantText = (text: string) => {
    if (!text.trim()) return;
    setPhase("speaking");
    stopSpeechRecognition(false);

    if (!("speechSynthesis" in window)) {
      setPhase("listening");
      resumeSpeechRecognition();
      return;
    }

    clearSpeechFallbackTimer();
    currentUtteranceRef.current = null;
    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "zh-CN";
    utterance.rate = speechRate;
    currentUtteranceRef.current = utterance;
    let speechFinished = false;
    const resumeAfterSpeech = () => {
      if (speechFinished) return;
      speechFinished = true;
      if (currentUtteranceRef.current === utterance) {
        finishAssistantSpeech();
      }
    };
    const fallbackMs = Math.max(3500, Math.min(18000, text.length * 220));
    speechFallbackTimerRef.current = window.setTimeout(
      resumeAfterSpeech,
      fallbackMs,
    );
    utterance.onend = resumeAfterSpeech;
    utterance.onerror = resumeAfterSpeech;
    window.speechSynthesis.speak(utterance);
  };

  const replayLastAssistantReply = () => {
    if (!lastAssistantReply.trim()) return;
    speakAssistantText(lastAssistantReply);
  };

  const selectedCustomSceneMode =
    customSceneModes.find((mode) => mode.id === selectedCustomSceneModeId) ??
    customSceneModes[0] ??
    null;

  const currentCustomSceneMode =
    sceneMode === "custom" ? selectedCustomSceneMode : null;

  const updateCustomDraft = (
    field: keyof CustomSceneModeDraft,
    value: string | string[],
  ) => {
    setCustomSceneDraft((current) => ({ ...current, [field]: value }));
  };

  const updateCustomDraftList = (
    field: "focus" | "examples" | "nextSteps",
    value: string,
  ) => {
    updateCustomDraft(field, value.split("\n"));
  };

  const editCustomSceneMode = (mode: CustomSceneModeProfile) => {
    setSelectedCustomSceneModeId(mode.id);
    setCustomSceneDraft(mode);
  };

  const createCustomSceneMode = () => {
    setCustomSceneDraft(createEmptyCustomModeDraft());
    setSceneMode("custom");
  };

  const saveCustomSceneMode = () => {
    const sanitized = sanitizeCustomSceneMode(customSceneDraft);
    setCustomSceneModes((current) => {
      const withoutCurrent = current.filter((mode) => mode.id !== sanitized.id);
      return [sanitized, ...withoutCurrent].slice(0, maxCustomSceneModes);
    });
    setSelectedCustomSceneModeId(sanitized.id);
    setCustomSceneDraft(sanitized);
    setSceneMode("custom");
    appendSystemMessage(appCopy.customModeSaved);
  };

  const deleteCustomSceneMode = () => {
    if (!customSceneDraft.id) return;
    setCustomSceneModes((current) =>
      current.filter((mode) => mode.id !== customSceneDraft.id),
    );
    setCustomSceneDraft(createEmptyCustomModeDraft());
    setSceneMode("general");
    appendSystemMessage(appCopy.customModeDeleted);
  };

  const waitForVideoFrame = async () => {
    const video = videoRef.current;
    if (
      !video ||
      video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA ||
      !streamRef.current
    ) {
      return;
    }

    await new Promise<void>((resolve) => {
      const timeoutId = window.setTimeout(resolve, 1800);
      const cleanup = () => {
        window.clearTimeout(timeoutId);
        video.removeEventListener("loadeddata", cleanup);
        video.removeEventListener("canplay", cleanup);
        video.removeEventListener("playing", cleanup);
        resolve();
      };

      video.addEventListener("loadeddata", cleanup, { once: true });
      video.addEventListener("canplay", cleanup, { once: true });
      video.addEventListener("playing", cleanup, { once: true });
    });
  };

  const createFrameFingerprint = (canvas: HTMLCanvasElement) => {
    const sourceContext = canvas.getContext("2d");
    if (!sourceContext || canvas.width === 0 || canvas.height === 0) return [];

    const sampleWidth = 16;
    const sampleHeight = 12;
    const sampleCanvas = document.createElement("canvas");
    sampleCanvas.width = sampleWidth;
    sampleCanvas.height = sampleHeight;
    const sampleContext = sampleCanvas.getContext("2d");
    if (!sampleContext) return [];

    sampleContext.drawImage(canvas, 0, 0, sampleWidth, sampleHeight);
    const { data } = sampleContext.getImageData(0, 0, sampleWidth, sampleHeight);
    const fingerprint: number[] = [];
    for (let index = 0; index < data.length; index += 4) {
      fingerprint.push(
        Math.round(data[index] * 0.299 + data[index + 1] * 0.587 + data[index + 2] * 0.114),
      );
    }
    return fingerprint;
  };

  const getFrameDifference = (current: number[], previous: number[] | null) => {
    if (!previous || previous.length !== current.length || current.length === 0) {
      return Number.POSITIVE_INFINITY;
    }

    const totalDifference = current.reduce(
      (total, value, index) => total + Math.abs(value - previous[index]),
      0,
    );
    return totalDifference / current.length;
  };

  const captureCurrentFrame = async (
    options: { quality?: number; width?: number } = {},
  ): Promise<CapturedFrame | null> => {
    await waitForVideoFrame();
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (
      !video ||
      !canvas ||
      video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA ||
      !video.videoWidth ||
      !video.videoHeight
    ) {
      videoReadyRef.current = false;
      setVideoReady(false);
      return null;
    }

    const width = options.width ?? 768;
    const ratio = video.videoHeight / video.videoWidth || 0.5625;
    canvas.width = width;
    canvas.height = Math.round(width * ratio);
    canvas
      .getContext("2d")
      ?.drawImage(video, 0, 0, canvas.width, canvas.height);

    return {
      imageBase64: canvas.toDataURL("image/jpeg", options.quality ?? 0.72),
      fingerprint: createFrameFingerprint(canvas),
    };
  };

  const analyzeCurrentFrame = async (
    reason: "interval" | "manual" | "visual-question",
    options: { capturedFrame?: CapturedFrame; silent?: boolean } = {},
  ) => {
    if (visionRequestInFlightRef.current) return null;
    visionRequestInFlightRef.current = true;

    const capturedFrame = options.capturedFrame ?? (await captureCurrentFrame());
    if (!capturedFrame) {
      visionRequestInFlightRef.current = false;
      appendSystemMessage(appCopy.cameraNotReadyMessage);
      return null;
    }

    try {
      const response = await fetch(`${apiBase}/vision/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId,
          imageBase64: capturedFrame.imageBase64,
          detail: "low",
          reason,
        }),
      });

      if (!response.ok) {
        throw new Error(`Vision API failed with ${response.status}`);
      }

      const data = (await response.json()) as { snapshot: VisionSummary };
      setVisionSummary(data.snapshot);
      visionSummaryRef.current = data.snapshot;
      lastFrameFingerprintRef.current = capturedFrame.fingerprint;
      setLastFrameFingerprint(capturedFrame.fingerprint);
      syncVisionContext(data.snapshot, options);
      setMetrics((current) => ({
        ...current,
        visionRequests: current.visionRequests + 1,
        lowDetailRequests: current.lowDetailRequests + 1,
        uploadedImageBytes: current.uploadedImageBytes + data.snapshot.imageBytes,
      }));
      return data.snapshot;
    } finally {
      visionRequestInFlightRef.current = false;
    }
  };

  const checkBackendHealth = async () => {
    try {
      const response = await fetch(`${apiBase}/health`, { cache: "no-store" });
      if (!response.ok) {
        throw new Error(`Health API failed with ${response.status}`);
      }
      setBackendStatus("online");
      backendStatusRef.current = "online";
      appendSystemMessage(appCopy.backendOnlineMessage);
      return true;
    } catch {
      setBackendStatus("offline");
      backendStatusRef.current = "offline";
      appendSystemMessage(appCopy.backendOfflineMessage);
      return false;
    }
  };

  const loadSessionHistory = async () => {
    setHistoryOpen(true);
    setHistoryLoading(true);
    setHistoryError("");
    try {
      const response = await fetch(`${apiBase}/session/history`, {
        cache: "no-store",
      });
      if (!response.ok) {
        throw new Error(`History API failed with ${response.status}`);
      }
      const data = (await response.json()) as SessionHistoryListItem[];
      setSessionHistory(data);
    } catch {
      setHistoryError(appCopy.historyLoadError);
    } finally {
      setHistoryLoading(false);
    }
  };

  const refreshSessionHistory = async () => {
    try {
      const response = await fetch(`${apiBase}/session/history`, {
        cache: "no-store",
      });
      if (!response.ok) {
        throw new Error(`History API failed with ${response.status}`);
      }
      const data = (await response.json()) as SessionHistoryListItem[];
      setSessionHistory(data);
    } catch {
      setHistoryError(appCopy.historyLoadError);
    }
  };

  const toggleSessionHistory = () => {
    if (historyOpen) {
      closeHistoryDetail();
      setHistoryOpen(false);
      return;
    }

    void loadSessionHistory();
  };

  const openHistoryDetail = async (historySessionId: string) => {
    setHistoryLoading(true);
    setHistoryError("");
    setSelectedHistoryFrameUrl(null);
    try {
      const response = await fetch(
        `${apiBase}/session/history/${historySessionId}`,
        { cache: "no-store" },
      );
      if (!response.ok) {
        throw new Error(`History detail API failed with ${response.status}`);
      }
      const detail = (await response.json()) as SessionHistoryDetail;
      setSelectedHistory(detail);

      const frameResponse = await fetch(
        `${apiBase}/session/history/${historySessionId}/final-frame-url`,
        { cache: "no-store" },
      );
      if (frameResponse.ok) {
        const frameData =
          (await frameResponse.json()) as SessionFinalFrameUrlResponse;
        setSelectedHistoryFrameUrl(frameData.url);
      }
    } catch {
      setHistoryError(appCopy.historyLoadError);
    } finally {
      setHistoryLoading(false);
    }
  };

  const closeHistoryDetail = () => {
    setSelectedHistory(null);
    setSelectedHistoryFrameUrl(null);
  };

  useEffect(() => {
    void checkBackendHealth();
  }, []);

  const syncVisionContext = (
    snapshot: VisionSummary,
    options: { silent?: boolean; skipSocket?: boolean } = {},
  ) => {
    const socket = videoStreamSocketRef.current;
    if (
      !options.skipSocket &&
      socket &&
      socket.readyState === WebSocket.OPEN
    ) {
      socket.send(
        JSON.stringify({
          type: "vision_context",
          snapshot,
        }),
      );
    }
    setVisionContextSyncState("synced");
    setVisionContextSyncedAt(new Date().toISOString());
    if (!options.silent) {
      setVisionContextSyncState("synced");
    }
  };

  const createVideoStreamUrl = () => {
    if (
      window.location.hostname === "localhost" ||
      window.location.hostname === "127.0.0.1"
    ) {
      return "ws://localhost:3001/api/omni/realtime";
    }

    const baseUrl = new URL(apiBase, window.location.origin);
    baseUrl.protocol = baseUrl.protocol === "https:" ? "wss:" : "ws:";
    if (baseUrl.port && baseUrl.port !== "3001") {
      baseUrl.port = "3001";
    }
    baseUrl.pathname = `${baseUrl.pathname.replace(/\/$/, "")}/omni/realtime`;
    return baseUrl.toString();
  };

  const connectVideoStream = useCallback(() => {
    if (
      videoStreamSocketRef.current &&
      videoStreamSocketRef.current.readyState <= WebSocket.OPEN
    ) {
      return;
    }

    try {
      setVideoStreamStatus("connecting");
      const socket = new WebSocket(createVideoStreamUrl());
      videoStreamSocketRef.current = socket;

      socket.onopen = () => {
        setVideoStreamStatus("connected");
        socket.send(JSON.stringify({ type: "start", sessionId }));
      };

      socket.onmessage = (messageEvent) => {
        const event = JSON.parse(String(messageEvent.data)) as OmniServerEvent;
        if (event.type === "video_summary") {
          setVisionSummary(event.snapshot);
          visionSummaryRef.current = event.snapshot;
          syncVisionContext(event.snapshot, { silent: true, skipSocket: true });
          if (phaseRef.current === "thinking" || phaseRef.current === "speaking") {
            setVisionUpdatedDuringReply(true);
          }
        }
        if (event.type === "action_timeline") {
          lastActionTimelineRef.current = event.timeline;
          setLastActionTimeline(event.timeline);
          setLastActionTimelineAt(event.timeline.createdAt);
          if (phaseRef.current === "thinking" || phaseRef.current === "speaking") {
            setVisionUpdatedDuringReply(true);
          }
        }
        if (event.type === "video_status") {
          if (videoStreamStatusRef.current !== "connected") {
            setVideoStreamStatus("connected");
            videoStreamStatusRef.current = "connected";
          }
          setStreamedVideoFrameCount(event.receivedFrames);
          setVideoStreamBufferedFrames(event.bufferedFrames);
          setVideoStreamCloudAnalyses(event.cloudAnalyses);
          setVideoStreamTimelineAnalyses(event.timelineAnalyses);
          setVideoStreamTimelineErrors(event.timelineErrors);
          setLastVideoStreamError(event.lastError ?? null);
          if (event.lastTimelineAt) {
            setLastActionTimelineAt(event.lastTimelineAt);
          }
          setLastVideoStreamAt(event.updatedAt);
        }
        if (event.type === "vision_memory_status") {
          setVisualContextFreshness(event.visualContextFreshness);
          setWaitingForFreshVision(event.analyzing && phaseRef.current === "thinking");
        }
        if (event.type === "text" && event.final) {
          videoStreamReplyResolverRef.current?.({
            reply: event.text,
            usedVisionContext: event.usedVisionContext,
          });
          videoStreamReplyResolverRef.current = null;
        }
        if (event.type === "error") {
          videoStreamReplyResolverRef.current?.(null);
          videoStreamReplyResolverRef.current = null;
          setLastVideoStreamError(event.message);
          const now = Date.now();
          if (now - lastVideoStreamErrorAtRef.current > 5000) {
            lastVideoStreamErrorAtRef.current = now;
            appendSystemMessage(event.message);
          }
        }
      };

      socket.onerror = () => {
        setVideoStreamStatus("fallback");
      };

      socket.onclose = () => {
        videoStreamReplyResolverRef.current?.(null);
        videoStreamReplyResolverRef.current = null;
        if (mediaSessionActiveRef.current) {
          setVideoStreamStatus("fallback");
        } else {
          setVideoStreamStatus("idle");
        }
      };
    } catch {
      setVideoStreamStatus("fallback");
    }
  }, [sessionId]);

  const disconnectVideoStream = () => {
    const socket = videoStreamSocketRef.current;
    videoStreamSocketRef.current = null;
    if (!socket) return;
    try {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: "stop" }));
      }
      socket.close();
    } catch {
      // Ignore close races.
    }
    setVideoStreamStatus("idle");
  };

  const requestVideoStreamReply = (text: string) => {
    const socket = videoStreamSocketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return null;

      return new Promise<AssistantReplyPayload | null>((resolve) => {
        videoStreamReplyResolverRef.current?.(null);
        videoStreamReplyResolverRef.current = resolve;
        socket.send(
          JSON.stringify({
            type: "text",
            text,
            sceneMode,
            customSceneMode: currentCustomSceneMode,
          }),
        );
      window.setTimeout(() => {
        if (videoStreamReplyResolverRef.current === resolve) {
          videoStreamReplyResolverRef.current = null;
          resolve(null);
        }
      }, 18000);
    });
  };

  const sendVideoStreamFrame = (frame: ActionFrame) => {
    const socket = videoStreamSocketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return false;

    const payload: VideoStreamFrame = {
      id: frame.id,
      imageBase64: frame.imageBase64,
      capturedAt: frame.capturedAt,
      fingerprint: frame.fingerprint,
    };
    socket.send(JSON.stringify({ type: "video_frame", frame: payload }));
    return true;
  };

  const canRunAutoObserve = () =>
    autoObserveEnabledRef.current &&
    mediaSessionActiveRef.current &&
    backendStatusRef.current === "online" &&
    videoReadyRef.current &&
    cameraEnabledRef.current &&
    document.visibilityState === "visible" &&
    phaseRef.current !== "speaking" &&
    phaseRef.current !== "thinking";

  const isAutoVisionRateLimited = () => {
    const now = Date.now();
    autoVisionTimestampsRef.current = autoVisionTimestampsRef.current.filter(
      (timestamp) => now - timestamp < 60000,
    );
    return autoVisionTimestampsRef.current.length >= maxAutoVisionRequestsPerMinute;
  };

  const scheduleAutoObserve = useCallback(
    (delayMs = autoObserveIntervalMs) => {
      if (autoObserveTimerRef.current !== null) {
        window.clearTimeout(autoObserveTimerRef.current);
      }

      autoObserveTimerRef.current = window.setTimeout(() => {
        autoObserveTimerRef.current = null;
        void runAutoObserve();
      }, delayMs);
    },
    [autoObserveIntervalMs],
  );

  const runAutoObserve = async () => {
    if (!canRunAutoObserve()) {
      scheduleAutoObserve(autoObserveIntervalMs);
      return;
    }

    if (isAutoVisionRateLimited()) {
      setSkippedFrameCount((count) => count + 1);
      scheduleAutoObserve(slowAutoObserveIntervalMs);
      return;
    }

    const capturedFrame = await captureCurrentFrame();
    if (!capturedFrame) {
      setSkippedFrameCount((count) => count + 1);
      scheduleAutoObserve(autoObserveIntervalMs);
      return;
    }

    const frameDifference = getFrameDifference(
      capturedFrame.fingerprint,
      lastFrameFingerprintRef.current,
    );

    if (frameDifference < frameDiffThreshold) {
      stableFrameCountRef.current += 1;
      lastFrameFingerprintRef.current = capturedFrame.fingerprint;
      setLastFrameFingerprint(capturedFrame.fingerprint);
      setSkippedFrameCount((count) => count + 1);
      scheduleAutoObserve(
        stableFrameCountRef.current >= stableFrameSlowdownThreshold
          ? slowAutoObserveIntervalMs
          : autoObserveIntervalMs,
      );
      return;
    }

    stableFrameCountRef.current = 0;
    lastFrameFingerprintRef.current = capturedFrame.fingerprint;
    setLastFrameFingerprint(capturedFrame.fingerprint);

    try {
      autoVisionTimestampsRef.current.push(Date.now());
      const snapshot = await analyzeCurrentFrame("interval", {
        capturedFrame,
        silent: true,
      });
      if (snapshot) {
        setLastAutoVisionAt(snapshot.createdAt);
        setAutoVisionRequestCount((count) => count + 1);
      }
    } catch {
      setBackendStatus("offline");
      backendStatusRef.current = "offline";
      appendSystemMessage(appCopy.visionAnalyzeError);
    } finally {
      scheduleAutoObserve(autoObserveIntervalMs);
    }
  };

  const canRunActionCapture = () =>
    autoObserveEnabledRef.current &&
    mediaSessionActiveRef.current &&
    backendStatusRef.current === "online" &&
    videoReadyRef.current &&
    cameraEnabledRef.current &&
    document.visibilityState === "visible" &&
    phaseRef.current !== "speaking";

  const pruneActionFrames = (frames: ActionFrame[]) => {
    const cutoff = Date.now() - actionWindowMs;
    return frames
      .filter((frame) => new Date(frame.capturedAt).getTime() >= cutoff)
      .slice(-maxActionFrames);
  };

  const updateActionFrames = (nextFrames: ActionFrame[]) => {
    const prunedFrames = pruneActionFrames(nextFrames);
    actionFramesRef.current = prunedFrames;
    setActionFrames(prunedFrames);
  };

  const scheduleActionSample = useCallback(() => {
    if (actionSampleTimerRef.current !== null) {
      window.clearTimeout(actionSampleTimerRef.current);
    }

    actionSampleTimerRef.current = window.setTimeout(() => {
      actionSampleTimerRef.current = null;
      void runActionSample();
    }, actionSampleIntervalMs);
  }, []);

  const scheduleActionAnalyze = useCallback(
    (delayMs = actionAnalyzeIntervalMs) => {
      if (actionAnalyzeTimerRef.current !== null) {
        window.clearTimeout(actionAnalyzeTimerRef.current);
      }

      actionAnalyzeTimerRef.current = window.setTimeout(() => {
        actionAnalyzeTimerRef.current = null;
        void analyzeActionSequence();
      }, delayMs);
    },
    [],
  );

  const runActionSample = async () => {
    if (!canRunActionCapture()) {
      scheduleActionSample();
      return;
    }

    const capturedFrame = await captureCurrentFrame({
      quality: actionFrameQuality,
      width: actionFrameWidth,
    });
    if (!capturedFrame) {
      scheduleActionSample();
      return;
    }

    setActionSampleCount((count) => count + 1);
    actionSampleCountRef.current += 1;
    const frameDifference = getFrameDifference(
      capturedFrame.fingerprint,
      lastActionFingerprintRef.current,
    );
    lastActionFingerprintRef.current = capturedFrame.fingerprint;

    if (frameDifference < actionFrameDiffThreshold) {
      dedupedActionFrameCountRef.current += 1;
      setDedupedActionFrameCount(dedupedActionFrameCountRef.current);
      updateActionFrames(actionFramesRef.current);
      scheduleActionSample();
      return;
    }

    const actionFrame = {
      ...capturedFrame,
      id: crypto.randomUUID(),
      capturedAt: new Date().toISOString(),
    };
    updateActionFrames([...actionFramesRef.current, actionFrame]);
    sendVideoStreamFrame(actionFrame);
    scheduleActionSample();
  };

  const selectSequenceFrames = (frames: ActionFrame[]) => {
    const prunedFrames = pruneActionFrames(frames);
    if (prunedFrames.length <= maxSequenceFrames) return prunedFrames;

    const stride = (prunedFrames.length - 1) / (maxSequenceFrames - 1);
    return Array.from({ length: maxSequenceFrames }, (_, index) => {
      const frameIndex = Math.round(index * stride);
      return prunedFrames[frameIndex];
    }).filter(Boolean);
  };

  const isActionTimelineStale = () =>
    !lastActionTimelineRef.current ||
    Date.now() - new Date(lastActionTimelineRef.current.createdAt).getTime() >
      actionTimelineStaleMs;

  const isFailedActionTimeline = (timeline: VisionActionTimeline) =>
    timeline.summary.includes("动作序列模型调用失败") ||
    timeline.confidenceNote.includes("模型调用失败");

  const analyzeActionSequence = async (options: { force?: boolean } = {}) => {
    if (!canRunActionCapture()) {
      scheduleActionAnalyze();
      return null;
    }

    if (
      !options.force &&
      videoStreamStatusRef.current === "connected" &&
      !isActionTimelineStale()
    ) {
      scheduleActionAnalyze();
      return lastActionTimelineRef.current;
    }

    if (actionSequenceInFlightRef.current) {
      scheduleActionAnalyze();
      return null;
    }

    const selectedFrames = selectSequenceFrames(actionFramesRef.current);
    if (selectedFrames.length < minActionFramesForSequence) {
      scheduleActionAnalyze();
      return null;
    }

    actionSequenceInFlightRef.current = true;
    try {
      const firstFrameAt = new Date(selectedFrames[0].capturedAt).getTime();
      const response = await fetch(`${apiBase}/vision/analyze-sequence`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId,
          sampledFrameCount: actionSampleCountRef.current,
          dedupedFrameCount: dedupedActionFrameCountRef.current,
          frames: selectedFrames.map((frame) => ({
            id: frame.id,
            imageBase64: frame.imageBase64,
            capturedAt: frame.capturedAt,
            offsetMs: new Date(frame.capturedAt).getTime() - firstFrameAt,
          })),
        }),
      });

      if (!response.ok) {
        throw new Error(`Vision sequence API failed with ${response.status}`);
      }

      const data = (await response.json()) as { timeline: VisionActionTimeline };
      if (isFailedActionTimeline(data.timeline)) {
        if (
          !actionAnalyzeErrorNotifiedRef.current &&
          !lastActionTimelineRef.current
        ) {
          actionAnalyzeErrorNotifiedRef.current = true;
          appendSystemMessage(appCopy.actionAnalyzeError);
        }
        return null;
      }
      actionAnalyzeErrorNotifiedRef.current = false;
      lastActionTimelineRef.current = data.timeline;
      setLastActionTimeline(data.timeline);
      setLastActionTimelineAt(data.timeline.createdAt);
      setActionSequenceRequestCount((count) => count + 1);
      return data.timeline;
    } catch {
      if (
        !actionAnalyzeErrorNotifiedRef.current &&
        !lastActionTimelineRef.current
      ) {
        actionAnalyzeErrorNotifiedRef.current = true;
        appendSystemMessage(appCopy.actionAnalyzeError);
      }
      return null;
    } finally {
      actionSequenceInFlightRef.current = false;
      scheduleActionAnalyze();
    }
  };

  const captureActionBurst = async () => {
    for (let index = 0; index < actionQuestionBurstFrames; index += 1) {
      if (!canRunActionCapture()) return;
      const capturedFrame = await captureCurrentFrame({
        quality: actionFrameQuality,
        width: actionFrameWidth,
      });
      if (!capturedFrame) continue;

      setActionSampleCount((count) => count + 1);
      actionSampleCountRef.current += 1;
      const frameDifference = getFrameDifference(
        capturedFrame.fingerprint,
        lastActionFingerprintRef.current,
      );
      lastActionFingerprintRef.current = capturedFrame.fingerprint;

      if (frameDifference < actionFrameDiffThreshold && actionFramesRef.current.length > 0) {
        dedupedActionFrameCountRef.current += 1;
        setDedupedActionFrameCount(dedupedActionFrameCountRef.current);
      } else {
        const actionFrame = {
          ...capturedFrame,
          id: crypto.randomUUID(),
          capturedAt: new Date().toISOString(),
        };
        updateActionFrames([...actionFramesRef.current, actionFrame]);
        sendVideoStreamFrame(actionFrame);
      }

      await new Promise<void>((resolve) =>
        window.setTimeout(resolve, actionSampleIntervalMs),
      );
    }
  };

  useEffect(() => {
    if (autoObserveTimerRef.current !== null) {
      window.clearTimeout(autoObserveTimerRef.current);
      autoObserveTimerRef.current = null;
    }

    if (
      autoObserveEnabled &&
      cameraEnabled &&
      backendStatus === "online" &&
      videoReady &&
      phase !== "speaking" &&
      phase !== "thinking"
    ) {
      scheduleAutoObserve(1200);
    }

    return () => {
      if (autoObserveTimerRef.current !== null) {
        window.clearTimeout(autoObserveTimerRef.current);
        autoObserveTimerRef.current = null;
      }
    };
  }, [
    autoObserveEnabled,
    backendStatus,
    cameraEnabled,
    phase,
    scheduleAutoObserve,
    videoReady,
  ]);

  useEffect(() => {
    if (actionSampleTimerRef.current !== null) {
      window.clearTimeout(actionSampleTimerRef.current);
      actionSampleTimerRef.current = null;
    }
    if (actionAnalyzeTimerRef.current !== null) {
      window.clearTimeout(actionAnalyzeTimerRef.current);
      actionAnalyzeTimerRef.current = null;
    }

    if (
      autoObserveEnabled &&
      cameraEnabled &&
      backendStatus === "online" &&
      videoReady &&
      phase !== "speaking"
    ) {
      scheduleActionSample();
      scheduleActionAnalyze(
        videoStreamStatus === "connected" ? actionAnalyzeIntervalMs : 1800,
      );
    }

    return () => {
      if (actionSampleTimerRef.current !== null) {
        window.clearTimeout(actionSampleTimerRef.current);
        actionSampleTimerRef.current = null;
      }
      if (actionAnalyzeTimerRef.current !== null) {
        window.clearTimeout(actionAnalyzeTimerRef.current);
        actionAnalyzeTimerRef.current = null;
      }
    };
  }, [
    autoObserveEnabled,
    backendStatus,
    cameraEnabled,
    phase,
    scheduleActionAnalyze,
    scheduleActionSample,
    videoReady,
    videoStreamStatus,
  ]);

  useEffect(() => {
    const shouldStream =
      autoObserveEnabled &&
      cameraEnabled &&
      backendStatus === "online" &&
      videoReady &&
      mediaSessionActiveRef.current;

    if (shouldStream) {
      connectVideoStream();
      return;
    }

    disconnectVideoStream();
  }, [
    autoObserveEnabled,
    backendStatus,
    cameraEnabled,
    connectVideoStream,
    videoReady,
  ]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        scheduleAutoObserve(1200);
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [scheduleAutoObserve]);

  const isVisionContextStale = (snapshot: VisionSummary | null) => {
    if (!snapshot) return true;
    return Date.now() - new Date(snapshot.createdAt).getTime() > staleVisionContextMs;
  };

  const isVisualQuestion = (text: string) =>
    /看|画面|镜头|摄像头|视频|这是什么|有什么|帮我看|识别|颜色|位置|左边|右边|前面|后面/.test(
      text,
    );

  const isActionQuestion = (text: string) =>
    /刚才|动作|动了|移动|手势|挥手|拿|放下|抬|转头|发生了什么|做了什么|一系列|连续/.test(
      text,
    );

  const parseConversationStreamBlock = (block: string) => {
    const data = block
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    if (!data) return null;
    return JSON.parse(data) as ConversationStreamEvent;
  };

  const requestStreamingReply = async (
    text: string,
    currentVisionSummary: VisionSummary | null,
    currentActionTimeline: VisionActionTimeline | null,
    assistantMessageId: string,
  ) => {
    if (!("ReadableStream" in window)) return null;

    const abortController = new AbortController();
    replyStreamAbortRef.current = abortController;
    const response = await fetch(`${apiBase}/conversation/respond-stream`, {
      method: "POST",
      headers: {
        "Accept": "text/event-stream",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sessionId,
        text,
        sceneMode,
        customSceneMode: currentCustomSceneMode,
        visionSummary: currentVisionSummary,
        visionTimeline: currentActionTimeline,
      }),
      signal: abortController.signal,
    });

    if (!response.ok || !response.body) {
      throw new Error(`Conversation stream failed with ${response.status}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let reply = "";
    let usedVisionContext: UsedVisionContext | undefined;

    try {
      while (true) {
        const { value, done } = await reader.read();
        buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
        const blocks = buffer.split("\n\n");
        buffer = blocks.pop() ?? "";

        for (const block of blocks) {
          const event = parseConversationStreamBlock(block);
          if (!event) continue;

          if (event.type === "meta") {
            usedVisionContext = event.usedVisionContext;
          }
          if (event.type === "delta") {
            reply += event.text;
            updateMessageContent(assistantMessageId, reply);
            if (phaseRef.current === "thinking") {
              setPhase("speaking");
            }
          }
          if (event.type === "done") {
            reply = event.reply || reply;
            usedVisionContext = event.usedVisionContext ?? usedVisionContext;
            updateMessageContent(assistantMessageId, reply);
            return { reply, usedVisionContext };
          }
          if (event.type === "error") {
            throw new Error(event.message);
          }
        }

        if (done) break;
      }
    } finally {
      if (replyStreamAbortRef.current === abortController) {
        replyStreamAbortRef.current = null;
      }
      reader.releaseLock();
    }

    return reply ? { reply, usedVisionContext } : null;
  };

  const requestJsonReply = async (
    text: string,
    currentVisionSummary: VisionSummary | null,
    currentActionTimeline: VisionActionTimeline | null,
  ) => {
    const response = await fetch(`${apiBase}/conversation/respond`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId,
        text,
        sceneMode,
        customSceneMode: currentCustomSceneMode,
        visionSummary: currentVisionSummary,
        visionTimeline: currentActionTimeline,
      }),
    });

    if (!response.ok) {
      throw new Error(`Conversation API failed with ${response.status}`);
    }

    const data = (await response.json()) as ConversationResponse;
    return {
      reply: data.reply,
      usedVisionContext: data.usedVisionContext,
    };
  };

  const askAssistant = async (text: string) => {
    setPhase("thinking");
    setReplyGenerationId((id) => id + 1);
    setVisionUpdatedDuringReply(false);
    setWaitingForFreshVision(
      videoStreamStatusRef.current === "connected" &&
        (visualContextFreshness === "stale" || visualContextFreshness === "missing"),
    );

    try {
      let currentVisionSummary = visionSummaryRef.current;
      let currentActionTimeline = lastActionTimelineRef.current;
      if (
        videoReadyRef.current &&
        (isVisionContextStale(currentVisionSummary) || isVisualQuestion(text))
      ) {
        try {
          currentVisionSummary =
            (await analyzeCurrentFrame("visual-question")) ??
            currentVisionSummary;
        } catch {
          appendSystemMessage(appCopy.autoVisionCaptureFailed);
        }
      }

      if (isActionQuestion(text)) {
        if (actionFramesRef.current.length < minActionFramesForSequence) {
          await captureActionBurst();
        }
        if (!currentActionTimeline || videoStreamStatusRef.current !== "connected") {
          currentActionTimeline =
            (await analyzeActionSequence({ force: true })) ??
            currentActionTimeline;
        }
      }

      const assistantMessageId = appendAssistantMessage("");
      let replyPayload: AssistantReplyPayload | null = null;
      try {
        replyPayload = await requestStreamingReply(
          text,
          currentVisionSummary,
          currentActionTimeline,
          assistantMessageId,
        );
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          updateMessageContent(assistantMessageId, "已停止生成。");
          setWaitingForFreshVision(false);
          return;
        }
      }

      if (!replyPayload?.reply) {
        replyPayload = await requestJsonReply(
          text,
          currentVisionSummary,
          currentActionTimeline,
        );
        updateMessageContent(assistantMessageId, replyPayload.reply);
      }

      const reply = replyPayload.reply;
      const usedVisionContext = replyPayload.usedVisionContext;

      setReplyContextTimestamp(
        usedVisionContext?.visionTimelineAt ??
          usedVisionContext?.visionSummaryAt ??
          null,
      );
      setLastAssistantReply(reply);
      setWaitingForFreshVision(false);
      speakAssistantText(reply);
    } catch {
      setPhase("listening");
      setWaitingForFreshVision(false);
      appendSystemMessage(appCopy.conversationError);
      resumeSpeechRecognition();
    }
  };

  const submitTypedQuestion = (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault();
    const text = typedQuestion.trim();
    submitQuestionText(text, { clearTypedInput: true });
  };

  const submitQuestionText = (
    text: string,
    options: { clearTypedInput?: boolean } = {},
  ) => {
    const normalizedText = text.trim();
    if (
      !normalizedText ||
      backendStatusRef.current !== "online" ||
      phaseRef.current === "thinking"
    ) {
      return;
    }

    clearSpeechFallbackTimer();
    currentUtteranceRef.current = null;
    window.speechSynthesis?.cancel();
    stopSpeechRecognition(false);
    setLastHeardText("");
    appendMessage({ role: "user", content: normalizedText });
    if (options.clearTypedInput) {
      setTypedQuestion("");
    }
    void askAssistant(normalizedText);
  };

  const startSpeechRecognition = () => {
    if (recognitionRef.current) return true;

    const SpeechRecognition = getSpeechRecognition();
    if (!SpeechRecognition) {
      appendSystemMessage(appCopy.speechUnsupported);
      return false;
    }

    try {
      clearRecognitionRestartTimer();
      shouldKeepListeningRef.current = true;
      const recognition = new SpeechRecognition();
      recognition.lang = "zh-CN";
      recognition.continuous = true;
      recognition.interimResults = false;
      recognition.onresult = (event) => {
        const result = event.results[event.results.length - 1];
        if (!result?.isFinal) return;
        const text = result[0].transcript.trim();
        if (!text) return;
        setLastHeardText(text);
        setVoiceStatusHint(`${appCopy.heardPrefix}${text}`);
        appendMessage({ role: "user", content: text });
        stopSpeechRecognition(false);
        void askAssistant(text);
      };
      recognition.onerror = (event) => {
        if (event.error === "aborted" || event.error === "no-speech") return;
        if (
          event.error === "not-allowed" ||
          event.error === "service-not-allowed"
        ) {
          shouldKeepListeningRef.current = false;
        }
        appendSystemMessage(appCopy.speechRecognitionError);
      };
      recognition.onend = () => {
        recognitionRef.current = null;
        if (!shouldKeepListeningRef.current) return;

        recognitionRestartTimerRef.current = window.setTimeout(() => {
          recognitionRestartTimerRef.current = null;
          if (shouldKeepListeningRef.current) {
            startSpeechRecognition();
          }
        }, 450);
      };
      recognition.start();
      recognitionRef.current = recognition;
      return true;
    } catch {
      recognitionRef.current = null;
      appendSystemMessage(appCopy.speechRecognitionError);
      return false;
    }
  };

  const createMediaStream = async (
    cameraDeviceId = selectedCameraDeviceId,
  ): Promise<MediaStreamResult> => {
    const video: MediaTrackConstraints = cameraDeviceId
      ? {
          deviceId: { exact: cameraDeviceId },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        }
      : {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          facingMode: "user",
        };

    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video,
        audio: true,
      });
      return { stream: mediaStream, hasAudio: mediaStream.getAudioTracks().length > 0 };
    } catch (error) {
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video,
        audio: false,
      });
      return { stream: mediaStream, hasAudio: false, audioError: error };
    }
  };

  const getCameraErrorMessage = (error: unknown) => {
    if (error instanceof Error && error.message === "INSECURE_MEDIA_CONTEXT") {
      return appCopy.cameraSecureContextError;
    }

    if (error instanceof DOMException) {
      if (error.name === "NotAllowedError" || error.name === "SecurityError") {
        return appCopy.cameraPermissionDeniedError;
      }
      if (error.name === "NotFoundError" || error.name === "OverconstrainedError") {
        return appCopy.cameraNotFoundError;
      }
      if (error.name === "NotReadableError" || error.name === "AbortError") {
        return appCopy.cameraDeviceBusyError;
      }
    }

    return appCopy.cameraPermissionError;
  };

  const getMicrophoneErrorMessage = (error: unknown) => {
    if (error instanceof DOMException) {
      if (error.name === "NotAllowedError" || error.name === "SecurityError") {
        return appCopy.microphonePermissionDeniedError;
      }
      if (error.name === "NotFoundError" || error.name === "OverconstrainedError") {
        return appCopy.microphoneNotFoundError;
      }
      if (error.name === "NotReadableError" || error.name === "AbortError") {
        return appCopy.microphoneBusyError;
      }
    }

    return appCopy.microphoneUnavailableMessage;
  };

  const startMedia = async () => {
    let mediaStream: MediaStream | null = null;
    try {
      setPhase("connecting");
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
        throw new Error("INSECURE_MEDIA_CONTEXT");
      }

      const mediaResult = await createMediaStream();
      mediaStream = mediaResult.stream;
      const videoTrack = mediaStream.getVideoTracks()[0];
      mediaSessionActiveRef.current = true;
      streamRef.current = mediaStream;
      setStream(mediaStream);
      setCameraEnabled(true);
      setMicEnabled(mediaResult.hasAudio);
      setAutoObserveEnabled(true);
      setSelectedCameraDeviceId(
        videoTrack?.getSettings().deviceId || selectedCameraDeviceId,
      );
      updateCameraDiagnostics(mediaStream, videoRef.current);
      void refreshCameraDevices();
      appendSystemMessage(
        mediaResult.hasAudio
          ? appCopy.mediaConnectedMessage
          : appCopy.mediaVideoOnlyMessage,
      );
      if (mediaResult.audioError) {
        appendSystemMessage(getMicrophoneErrorMessage(mediaResult.audioError));
      }
      const backendReady = await checkBackendHealth();
      if (backendReady) {
        setPhase("listening");
        if (mediaResult.hasAudio) {
          appendSystemMessage(appCopy.realtimeConnectedMessage);
          startSpeechRecognition();
        } else {
          appendSystemMessage(appCopy.microphoneUnavailableMessage);
        }
      } else {
        setPhase("error");
        appendSystemMessage(appCopy.voiceDisabledBackendOffline);
      }
    } catch (error) {
      mediaStream?.getTracks().forEach((track) => track.stop());
      mediaSessionActiveRef.current = false;
      streamRef.current = null;
      setStream(null);
      setCameraEnabled(false);
      setVideoReady(false);
      setCameraDiagnostics(null);
      setPhase("error");
      appendSystemMessage(getCameraErrorMessage(error));
    }
  };

  const stopMedia = async () => {
    const finalFrame = cameraEnabled ? await captureCurrentFrame() : null;

    mediaSessionActiveRef.current = false;
    stopSpeechRecognition(false);
    clearSpeechFallbackTimer();
    currentUtteranceRef.current = null;
    window.speechSynthesis?.cancel();
    if (autoObserveTimerRef.current !== null) {
      window.clearTimeout(autoObserveTimerRef.current);
      autoObserveTimerRef.current = null;
    }
    if (actionSampleTimerRef.current !== null) {
      window.clearTimeout(actionSampleTimerRef.current);
      actionSampleTimerRef.current = null;
    }
    if (actionAnalyzeTimerRef.current !== null) {
      window.clearTimeout(actionAnalyzeTimerRef.current);
      actionAnalyzeTimerRef.current = null;
    }
    disconnectVideoStream();
    stream?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    lastFrameFingerprintRef.current = null;
    stableFrameCountRef.current = 0;
    autoVisionTimestampsRef.current = [];
    actionFramesRef.current = [];
    lastActionFingerprintRef.current = null;
    lastActionTimelineRef.current = null;
    setStream(null);
    setCameraEnabled(false);
    setVideoReady(false);
    setCameraDiagnostics(null);
    setLastFrameFingerprint(null);
    setLastAutoVisionAt(null);
    setActionFrames([]);
    setLastActionTimeline(null);
    setLastActionTimelineAt(null);
    setPhase("idle");

    let sessionEndFailed = false;
    try {
      await fetch(`${apiBase}/session/end`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId,
          metrics: { ...metrics, endedAt: new Date().toISOString() },
          finalFrameImageBase64: finalFrame?.imageBase64,
        }),
      });
      await refreshSessionHistory();
    } catch {
      sessionEndFailed = true;
    }

    resetConversationState();
    if (sessionEndFailed) {
      appendSystemMessage(appCopy.sessionEndError);
    }
  };

  const toggleMic = () => {
    stream?.getAudioTracks().forEach((track) => {
      track.enabled = !micEnabled;
    });
    setMicEnabled((value) => !value);
  };

  const toggleCamera = () => {
    stream?.getVideoTracks().forEach((track) => {
      track.enabled = !cameraEnabled;
    });
    if (cameraEnabled) {
      disconnectVideoStream();
      lastFrameFingerprintRef.current = null;
      stableFrameCountRef.current = 0;
      actionFramesRef.current = [];
      lastActionFingerprintRef.current = null;
      setVideoReady(false);
      setLastFrameFingerprint(null);
      setActionFrames([]);
    }
    setCameraEnabled((value) => !value);
  };

  const switchCamera = async (deviceId: string) => {
    setSelectedCameraDeviceId(deviceId);
    if (!stream) return;

    stopSpeechRecognition(false);
    disconnectVideoStream();
    stream.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    lastFrameFingerprintRef.current = null;
    stableFrameCountRef.current = 0;
    actionFramesRef.current = [];
    lastActionFingerprintRef.current = null;
    setStream(null);
    setVideoReady(false);
    setCameraDiagnostics(null);
    setLastFrameFingerprint(null);
    setActionFrames([]);
    setPhase("connecting");

    try {
      const mediaResult = await createMediaStream(deviceId);
      const mediaStream = mediaResult.stream;
      mediaSessionActiveRef.current = true;
      streamRef.current = mediaStream;
      setStream(mediaStream);
      setCameraEnabled(true);
      setMicEnabled(mediaResult.hasAudio);
      updateCameraDiagnostics(mediaStream, videoRef.current);
      appendSystemMessage(appCopy.cameraSwitchedMessage);
      setPhase(backendStatus === "online" ? "listening" : "error");
      if (backendStatusRef.current === "online") {
        if (mediaResult.hasAudio) {
          resumeSpeechRecognition();
        } else {
          appendSystemMessage(
            mediaResult.audioError
              ? getMicrophoneErrorMessage(mediaResult.audioError)
              : appCopy.microphoneUnavailableMessage,
          );
        }
      }
    } catch (error) {
      mediaSessionActiveRef.current = false;
      streamRef.current = null;
      setCameraEnabled(false);
      setPhase("error");
      appendSystemMessage(getCameraErrorMessage(error));
    }
  };

  const analyzeFrame = async () => {
    setPhase("thinking");

    try {
      const snapshot = await analyzeCurrentFrame("manual");
      if (!snapshot) {
        setPhase("listening");
        return;
      }
      appendAssistantMessage(snapshot.summary);
      setPhase("listening");
    } catch {
      setPhase("error");
      appendSystemMessage(appCopy.visionAnalyzeError);
    }
  };

  const fallbackCustomSceneProfile = {
    label: appCopy.customModeLabel,
    description: appCopy.customModeEmptyDescription,
    focus: ["自定义角色", "场景目标", "专属提问"],
    examples: [],
    nextSteps: [appCopy.customModeEmptyDescription],
  };
  const safeSceneMode = normalizeSceneMode(sceneMode);
  const sceneModeProfile =
    safeSceneMode === "custom"
      ? (selectedCustomSceneMode ?? fallbackCustomSceneProfile)
      : sceneModeCopy[safeSceneMode];
  const prioritizeActionPanel =
    safeSceneMode === "action" || safeSceneMode === "interview";
  const isBackendOffline = backendStatus === "offline";
  const typedQuestionText = typedQuestion.trim();
  const canSubmitTypedQuestion =
    backendStatus === "online" &&
    phase !== "thinking" &&
    typedQuestionText.length > 0;
  const typedQuestionPlaceholder =
    backendStatus === "online"
      ? "输入问题，按 Enter 发送"
      : backendStatus === "offline"
        ? "后端离线，暂时无法发送"
        : "正在检测后端服务...";
  const voiceStatusLabel =
    phase === "listening"
      ? appCopy.voiceStatusListening
      : phase === "thinking"
        ? appCopy.voiceStatusThinking
        : phase === "speaking"
          ? appCopy.voiceStatusSpeaking
          : phase === "error"
            ? appCopy.voiceStatusError
            : lastHeardText
              ? appCopy.voiceStatusHeard
              : appCopy.voiceStatusIdle;
  const canReplayLastReply = lastAssistantReply.trim().length > 0;
  const observationText =
    visionSummary?.summary ?? appCopy.noObservationYet;
  const changeText =
    lastActionTimeline?.summary ?? appCopy.noChangeYet;
  const latestObservationAt = visionSummary
    ? new Date(visionSummary.createdAt).toLocaleTimeString()
    : appCopy.waitingFirstFrame;
  const latestChangeAt = lastActionTimelineAt
    ? new Date(lastActionTimelineAt).toLocaleTimeString()
    : appCopy.waitingFirstFrame;
  const costDebugSummary = [
    `成本：${costLevel}`,
    `跳过静止帧：${skippedFrameCount + dedupedActionFrameCount}`,
    `云端分析：${videoStreamCloudAnalyses + actionSequenceRequestCount}`,
  ].join(" · ");
  const handleTypedQuestionKeyDown = (
    event: KeyboardEvent<HTMLTextAreaElement>,
  ) => {
    if (event.key !== "Enter" || event.shiftKey) return;
    event.preventDefault();
    submitTypedQuestion();
  };
  const statusItems = [
    {
      label: cameraEnabled
        ? videoReady
          ? appCopy.cameraOnline
          : appCopy.cameraStarting
        : appCopy.cameraOffline,
      variant: cameraEnabled && videoReady ? "success" : cameraEnabled ? "warning" : "muted",
      icon: cameraEnabled && videoReady ? CheckCircle2 : Camera,
    },
    {
      label: micEnabled ? appCopy.micOnline : appCopy.micMuted,
      variant: micEnabled ? "success" : "muted",
      icon: micEnabled ? Mic : MicOff,
    },
    {
      label:
        backendStatus === "online"
          ? appCopy.backendOnline
          : backendStatus === "offline"
            ? appCopy.backendOffline
            : appCopy.backendUnknown,
      variant:
        backendStatus === "online"
          ? "success"
          : backendStatus === "offline"
            ? "danger"
            : "warning",
      icon:
        backendStatus === "online"
          ? Wifi
          : backendStatus === "offline"
            ? XCircle
            : AlertTriangle,
    },
    {
      label: videoStreamStatusLabel,
      variant:
        videoStreamStatus === "connected"
          ? "success"
          : videoStreamStatus === "fallback"
            ? "warning"
            : "muted",
      icon: Radio,
    },
  ] as const;
  const primaryMetrics = [
    [appCopy.metricCostLevel, costLevel],
    [appCopy.metricVisionRequests, metrics.visionRequests],
    [appCopy.metricActionSequenceRequests, actionSequenceRequestCount],
    [appCopy.metricStreamCloudAnalyses, videoStreamCloudAnalyses],
    ["视觉新鲜度", visualContextFreshness],
    ["回复序号", replyGenerationId],
  ];
  const streamMetrics = [
    [appCopy.metricAutoVisionRequests, autoVisionRequestCount],
    [appCopy.metricSkippedFrames, skippedFrameCount],
    [appCopy.metricActionSamples, actionSampleCount],
    [appCopy.metricDedupedActionFrames, dedupedActionFrameCount],
    [appCopy.metricActionBuffer, actionFrames.length],
    [appCopy.metricStreamedFrames, streamedVideoFrameCount],
    [appCopy.metricStreamBuffer, videoStreamBufferedFrames],
    [appCopy.metricStreamTimelineAnalyses, videoStreamTimelineAnalyses],
    [appCopy.metricStreamTimelineErrors, videoStreamTimelineErrors],
  ];
  const lastUpdatedItems = [
    [
      appCopy.metricLastAutoVisionAt,
      lastAutoVisionAt
        ? new Date(lastAutoVisionAt).toLocaleTimeString()
        : appCopy.noAutoVisionYet,
    ],
    [
      appCopy.metricLastActionTimelineAt,
      lastActionTimelineAt
        ? new Date(lastActionTimelineAt).toLocaleTimeString()
        : appCopy.noAutoVisionYet,
    ],
    [
      appCopy.metricLastVideoStreamAt,
      lastVideoStreamAt
        ? new Date(lastVideoStreamAt).toLocaleTimeString()
        : appCopy.noAutoVisionYet,
    ],
    [
      "本次回复上下文",
      replyContextTimestamp
        ? new Date(replyContextTimestamp).toLocaleTimeString()
        : appCopy.noAutoVisionYet,
    ],
    [appCopy.metricLastStreamError, lastVideoStreamError ?? appCopy.noAutoVisionYet],
  ];
  const ObservationPanel = () => (
    <Card className="context-card vision-card">
      <CardHeader>
        <p className="eyebrow">{appCopy.observationTitle}</p>
        <CardTitle>{appCopy.currentViewTitle}</CardTitle>
        <CardDescription>{appCopy.updatedAt} {latestObservationAt}</CardDescription>
      </CardHeader>
      <CardContent>
        <p className="summary">{observationText}</p>
        <Badge className={`sync-status ${visionContextSyncState}`} variant="muted">
          {appCopy.visionContextSyncLabels[visionContextSyncState]}
          {visionContextSyncedAt
            ? ` · ${new Date(visionContextSyncedAt).toLocaleTimeString()}`
            : ""}
        </Badge>
      </CardContent>
    </Card>
  );
  const RecentChangePanel = () => (
    <Card className="context-card action-card">
      <CardHeader>
        <p className="eyebrow">{appCopy.changeTitle}</p>
        <CardTitle>{appCopy.recentActionTitle}</CardTitle>
        <CardDescription>{appCopy.updatedAt} {latestChangeAt}</CardDescription>
      </CardHeader>
      <CardContent>
        <p className="summary">{changeText}</p>
        {lastActionTimeline?.steps.length ? (
          <ul className="action-steps">
            {lastActionTimeline.steps.map((step) => (
              <li key={`${step.timeRange}-${step.description}`}>
                <span>{step.timeRange}</span>
                {step.description}
              </li>
            ))}
          </ul>
        ) : null}
        {lastActionTimeline ? (
          <p className="confidence-note">
            {appCopy.confidenceNoteLabel}: {lastActionTimeline.confidenceNote}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );

  return (
    <main className="shell dark">
      <aside className="sidebar">
        <div className="brand-block">
          <div className="brand-mark">
            <Sparkles size={18} />
          </div>
          <div>
            <p className="eyebrow">AI Vision</p>
            <h1>{appCopy.title}</h1>
          </div>
        </div>

        <Card className="session-card active">
          <CardContent>
            <span>{appCopy.currentSession}</span>
            <strong>{phaseLabels[phase]}</strong>
            <p>{sceneModeProfile.label}</p>
          </CardContent>
        </Card>

        <Card className={`history-card ${historyOpen ? "open" : ""}`}>
          <button
            className="history-toggle"
            onClick={toggleSessionHistory}
            type="button"
          >
            <span className="history-toggle-icon">
              <MessageCircle size={16} />
            </span>
            <span>
              <strong>{appCopy.historyTitle}</strong>
              <small>
                {sessionHistory.length
                  ? `${appCopy.historyCountPrefix}${sessionHistory.length}${appCopy.historyCountSuffix}`
                  : appCopy.historyCollapsedHint}
              </small>
            </span>
            <span className="history-toggle-action">
              {historyOpen ? appCopy.historyCollapse : appCopy.historyExpand}
            </span>
          </button>
        </Card>

        <div className="timeline" ref={timelineRef} aria-live="polite">
          {messages.map((message) => (
            <div className={`message ${message.role}`} key={message.id}>
              <span>
                {message.role === "assistant" ? "AI" : message.role === "user" ? "User" : "System"}
              </span>
              <p>{message.content}</p>
            </div>
          ))}
        </div>

        <form className="typed-question-form" onSubmit={submitTypedQuestion}>
          <textarea
            ref={typedQuestionInputRef}
            aria-label="输入文字问题"
            className="typed-question-input"
            disabled={backendStatus !== "online"}
            onChange={(event) => setTypedQuestion(event.target.value)}
            onKeyDown={handleTypedQuestionKeyDown}
            placeholder={typedQuestionPlaceholder}
            rows={3}
            value={typedQuestion}
          />
          <Button
            className="typed-question-submit"
            disabled={!canSubmitTypedQuestion}
            title="发送文字问题"
            type="submit"
          >
            <Send size={17} />
            发送
          </Button>
        </form>
      </aside>

      <section className="stage">
        <header className="topbar">
          <div>
            <p className="eyebrow">{appCopy.realtimeLabel}</p>
            <h2>{appCopy.stageTitle}</h2>
          </div>
          <Badge className={`status ${phase}`} variant="default">
            <Activity size={14} />
            {phaseLabels[phase]}
          </Badge>
        </header>

        <Card className={`voice-status-card ${phase}`}>
          <CardContent>
            <div className="voice-status-main">
              <div className="voice-status-icon">
                {phase === "speaking" ? <Volume2 size={20} /> : <Mic size={20} />}
              </div>
              <div>
                <p className="eyebrow">{appCopy.voiceStatusTitle}</p>
                <strong>{voiceStatusLabel}</strong>
                <span>{voiceStatusHint}</span>
              </div>
            </div>
            {lastHeardText ? (
              <Badge variant="muted">
                {appCopy.heardPrefix}{lastHeardText}
              </Badge>
            ) : null}
          </CardContent>
        </Card>

        {isBackendOffline ? (
          <Alert className="status-alert">
            <AlertTriangle size={16} />
            <span>{appCopy.backendOfflineMessage}</span>
          </Alert>
        ) : null}

        {waitingForFreshVision ? (
          <Alert className="status-alert waiting">
            <Radio size={16} />
            <span>正在等待最新视觉上下文，最多约 1.5 秒。</span>
          </Alert>
        ) : null}

        {visionUpdatedDuringReply ? (
          <Alert className="status-alert info">
            <ScanEye size={16} />
            <span>画面已更新，下一轮回答将使用最新视觉上下文。</span>
          </Alert>
        ) : null}

        <Tabs
          className="scene-tabs"
          value={sceneMode}
          onValueChange={(value) => setSceneMode(normalizeSceneMode(value))}
        >
          <TabsList>
            {sceneModeOptions.map(([mode, profile]) => (
              <TabsTrigger key={mode} value={mode}>
                {profile.label}
              </TabsTrigger>
            ))}
            <TabsTrigger value="custom">
              {appCopy.customModeLabel}
            </TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="video-wrap">
          <div className="video-status-rail">
            {statusItems.map((item) => {
              const Icon = item.icon;
              return (
                <Badge key={item.label} variant={item.variant}>
                  <Icon size={13} />
                  {item.label}
                </Badge>
              );
            })}
          </div>
          {cameraEnabled ? (
            <video
              ref={bindVideoElement}
              autoPlay
              playsInline
              muted
              onLoadedMetadata={() => {
                void videoRef.current?.play().catch(() => undefined);
              }}
            />
          ) : (
            <div className="empty-video">
              <Camera size={44} />
              <strong>{appCopy.emptyVideo}</strong>
              <span>Connect devices to start visual conversation.</span>
            </div>
          )}
          <canvas ref={canvasRef} hidden />
          {cameraDiagnostics ? (
            <div className="camera-diagnostics">
              <strong>{cameraDiagnostics.label}</strong>
              <span>
                {cameraDiagnostics.width || "-"} x {cameraDiagnostics.height || "-"} · {cameraDiagnostics.readyState}
                {cameraDiagnostics.muted ? ` · ${appCopy.cameraMutedState}` : ""}
              </span>
            </div>
          ) : null}
        </div>

        <Card className="control-card">
          <CardContent className="controlbar">
            <Button onClick={startMedia} disabled={cameraEnabled} title={appCopy.connectTitle}>
              <PhoneCall size={18} />
              {appCopy.connect}
            </Button>
            <Button variant="secondary" onClick={toggleMic} disabled={!stream || stream.getAudioTracks().length === 0} title={appCopy.toggleMicTitle}>
              {micEnabled ? <Mic size={18} /> : <MicOff size={18} />}
              {appCopy.toggleMic}
            </Button>
            <Button variant="secondary" onClick={toggleCamera} disabled={!stream} title={appCopy.toggleCameraTitle}>
              {cameraEnabled ? <Video size={18} /> : <VideoOff size={18} />}
              {appCopy.toggleCamera}
            </Button>
            <Button variant="outline" onClick={analyzeFrame} disabled={!cameraEnabled} title={appCopy.analyzeFrameTitle}>
              <ScanEye size={18} />
              {appCopy.analyzeFrame}
            </Button>
            <Button variant="outline" onClick={interruptAssistantSpeech} disabled={!isInterruptible} title={appCopy.interruptSpeechTitle}>
              <CircleStop size={18} />
              {appCopy.interruptSpeech}
            </Button>
            <Button variant="outline" onClick={replayLastAssistantReply} disabled={!canReplayLastReply || phase === "thinking"} title={appCopy.replaySpeechTitle}>
              <RotateCcw size={18} />
              {appCopy.replaySpeech}
            </Button>
            <Button variant="destructive" onClick={stopMedia} disabled={!stream} title={appCopy.endSessionTitle}>
              <CircleStop size={18} />
              {appCopy.endSession}
            </Button>
            <label className="speech-rate-control" title={appCopy.speechRateTitle}>
              <span>
                {appCopy.speechRateLabel}
                <strong>{speechRate.toFixed(1)}x</strong>
              </span>
              <input
                aria-label={appCopy.speechRateTitle}
                max={maxSpeechRate}
                min={minSpeechRate}
                onChange={(event) =>
                  setSpeechRate(clampSpeechRate(Number(event.target.value)))
                }
                step={0.1}
                type="range"
                value={speechRate}
              />
            </label>
          </CardContent>
        </Card>
      </section>

      <aside className={`inspector ${prioritizeActionPanel ? "prioritize-action" : ""}`}>
        <Card className="scene-panel">
          <CardHeader>
            <p className="eyebrow">{appCopy.assistantPanelLabel}</p>
            <CardTitle>{sceneModeProfile.label}</CardTitle>
            <CardDescription>{sceneModeProfile.description}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="scene-tags">
              {sceneModeProfile.focus.map((item) => (
                <Badge key={item} variant="success">{item}</Badge>
              ))}
            </div>
            <p className="panel-section-title">{appCopy.demoQuestionsTitle}</p>
            <div className="quick-question-list">
              {sceneModeProfile.examples.map((example) => (
                <Button
                  key={example}
                  disabled={backendStatus !== "online" || phase === "thinking"}
                  onClick={() => submitQuestionText(example)}
                  title={appCopy.askQuestionTitle}
                  type="button"
                  variant="outline"
                >
                  {example}
                </Button>
              ))}
            </div>
            <Separator />
            <p className="panel-section-title">{appCopy.nextStepsTitle}</p>
            <ul className="scene-examples">
              {sceneModeProfile.nextSteps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ul>
            {sceneMode === "custom" ? (
              <>
                <Separator />
                <div className="custom-mode-tools">
                  <div className="custom-mode-header">
                    <p className="panel-section-title">{appCopy.customModeEditTitle}</p>
                    <Button
                      onClick={createCustomSceneMode}
                      type="button"
                      variant="ghost"
                    >
                      {appCopy.customModeCreate}
                    </Button>
                  </div>
                  {customSceneModes.length ? (
                    <div className="custom-mode-list" aria-label={appCopy.customModeSelect}>
                      {customSceneModes.map((mode) => (
                        <Button
                          key={mode.id}
                          onClick={() => editCustomSceneMode(mode)}
                          type="button"
                          variant={mode.id === selectedCustomSceneModeId ? "default" : "outline"}
                        >
                          {mode.label}
                        </Button>
                      ))}
                    </div>
                  ) : (
                    <p className="custom-mode-empty">
                      {appCopy.customModeEmptyTitle}：{appCopy.customModeEmptyDescription}
                    </p>
                  )}
                  <p className="custom-mode-hint">{appCopy.customModeLimitHint}</p>
                  <label>
                    <span>{appCopy.customModeName}</span>
                    <input
                      className="custom-mode-input"
                      maxLength={20}
                      onChange={(event) => updateCustomDraft("label", event.target.value)}
                      value={customSceneDraft.label}
                    />
                  </label>
                  <label>
                    <span>{appCopy.customModeDescription}</span>
                    <textarea
                      className="custom-mode-textarea"
                      maxLength={120}
                      onChange={(event) => updateCustomDraft("description", event.target.value)}
                      rows={2}
                      value={customSceneDraft.description}
                    />
                  </label>
                  <label>
                    <span>{appCopy.customModeRole}</span>
                    <textarea
                      className="custom-mode-textarea"
                      maxLength={120}
                      onChange={(event) => updateCustomDraft("role", event.target.value)}
                      rows={2}
                      value={customSceneDraft.role}
                    />
                  </label>
                  <label>
                    <span>{appCopy.customModeMission}</span>
                    <textarea
                      className="custom-mode-textarea"
                      maxLength={120}
                      onChange={(event) => updateCustomDraft("mission", event.target.value)}
                      rows={2}
                      value={customSceneDraft.mission}
                    />
                  </label>
                  <label>
                    <span>{appCopy.customModeStyle}</span>
                    <textarea
                      className="custom-mode-textarea"
                      maxLength={120}
                      onChange={(event) => updateCustomDraft("style", event.target.value)}
                      rows={2}
                      value={customSceneDraft.style}
                    />
                  </label>
                  <label>
                    <span>{appCopy.customModeFocus}</span>
                    <textarea
                      className="custom-mode-textarea"
                      onChange={(event) => updateCustomDraftList("focus", event.target.value)}
                      placeholder={appCopy.customModeListHint}
                      rows={3}
                      value={customSceneDraft.focus.join("\n")}
                    />
                  </label>
                  <label>
                    <span>{appCopy.customModeExamples}</span>
                    <textarea
                      className="custom-mode-textarea"
                      onChange={(event) => updateCustomDraftList("examples", event.target.value)}
                      placeholder={appCopy.customModeListHint}
                      rows={3}
                      value={customSceneDraft.examples.join("\n")}
                    />
                  </label>
                  <label>
                    <span>{appCopy.customModeNextSteps}</span>
                    <textarea
                      className="custom-mode-textarea"
                      onChange={(event) => updateCustomDraftList("nextSteps", event.target.value)}
                      placeholder={appCopy.customModeListHint}
                      rows={3}
                      value={customSceneDraft.nextSteps.join("\n")}
                    />
                  </label>
                  <label>
                    <span>{appCopy.customModeGuardrail}</span>
                    <textarea
                      className="custom-mode-textarea"
                      maxLength={120}
                      onChange={(event) => updateCustomDraft("guardrail", event.target.value)}
                      rows={2}
                      value={customSceneDraft.guardrail}
                    />
                  </label>
                  <div className="custom-mode-actions">
                    <Button onClick={saveCustomSceneMode} type="button">
                      {appCopy.customModeSave}
                    </Button>
                    <Button
                      disabled={!customSceneDraft.id}
                      onClick={deleteCustomSceneMode}
                      type="button"
                      variant="outline"
                    >
                      {appCopy.customModeDelete}
                    </Button>
                  </div>
                </div>
              </>
            ) : null}
          </CardContent>
        </Card>

        {prioritizeActionPanel ? (
          <>
            <RecentChangePanel />
            <ObservationPanel />
          </>
        ) : (
          <>
            <ObservationPanel />
            <RecentChangePanel />
          </>
        )}

        <Card className="metrics-panel">
          <CardHeader>
            <p className="eyebrow">Runtime</p>
            <CardTitle>{appCopy.costDebugTitle}</CardTitle>
            <CardDescription>
              {debugPanelOpen ? appCopy.costDebugExpanded : appCopy.costDebugCollapsed}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="cost-summary">
              <Badge variant="success">{costDebugSummary}</Badge>
              <Button
                onClick={() => setDebugPanelOpen((value) => !value)}
                type="button"
                variant="ghost"
              >
                {debugPanelOpen ? appCopy.hideDebug : appCopy.showDebug}
              </Button>
            </div>
            {debugPanelOpen ? (
              <>
                <div className="metric-grid primary">
                  {primaryMetrics.map(([label, value]) => (
                    <div key={label}>
                      <span>{label}</span>
                      <strong>{value}</strong>
                    </div>
                  ))}
                </div>
                <Separator />
                <div className="metric-list">
                  {streamMetrics.map(([label, value]) => (
                    <div key={label}>
                      <span>{label}</span>
                      <strong>{value}</strong>
                    </div>
                  ))}
                  <div>
                    <span>{appCopy.metricFrameFingerprint}</span>
                    <strong>{lastFrameFingerprint ? appCopy.fingerprintReady : appCopy.fingerprintPending}</strong>
                  </div>
                </div>
                <Separator />
                <div className="metric-list compact">
                  {lastUpdatedItems.map(([label, value]) => (
                    <div key={label}>
                      <span>{label}</span>
                      <strong>{value}</strong>
                    </div>
                  ))}
                </div>
                <Separator />
                <p className="panel-section-title">{appCopy.costStrategyLabel}</p>
                <ul className="strategy-list">
                  {appCopy.strategies.map((strategy) => (
                    <li key={strategy}>{strategy}</li>
                  ))}
                </ul>
              </>
            ) : null}
          </CardContent>
        </Card>
      </aside>

      {historyOpen ? (
        <div className="history-overlay" role="dialog" aria-modal="true">
          <Card className="history-modal">
            <div className="history-modal-header">
              <div>
                <p className="eyebrow">{appCopy.historyEyebrow}</p>
                <h2>
                  {selectedHistory
                    ? appCopy.historyDetailTitle
                    : appCopy.historyTitle}
                </h2>
                <span>
                  {selectedHistory
                    ? selectedHistory.endedAt
                      ? new Date(selectedHistory.endedAt).toLocaleString()
                      : appCopy.historyNoEndTime
                    : appCopy.historyDescription}
                </span>
              </div>
              <Button
                onClick={() => {
                  closeHistoryDetail();
                  setHistoryOpen(false);
                }}
                type="button"
                variant="outline"
              >
                {appCopy.historyClose}
              </Button>
            </div>

            <div className="history-modal-body">
              {historyError ? (
                <Alert className="status-alert">
                  <AlertTriangle size={16} />
                  <span>{historyError}</span>
                </Alert>
              ) : null}
              {historyLoading ? (
                <p className="history-empty">{appCopy.historyLoading}</p>
              ) : null}
              {!historyLoading && selectedHistory ? (
                <div className="history-modal-detail">
                  <div className="history-detail-media">
                    <div className="history-frame">
                      {selectedHistoryFrameUrl ? (
                        <img
                          alt={appCopy.historyFinalFrame}
                          src={selectedHistoryFrameUrl}
                        />
                      ) : (
                        <span>{appCopy.historyNoFinalFrame}</span>
                      )}
                    </div>
                    <div className="history-meta">
                      <span>
                        {selectedHistory.messageCount}
                        {appCopy.historyMessagesUnit}
                      </span>
                      <span>
                        {selectedHistory.metrics?.visionRequests ?? 0}
                        {appCopy.historyVisionRequestsUnit}
                      </span>
                    </div>
                    <div className="history-detail-actions">
                      <Button
                        onClick={closeHistoryDetail}
                        type="button"
                        variant="outline"
                      >
                        {appCopy.historyBack}
                      </Button>
                    </div>
                  </div>
                  <div className="history-messages">
                    {selectedHistory.messages.map((message) => (
                      <div
                        className={`message ${message.role}`}
                        key={message.id}
                      >
                        <span>
                          {message.role === "assistant" ? "AI" : "User"}
                        </span>
                        <p>{message.content}</p>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
              {!historyLoading && !selectedHistory ? (
                <div className="history-modal-list">
                  <div className="history-list">
                    {sessionHistory.length ? (
                      sessionHistory.map((item) => (
                        <button
                          className="history-item"
                          key={item.sessionId}
                          onClick={() => openHistoryDetail(item.sessionId)}
                          type="button"
                        >
                          <strong>
                            {item.endedAt
                              ? new Date(item.endedAt).toLocaleString()
                              : appCopy.historyNoEndTime}
                          </strong>
                          <span>
                            {item.messageCount}
                            {appCopy.historyMessagesUnit} ·{" "}
                            {item.finalFrame
                              ? appCopy.historyHasFinalFrame
                              : appCopy.historyNoFinalFrame}
                          </span>
                        </button>
                      ))
                    ) : (
                      <p className="history-empty">{appCopy.historyEmpty}</p>
                    )}
                  </div>
                </div>
              ) : null}
            </div>
          </Card>
        </div>
      ) : null}
    </main>  );
};

