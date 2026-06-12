import { Camera, CircleStop, Mic, MicOff, PhoneCall, ScanEye, Video, VideoOff } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { AssistantPhase, SessionMetrics, VisionSummary } from "@ai-vision/shared";
import { appCopy, phaseLabels } from "./copy.js";
import { createRealtimeClient, type RealtimeClient } from "./realtimeClient.js";

const apiBase = "/api";

type TimelineMessage = {
  role: "assistant" | "system";
  content: string;
};

const createInitialMetrics = (sessionId: string): SessionMetrics => ({
  sessionId,
  audioSeconds: 0,
  visionRequests: 0,
  lowDetailRequests: 0,
  highDetailRequests: 0,
  uploadedImageBytes: 0,
  startedAt: new Date().toISOString(),
});

export const App = () => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const realtimeClientRef = useRef<RealtimeClient | null>(null);
  const [phase, setPhase] = useState<AssistantPhase>("idle");
  const [sessionId] = useState(() => crypto.randomUUID());
  const [metrics, setMetrics] = useState(() => createInitialMetrics(sessionId));
  const [cameraEnabled, setCameraEnabled] = useState(false);
  const [micEnabled, setMicEnabled] = useState(true);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [visionSummary, setVisionSummary] = useState<VisionSummary | null>(null);
  const [messages, setMessages] = useState<TimelineMessage[]>([
    { role: "assistant", content: appCopy.initialAssistantMessage },
  ]);

  const costLevel = useMemo(() => {
    if (metrics.highDetailRequests > 3 || metrics.visionRequests > 20) return appCopy.costLevels.high;
    if (metrics.visionRequests > 8) return appCopy.costLevels.medium;
    return appCopy.costLevels.low;
  }, [metrics.highDetailRequests, metrics.visionRequests]);

  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  const appendSystemMessage = (content: string) => {
    setMessages((items) => [...items, { role: "system", content }]);
  };

  const appendAssistantMessage = (content: string) => {
    setMessages((items) => [...items, { role: "assistant", content }]);
  };

  const startMedia = async () => {
    let mediaStream: MediaStream | null = null;
    try {
      setPhase("connecting");
      mediaStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      setStream(mediaStream);
      setCameraEnabled(true);
      setMicEnabled(true);
      appendSystemMessage(appCopy.mediaConnectedMessage);

      realtimeClientRef.current = await createRealtimeClient({
        apiBase,
        mediaStream,
        onAssistantMessage: appendAssistantMessage,
        onStatusChange: (status) => {
          if (status === "connected") setPhase("listening");
          if (status === "connecting") setPhase("connecting");
          if (status === "disconnected" || status === "failed" || status === "closed") setPhase("error");
        },
      });
      setPhase("listening");
      appendSystemMessage(appCopy.realtimeConnectedMessage);
    } catch {
      mediaStream?.getTracks().forEach((track) => track.stop());
      setStream(null);
      setCameraEnabled(false);
      setPhase("error");
      appendSystemMessage(appCopy.realtimeConnectionError);
    }
  };

  const stopMedia = async () => {
    realtimeClientRef.current?.disconnect();
    realtimeClientRef.current = null;
    stream?.getTracks().forEach((track) => track.stop());
    setStream(null);
    setCameraEnabled(false);
    setPhase("idle");

    try {
      await fetch(`${apiBase}/session/end`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, metrics: { ...metrics, endedAt: new Date().toISOString() } }),
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
    setCameraEnabled((value) => !value);
  };

  const analyzeFrame = async () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.readyState < 2) {
      appendSystemMessage(appCopy.cameraNotReadyMessage);
      return;
    }

    const width = 768;
    const ratio = video.videoHeight / video.videoWidth || 0.5625;
    canvas.width = width;
    canvas.height = Math.round(width * ratio);
    canvas.getContext("2d")?.drawImage(video, 0, 0, canvas.width, canvas.height);
    const imageBase64 = canvas.toDataURL("image/jpeg", 0.72);
    setPhase("thinking");

    try {
      const response = await fetch(`${apiBase}/vision/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, imageBase64, detail: "low", reason: "manual" }),
      });

      if (!response.ok) {
        throw new Error(`Vision API failed with ${response.status}`);
      }

      const data = (await response.json()) as { snapshot: VisionSummary };
      setVisionSummary(data.snapshot);
      setMetrics((current) => ({
        ...current,
        visionRequests: current.visionRequests + 1,
        lowDetailRequests: current.lowDetailRequests + 1,
        uploadedImageBytes: current.uploadedImageBytes + data.snapshot.imageBytes,
      }));
      setMessages((items) => [...items, { role: "assistant", content: data.snapshot.summary }]);
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
          <div className="video-overlay">
            <span>{cameraEnabled ? appCopy.cameraOnline : appCopy.cameraOffline}</span>
            <span>{micEnabled ? appCopy.micOnline : appCopy.micMuted}</span>
          </div>
        </div>

        <div className="controlbar">
          <button onClick={startMedia} disabled={cameraEnabled} title={appCopy.connectTitle}>
            <PhoneCall size={18} />
            {appCopy.connect}
          </button>
          <button onClick={toggleMic} disabled={!stream} title={appCopy.toggleMicTitle}>
            {micEnabled ? <Mic size={18} /> : <MicOff size={18} />}
            {appCopy.toggleMic}
          </button>
          <button onClick={toggleCamera} disabled={!stream} title={appCopy.toggleCameraTitle}>
            {cameraEnabled ? <Video size={18} /> : <VideoOff size={18} />}
            {appCopy.toggleCamera}
          </button>
          <button onClick={analyzeFrame} disabled={!cameraEnabled} title={appCopy.analyzeFrameTitle}>
            <ScanEye size={18} />
            {appCopy.analyzeFrame}
          </button>
          <button onClick={stopMedia} disabled={!stream} title={appCopy.endSessionTitle}>
            <CircleStop size={18} />
            {appCopy.endSession}
          </button>
        </div>
      </section>

      <aside className="inspector">
        <section>
          <p className="eyebrow">{appCopy.visionSummaryLabel}</p>
          <h3>{appCopy.currentViewTitle}</h3>
          <p className="summary">{visionSummary?.summary ?? appCopy.emptySummary}</p>
          <small>
            {visionSummary
              ? `${appCopy.updatedAt} ${new Date(visionSummary.createdAt).toLocaleTimeString()}`
              : appCopy.waitingFirstFrame}
          </small>
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
