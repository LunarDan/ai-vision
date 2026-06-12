import type { AssistantPhase } from "@ai-vision/shared";

export const appCopy = {
  initialAssistantMessage:
    "准备就绪。授权摄像头和麦克风后，我可以一边看画面，一边听你说话。",
  mediaConnectedMessage: "摄像头和麦克风已连接。",
  cameraSwitchedMessage: "已切换摄像头设备。",
  realtimeConnectedMessage: "语音识别已启动，可以开始说话。",
  backendOnlineMessage: "后端服务已连接。",
  backendOfflineMessage:
    "后端服务未连接，请先启动 NestJS 服务后再进行语音问答或画面分析。",
  voiceDisabledBackendOffline:
    "摄像头预览可继续使用；后端未运行时，语音问题不会发送。",
  realtimeConnectionError:
    "语音通道连接失败，请确认后端服务、DashScope Key 和浏览器授权正常。",
  cameraPermissionError: "无法连接摄像头或麦克风，请检查浏览器授权后重试。",
  cameraSecureContextError:
    "浏览器只允许在 localhost 或 HTTPS 页面使用摄像头和麦克风。请用 http://localhost:5173 打开，或为局域网地址配置 HTTPS。",
  cameraPlaybackError:
    "摄像头已授权，但视频播放被浏览器阻止；请刷新页面后重试。",
  cameraFrameWaiting:
    "摄像头已授权，正在等待视频首帧。如果一直黑屏，请确认没有其他程序占用摄像头。",
  cameraMutedState: "无画面",
  cameraNotReadyMessage: "摄像头画面还没有准备好，请稍等一秒再分析。",
  autoVisionCaptureMessage:
    "正在读取当前摄像头画面，并作为这次语音问题的视觉上下文。",
  autoVisionCaptureFailed:
    "这次没有成功读取摄像头画面，将先用已有视觉摘要继续回答。",
  visionAnalyzeError: "画面分析失败，请确认后端服务和 DashScope 配置正常。",
  conversationError: "语音问题发送失败，请确认后端服务正在运行。",
  sessionEndError: "会话结束请求没有成功，但本地设备已经关闭。",
  visionContextSynced: "最新视觉摘要已同步到语音上下文。",
  visionContextSyncFailed: "视觉摘要会在下一次语音问题中作为上下文发送。",
  speechUnsupported: "当前浏览器不支持语音识别，请使用 Chrome 或 Edge 测试。",
  speechRecognitionError: "浏览器语音识别启动失败，但摄像头仍可继续使用。",
  title: "视觉对话工作台",
  currentSession: "当前会话",
  realtimeLabel: "Qwen Omni Voice + Vision",
  stageTitle: "边看边听，实时回应",
  cameraOnline: "Camera online",
  cameraStarting: "Camera starting",
  cameraOffline: "Camera offline",
  micOnline: "Mic online",
  micMuted: "Mic muted",
  backendOnline: "Backend online",
  backendOffline: "Backend offline",
  backendUnknown: "Backend unknown",
  cameraDeviceLabel: "摄像头",
  cameraDevicePlaceholder: "授权后显示设备",
  unknownCamera: "摄像头",
  emptyVideo: "等待摄像头授权",
  connect: "连接",
  connectTitle: "连接设备",
  toggleMic: "麦克风",
  toggleMicTitle: "切换麦克风",
  toggleCamera: "摄像头",
  toggleCameraTitle: "切换摄像头",
  analyzeFrame: "分析画面",
  analyzeFrameTitle: "分析当前画面",
  endSession: "结束",
  endSessionTitle: "结束会话",
  visionSummaryLabel: "Vision Summary",
  currentViewTitle: "AI 当前看到",
  emptySummary:
    "还没有分析画面。点击分析画面后，视觉摘要会同步到语音上下文。",
  updatedAt: "更新于",
  waitingFirstFrame: "等待第一帧",
  visionContextSyncLabels: {
    idle: "未同步到语音上下文",
    pending: "等待语音通道同步",
    synced: "已同步到语音上下文",
    failed: "同步失败",
  },
  metricVisionRequests: "视觉请求",
  metricLowDetail: "低细节",
  metricHighDetail: "高细节",
  metricCostLevel: "成本等级",
  costStrategyLabel: "Cost Strategy",
  strategies: [
    "默认只上传关键帧",
    "图片压缩到 768px 宽",
    "默认 detail: low",
    "语音问题结合最近视觉摘要回答",
  ],
  costLevels: {
    low: "低",
    medium: "中等",
    high: "偏高",
  },
} as const;

export const phaseLabels: Record<AssistantPhase, string> = {
  idle: "空闲",
  connecting: "连接中",
  listening: "聆听中",
  thinking: "分析中",
  speaking: "回应中",
  error: "异常",
};
