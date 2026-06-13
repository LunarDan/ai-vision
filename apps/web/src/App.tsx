import {
  Camera,
  CircleStop,
  Eye,
  EyeOff,
  Mic,
  MicOff,
  PhoneCall,
  ScanEye,
  Video,
  VideoOff,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  AssistantPhase,
  ConversationResponse,
  SessionMetrics,
  VisionActionTimeline,
  VisionSummary,
} from "@ai-vision/shared";
import { appCopy, phaseLabels } from "./copy.js";

const apiBase = "/api";
const defaultAutoObserveIntervalMs = 10000;
const slowAutoObserveIntervalMs = 25000;
const staleVisionContextMs = 30000;
const maxAutoVisionRequestsPerMinute = 6;
const frameDiffThreshold = 10;
const stableFrameSlowdownThreshold = 3;
const actionSampleIntervalMs = 500;
const actionWindowMs = 6000;
const actionAnalyzeIntervalMs = 6000;
const maxActionFrames = 12;
const maxSequenceFrames = 4;
const actionFrameDiffThreshold = 8;
const minActionFramesForSequence = 2;
const actionFrameWidth = 256;
const actionFrameQuality = 0.38;
const actionQuestionBurstFrames = 4;

type TimelineMessage = {
  role: "assistant" | "system" | "user";
  content: string;
};

type VisionContextSyncState = "idle" | "pending" | "synced" | "failed";
type BackendStatus = "unknown" | "online" | "offline";

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
  const [videoElement, setVideoElement] = useState<HTMLVideoElement | null>(
    null,
  );
  const [phase, setPhase] = useState<AssistantPhase>("idle");
  const [sessionId] = useState(() => crypto.randomUUID());
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
  const [messages, setMessages] = useState<TimelineMessage[]>([
    { role: "assistant", content: appCopy.initialAssistantMessage },
  ]);

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  useEffect(() => {
    backendStatusRef.current = backendStatus;
  }, [backendStatus]);

  useEffect(() => {
    autoObserveEnabledRef.current = autoObserveEnabled;
  }, [autoObserveEnabled]);

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

  const appendMessage = (message: TimelineMessage) => {
    setMessages((items) => [...items, message]);
  };

  const appendSystemMessage = (content: string) =>
    appendMessage({ role: "system", content });
  const appendAssistantMessage = (content: string) =>
    appendMessage({ role: "assistant", content });

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

  const syncVisionContext = (
    snapshot: VisionSummary,
    options: { silent?: boolean } = {},
  ) => {
    void snapshot;
    setVisionContextSyncState("synced");
    setVisionContextSyncedAt(new Date().toISOString());
    if (!options.silent) {
      appendSystemMessage(appCopy.visionContextSynced);
    }
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

    updateActionFrames([
      ...actionFramesRef.current,
      {
        ...capturedFrame,
        id: crypto.randomUUID(),
        capturedAt: new Date().toISOString(),
      },
    ]);
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

  const analyzeActionSequence = async () => {
    if (!canRunActionCapture()) {
      scheduleActionAnalyze();
      return null;
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
      actionAnalyzeErrorNotifiedRef.current = false;
      lastActionTimelineRef.current = data.timeline;
      setLastActionTimeline(data.timeline);
      setLastActionTimelineAt(data.timeline.createdAt);
      setActionSequenceRequestCount((count) => count + 1);
      return data.timeline;
    } catch {
      if (!actionAnalyzeErrorNotifiedRef.current) {
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
        updateActionFrames([
          ...actionFramesRef.current,
          {
            ...capturedFrame,
            id: crypto.randomUUID(),
            capturedAt: new Date().toISOString(),
          },
        ]);
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
      scheduleActionAnalyze(1800);
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

  const askAssistant = async (text: string) => {
    setPhase("thinking");

    try {
      let currentVisionSummary = visionSummaryRef.current;
      let currentActionTimeline = lastActionTimelineRef.current;
      if (
        videoReadyRef.current &&
        (isVisionContextStale(currentVisionSummary) || isVisualQuestion(text))
      ) {
        appendSystemMessage(appCopy.autoVisionCaptureMessage);
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
        currentActionTimeline =
          (await analyzeActionSequence()) ?? currentActionTimeline;
      }

      const response = await fetch(`${apiBase}/conversation/respond`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId,
          text,
          visionSummary: currentVisionSummary,
          visionTimeline: currentActionTimeline,
        }),
      });

      if (!response.ok) {
        throw new Error(`Conversation API failed with ${response.status}`);
      }

      const data = (await response.json()) as ConversationResponse;
      appendAssistantMessage(data.reply);
      setPhase("speaking");
      stopSpeechRecognition(false);

      if ("speechSynthesis" in window) {
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(data.reply);
        utterance.lang = "zh-CN";
        let speechFinished = false;
        const resumeAfterSpeech = () => {
          if (speechFinished) return;
          speechFinished = true;
          setPhase("listening");
          resumeSpeechRecognition();
        };
        const fallbackMs = Math.max(
          3500,
          Math.min(18000, data.reply.length * 220),
        );
        const speechFallbackTimer = window.setTimeout(
          resumeAfterSpeech,
          fallbackMs,
        );
        utterance.onend = () => {
          window.clearTimeout(speechFallbackTimer);
          resumeAfterSpeech();
        };
        utterance.onerror = () => {
          window.clearTimeout(speechFallbackTimer);
          resumeAfterSpeech();
        };
        window.speechSynthesis.speak(utterance);
      } else {
        setPhase("listening");
        resumeSpeechRecognition();
      }
    } catch {
      setPhase("listening");
      appendSystemMessage(appCopy.conversationError);
      resumeSpeechRecognition();
    }
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

  const createMediaStream = (cameraDeviceId = selectedCameraDeviceId) => {
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

    return navigator.mediaDevices.getUserMedia({
      video,
      audio: true,
    });
  };

  const startMedia = async () => {
    let mediaStream: MediaStream | null = null;
    try {
      setPhase("connecting");
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
        throw new Error("INSECURE_MEDIA_CONTEXT");
      }

      mediaStream = await createMediaStream();
      const videoTrack = mediaStream.getVideoTracks()[0];
      mediaSessionActiveRef.current = true;
      streamRef.current = mediaStream;
      setStream(mediaStream);
      setCameraEnabled(true);
      setMicEnabled(true);
      setAutoObserveEnabled(true);
      setSelectedCameraDeviceId(
        videoTrack?.getSettings().deviceId || selectedCameraDeviceId,
      );
      updateCameraDiagnostics(mediaStream, videoRef.current);
      void refreshCameraDevices();
      appendSystemMessage(appCopy.mediaConnectedMessage);
      const backendReady = await checkBackendHealth();
      if (backendReady) {
        setPhase("listening");
        appendSystemMessage(appCopy.realtimeConnectedMessage);
        startSpeechRecognition();
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
      appendSystemMessage(
        error instanceof Error && error.message === "INSECURE_MEDIA_CONTEXT"
          ? appCopy.cameraSecureContextError
          : appCopy.cameraPermissionError,
      );
    }
  };

  const stopMedia = async () => {
    mediaSessionActiveRef.current = false;
    stopSpeechRecognition(false);
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

    try {
      await fetch(`${apiBase}/session/end`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId,
          metrics: { ...metrics, endedAt: new Date().toISOString() },
        }),
      });
    } catch {
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
      const mediaStream = await createMediaStream(deviceId);
      mediaSessionActiveRef.current = true;
      streamRef.current = mediaStream;
      setStream(mediaStream);
      setCameraEnabled(true);
      setMicEnabled(true);
      updateCameraDiagnostics(mediaStream, videoRef.current);
      appendSystemMessage(appCopy.cameraSwitchedMessage);
      setPhase(backendStatus === "online" ? "listening" : "error");
      if (backendStatusRef.current === "online") {
        resumeSpeechRecognition();
      }
    } catch {
      mediaSessionActiveRef.current = false;
      streamRef.current = null;
      setCameraEnabled(false);
      setPhase("error");
      appendSystemMessage(appCopy.cameraPermissionError);
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

  return (
    <main className="shell">
      <aside className="sidebar">
        <div>
          <p className="eyebrow">AI Vision</p>
          <h1>{appCopy.title}</h1>
        </div>
        <div className="session-card active">
          <span>{appCopy.currentSession}</span>
          <strong>{phaseLabels[phase]}</strong>
        </div>
        <div className="timeline" ref={timelineRef}>
          {messages.map((message, index) => (
            <div className="message" key={`${message.role}-${index}`}>
              <span>{message.role}</span>
              <p>{message.content}</p>
            </div>
          ))}
        </div>
      </aside>

      <section className="stage">
        <header className="topbar">
          <div>
            <p className="eyebrow">{appCopy.realtimeLabel}</p>
            <h2>{appCopy.stageTitle}</h2>
          </div>
          <div className={`status ${phase}`}>{phaseLabels[phase]}</div>
        </header>

        <div className="video-wrap">
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
              {appCopy.emptyVideo}
            </div>
          )}
          <canvas ref={canvasRef} hidden />
          {cameraDiagnostics ? (
            <div className="camera-diagnostics">
              <strong>{cameraDiagnostics.label}</strong>
              <span>
                {cameraDiagnostics.width || "-"} x{" "}
                {cameraDiagnostics.height || "-"} ·{" "}
                {cameraDiagnostics.readyState}
                {cameraDiagnostics.muted
                  ? ` · ${appCopy.cameraMutedState}`
                  : ""}
              </span>
            </div>
          ) : null}
          <div className="video-overlay">
            <span>
              {cameraEnabled
                ? videoReady
                  ? appCopy.cameraOnline
                  : appCopy.cameraStarting
                : appCopy.cameraOffline}
            </span>
            <span>{micEnabled ? appCopy.micOnline : appCopy.micMuted}</span>
            <span>
              {backendStatus === "online"
                ? appCopy.backendOnline
                : backendStatus === "offline"
                  ? appCopy.backendOffline
                  : appCopy.backendUnknown}
            </span>
          </div>
        </div>

        <div className="controlbar">
          <label className="device-select">
            <span>{appCopy.cameraDeviceLabel}</span>
            <select
              value={selectedCameraDeviceId}
              disabled={cameraDevices.length === 0}
              onChange={(event) => {
                void switchCamera(event.target.value);
              }}
            >
              {cameraDevices.length === 0 ? (
                <option value="">{appCopy.cameraDevicePlaceholder}</option>
              ) : (
                cameraDevices.map((device, index) => (
                  <option key={device.deviceId} value={device.deviceId}>
                    {device.label || `${appCopy.unknownCamera} ${index + 1}`}
                  </option>
                ))
              )}
            </select>
          </label>
          <button
            onClick={startMedia}
            disabled={cameraEnabled}
            title={appCopy.connectTitle}
          >
            <PhoneCall size={18} />
            {appCopy.connect}
          </button>
          <button
            onClick={toggleMic}
            disabled={!stream}
            title={appCopy.toggleMicTitle}
          >
            {micEnabled ? <Mic size={18} /> : <MicOff size={18} />}
            {appCopy.toggleMic}
          </button>
          <button
            onClick={toggleCamera}
            disabled={!stream}
            title={appCopy.toggleCameraTitle}
          >
            {cameraEnabled ? <Video size={18} /> : <VideoOff size={18} />}
            {appCopy.toggleCamera}
          </button>
          <button
            onClick={() => setAutoObserveEnabled((value) => !value)}
            disabled={!stream}
            title={appCopy.autoObserveTitle}
          >
            {autoObserveEnabled ? <Eye size={18} /> : <EyeOff size={18} />}
            {appCopy.autoObserve}
          </button>
          <button
            onClick={analyzeFrame}
            disabled={!cameraEnabled}
            title={appCopy.analyzeFrameTitle}
          >
            <ScanEye size={18} />
            {appCopy.analyzeFrame}
          </button>
          <button
            onClick={stopMedia}
            disabled={!stream}
            title={appCopy.endSessionTitle}
          >
            <CircleStop size={18} />
            {appCopy.endSession}
          </button>
        </div>
      </section>

      <aside className="inspector">
        <section>
          <p className="eyebrow">{appCopy.visionSummaryLabel}</p>
          <h3>{appCopy.currentViewTitle}</h3>
          <p className="summary">
            {visionSummary?.summary ?? appCopy.emptySummary}
          </p>
          <small>
            {visionSummary
              ? `${appCopy.updatedAt} ${new Date(visionSummary.createdAt).toLocaleTimeString()}`
              : appCopy.waitingFirstFrame}
          </small>
          <div className={`sync-status ${visionContextSyncState}`}>
            {appCopy.visionContextSyncLabels[visionContextSyncState]}
            {visionContextSyncedAt
              ? ` · ${new Date(visionContextSyncedAt).toLocaleTimeString()}`
              : ""}
          </div>
        </section>

        <section>
          <p className="eyebrow">{appCopy.actionTimelineLabel}</p>
          <h3>{appCopy.recentActionTitle}</h3>
          <p className="summary">
            {lastActionTimeline?.summary ?? appCopy.emptyActionTimeline}
          </p>
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
            <small>
              {appCopy.confidenceNoteLabel}:{" "}
              {lastActionTimeline.confidenceNote}
            </small>
          ) : null}
        </section>

        <section className="metric-grid">
          <div>
            <span>{appCopy.metricVisionRequests}</span>
            <strong>{metrics.visionRequests}</strong>
          </div>
          <div>
            <span>{appCopy.metricLowDetail}</span>
            <strong>{metrics.lowDetailRequests}</strong>
          </div>
          <div>
            <span>{appCopy.metricHighDetail}</span>
            <strong>{metrics.highDetailRequests}</strong>
          </div>
          <div>
            <span>{appCopy.metricCostLevel}</span>
            <strong>{costLevel}</strong>
          </div>
          <div>
            <span>{appCopy.metricAutoVisionRequests}</span>
            <strong>{autoVisionRequestCount}</strong>
          </div>
          <div>
            <span>{appCopy.metricSkippedFrames}</span>
            <strong>{skippedFrameCount}</strong>
          </div>
          <div>
            <span>{appCopy.metricLastAutoVisionAt}</span>
            <strong className="compact-metric">
              {lastAutoVisionAt
                ? new Date(lastAutoVisionAt).toLocaleTimeString()
                : appCopy.noAutoVisionYet}
            </strong>
          </div>
          <div>
            <span>{appCopy.metricFrameFingerprint}</span>
            <strong className="compact-metric">
              {lastFrameFingerprint
                ? appCopy.fingerprintReady
                : appCopy.fingerprintPending}
            </strong>
          </div>
          <div>
            <span>{appCopy.metricActionSamples}</span>
            <strong>{actionSampleCount}</strong>
          </div>
          <div>
            <span>{appCopy.metricDedupedActionFrames}</span>
            <strong>{dedupedActionFrameCount}</strong>
          </div>
          <div>
            <span>{appCopy.metricActionSequenceRequests}</span>
            <strong>{actionSequenceRequestCount}</strong>
          </div>
          <div>
            <span>{appCopy.metricActionBuffer}</span>
            <strong>{actionFrames.length}</strong>
          </div>
          <div>
            <span>{appCopy.metricLastActionTimelineAt}</span>
            <strong className="compact-metric">
              {lastActionTimelineAt
                ? new Date(lastActionTimelineAt).toLocaleTimeString()
                : appCopy.noAutoVisionYet}
            </strong>
          </div>
        </section>

        <section>
          <p className="eyebrow">{appCopy.costStrategyLabel}</p>
          <ul className="strategy-list">
            {appCopy.strategies.map((strategy) => (
              <li key={strategy}>{strategy}</li>
            ))}
          </ul>
        </section>
      </aside>
    </main>
  );
};
