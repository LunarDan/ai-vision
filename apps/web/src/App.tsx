import { Camera, CircleStop, Mic, MicOff, PhoneCall, ScanEye, Video, VideoOff } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { AssistantPhase, SessionMetrics, VisionSummary } from "@ai-vision/shared";

const apiBase = "/api";

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
  const [phase, setPhase] = useState<AssistantPhase>("idle");
  const [sessionId] = useState(() => crypto.randomUUID());
  const [metrics, setMetrics] = useState(() => createInitialMetrics(sessionId));
  const [cameraEnabled, setCameraEnabled] = useState(false);
  const [micEnabled, setMicEnabled] = useState(true);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [visionSummary, setVisionSummary] = useState<VisionSummary | null>(null);
  const [messages, setMessages] = useState([
    { role: "assistant", content: "准备就绪。授权摄像头和麦克风后，我可以边看边听。" },
  ]);

  const costLevel = useMemo(() => {
    if (metrics.highDetailRequests > 3 || metrics.visionRequests > 20) return "偏高";
    if (metrics.visionRequests > 8) return "中等";
    return "低";
  }, [metrics.highDetailRequests, metrics.visionRequests]);

  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  const startMedia = async () => {
    setPhase("connecting");
    const mediaStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    setStream(mediaStream);
    setCameraEnabled(true);
    setMicEnabled(true);
    setPhase("listening");
    setMessages((items) => [...items, { role: "system", content: "摄像头和麦克风已连接。" }]);
  };

  const stopMedia = async () => {
    stream?.getTracks().forEach((track) => track.stop());
    setStream(null);
    setCameraEnabled(false);
    setPhase("idle");
    await fetch(`${apiBase}/session/end`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId, metrics }),
    }).catch(() => undefined);
  };

  const toggleMic = () => {
    stream?.getAudioTracks().forEach((track) => {
      track.enabled = !micEnabled;
    });
    setMicEnabled((value) => !value);
  };

  const analyzeFrame = async () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.readyState < 2) return;

    const width = 768;
    const ratio = video.videoHeight / video.videoWidth || 0.5625;
    canvas.width = width;
    canvas.height = Math.round(width * ratio);
    canvas.getContext("2d")?.drawImage(video, 0, 0, canvas.width, canvas.height);
    const imageBase64 = canvas.toDataURL("image/jpeg", 0.72);
    setPhase("thinking");

    const response = await fetch(`${apiBase}/vision/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId, imageBase64, detail: "low", reason: "manual" }),
    });
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
  };

  return (
    <main className="shell">
      <aside className="sidebar">
        <div>
          <p className="eyebrow">AI Vision</p>
          <h1>视觉对话工作台</h1>
        </div>
        <div className="session-card active">
          <span>当前会话</span>
          <strong>{phase}</strong>
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
            <p className="eyebrow">Realtime Camera + Voice</p>
            <h2>边看边听，实时回应</h2>
          </div>
          <div className={`status ${phase}`}>{phase}</div>
        </header>

        <div className="video-wrap">
          {cameraEnabled ? <video ref={videoRef} autoPlay playsInline muted /> : <div className="empty-video"><Camera size={44} />等待摄像头授权</div>}
          <canvas ref={canvasRef} hidden />
          <div className="video-overlay">
            <span>{cameraEnabled ? "Camera online" : "Camera offline"}</span>
            <span>{micEnabled ? "Mic online" : "Mic muted"}</span>
          </div>
        </div>

        <div className="controlbar">
          <button onClick={startMedia} disabled={cameraEnabled} title="连接设备"><PhoneCall size={18} />连接</button>
          <button onClick={toggleMic} disabled={!stream} title="切换麦克风">{micEnabled ? <Mic size={18} /> : <MicOff size={18} />}麦克风</button>
          <button onClick={() => setCameraEnabled((value) => !value)} disabled={!stream} title="切换摄像头">{cameraEnabled ? <Video size={18} /> : <VideoOff size={18} />}摄像头</button>
          <button onClick={analyzeFrame} disabled={!cameraEnabled} title="分析当前画面"><ScanEye size={18} />分析画面</button>
          <button onClick={stopMedia} disabled={!stream} title="结束会话"><CircleStop size={18} />结束</button>
        </div>
      </section>

      <aside className="inspector">
        <section>
          <p className="eyebrow">Vision Summary</p>
          <h3>AI 当前看到</h3>
          <p className="summary">{visionSummary?.summary ?? "还没有分析画面。点击分析画面，或在接入实时链路后自动抽帧。"}</p>
          <small>{visionSummary ? `更新于 ${new Date(visionSummary.createdAt).toLocaleTimeString()}` : "等待第一帧"}</small>
        </section>

        <section className="metric-grid">
          <div><span>视觉请求</span><strong>{metrics.visionRequests}</strong></div>
          <div><span>低细节</span><strong>{metrics.lowDetailRequests}</strong></div>
          <div><span>高细节</span><strong>{metrics.highDetailRequests}</strong></div>
          <div><span>成本等级</span><strong>{costLevel}</strong></div>
        </section>

        <section>
          <p className="eyebrow">Cost Strategy</p>
          <ul className="strategy-list">
            <li>默认只上传关键帧</li>
            <li>图片压缩到 768px 宽</li>
            <li>默认 detail: low</li>
            <li>视觉问题再升频/升档</li>
          </ul>
        </section>
      </aside>
    </main>
  );
};
