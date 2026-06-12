import {
  Camera,
  CircleStop,
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
  VisionSummary,
} from "@ai-vision/shared";
import { appCopy, phaseLabels } from "./copy.js";

const apiBase = "/api";

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
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const recognitionRestartTimerRef = useRef<number | null>(null);
  const shouldKeepListeningRef = useRef(false);
  const backendStatusRef = useRef<BackendStatus>("unknown");
  const mediaSessionActiveRef = useRef(false);
  const streamRef = useRef<MediaStream | null>(null);
  const videoReadyRef = useRef(false);
  const visionSummaryRef = useRef<VisionSummary | null>(null);
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
    backendStatusRef.current = backendStatus;
  }, [backendStatus]);

  useEffect(() => {
    streamRef.current = stream;
  }, [stream]);

  useEffect(() => {
    videoReadyRef.current = videoReady;
  }, [videoReady]);

  useEffect(() => {
    visionSummaryRef.current = visionSummary;
  }, [visionSummary]);

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
      setVideoReady(true);
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

  const captureCurrentFrame = () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || !videoReadyRef.current || video.readyState < 2) {
      return null;
    }

    const width = 768;
    const ratio = video.videoHeight / video.videoWidth || 0.5625;
    canvas.width = width;
    canvas.height = Math.round(width * ratio);
    canvas
      .getContext("2d")
      ?.drawImage(video, 0, 0, canvas.width, canvas.height);

    return canvas.toDataURL("image/jpeg", 0.72);
  };

  const analyzeCurrentFrame = async (reason: "manual" | "visual-question") => {
    const imageBase64 = captureCurrentFrame();
    if (!imageBase64) {
      appendSystemMessage(appCopy.cameraNotReadyMessage);
      return null;
    }

    const response = await fetch(`${apiBase}/vision/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId,
        imageBase64,
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
    syncVisionContext(data.snapshot);
    setMetrics((current) => ({
      ...current,
      visionRequests: current.visionRequests + 1,
      lowDetailRequests: current.lowDetailRequests + 1,
      uploadedImageBytes: current.uploadedImageBytes + data.snapshot.imageBytes,
    }));
    return data.snapshot;
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

  const syncVisionContext = (snapshot: VisionSummary) => {
    void snapshot;
    setVisionContextSyncState("synced");
    setVisionContextSyncedAt(new Date().toISOString());
    appendSystemMessage(appCopy.visionContextSynced);
  };

  const askAssistant = async (text: string) => {
    setPhase("thinking");

    try {
      let currentVisionSummary = visionSummaryRef.current;
      if (videoReadyRef.current) {
        appendSystemMessage(appCopy.autoVisionCaptureMessage);
        try {
          currentVisionSummary =
            (await analyzeCurrentFrame("visual-question")) ??
            currentVisionSummary;
        } catch {
          appendSystemMessage(appCopy.autoVisionCaptureFailed);
        }
      }

      const response = await fetch(`${apiBase}/conversation/respond`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId,
          text,
          visionSummary: currentVisionSummary,
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
      setBackendStatus("offline");
      backendStatusRef.current = "offline";
      shouldKeepListeningRef.current = false;
      appendSystemMessage(appCopy.conversationError);
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
    stream?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setStream(null);
    setCameraEnabled(false);
    setVideoReady(false);
    setCameraDiagnostics(null);
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
      setVideoReady(false);
    }
    setCameraEnabled((value) => !value);
  };

  const switchCamera = async (deviceId: string) => {
    setSelectedCameraDeviceId(deviceId);
    if (!stream) return;

    stopSpeechRecognition(false);
    stream.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setStream(null);
    setVideoReady(false);
    setCameraDiagnostics(null);
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
        <div className="timeline">
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
            <video ref={videoRef} autoPlay playsInline muted />
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
