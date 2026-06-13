import type { AssistantPhase, SceneMode } from "@ai-vision/shared";

export type SceneModeProfile = {
  label: string;
  description: string;
  focus: string[];
  examples: string[];
};

export const sceneModeCopy: Record<SceneMode, SceneModeProfile> = {
  general: {
    label: "通用视觉对话",
    description: "均衡理解当前画面、最近动作和历史追问，适合自由交流。",
    focus: ["当前画面", "最近动作", "连续追问"],
    examples: ["你现在看到了什么？", "刚才发生了什么？"],
  },
  action: {
    label: "动作理解助手",
    description: "优先理解最近几秒的动作、移动和手势变化。",
    focus: ["动作时间线", "手势变化", "物体移动"],
    examples: ["我刚才做了什么动作？", "我有没有拿起东西？"],
  },
  study: {
    label: "桌面学习助手",
    description: "关注纸张、笔记、题目、书本和桌面内容，支持连续追问。",
    focus: ["纸张/笔记", "桌面物品", "学习追问"],
    examples: ["我手里拿的是什么？", "帮我看一下这页内容。"],
  },
  interview: {
    label: "演讲/面试练习助手",
    description: "观察姿态、视线、手势和表达状态，给出简短反馈。",
    focus: ["坐姿视线", "手势状态", "表达反馈"],
    examples: ["我刚才表现怎么样？", "我的坐姿和视线自然吗？"],
  },
  life: {
    label: "生活提醒助手",
    description: "关注物品变化、桌面状态和需要注意的轻量提醒。",
    focus: ["物品变化", "桌面状态", "潜在提醒"],
    examples: ["画面里有什么需要注意？", "桌面上有什么变化？"],
  },
};

export const appCopy = {
  initialAssistantMessage:
    "准备就绪。授权摄像头和麦克风后，我可以一边看画面，一边听你说话。",
  mediaConnectedMessage: "摄像头和麦克风已连接。",
  mediaVideoOnlyMessage:
    "摄像头已连接，但麦克风不可用；可以先使用画面分析，语音识别可能无法启动。",
  cameraSwitchedMessage: "已切换摄像头设备。",
  realtimeConnectedMessage: "语音识别已启动，可以开始说话。",
  backendOnlineMessage: "后端服务已连接。",
  backendOfflineMessage:
    "后端服务未连接，请先启动 NestJS 服务后再进行语音问答或画面分析。",
  voiceDisabledBackendOffline:
    "摄像头预览可继续使用；后端未运行时，语音问题不会发送。",
  realtimeConnectionError:
    "语音通道连接失败，请确认后端服务、DashScope Key 和浏览器授权正常。",
  cameraPermissionError: "无法连接摄像头，请检查浏览器授权后重试。",
  cameraDeviceBusyError:
    "摄像头可能正被其他程序占用，请关闭会议软件、相机应用或浏览器其他页面后重试。",
  cameraNotFoundError:
    "没有找到可用摄像头，请确认设备已接入并允许浏览器访问。",
  cameraPermissionDeniedError:
    "浏览器拒绝了摄像头权限，请在地址栏左侧站点设置中允许摄像头后重试。",
  microphoneUnavailableMessage:
    "麦克风不可用或未授权，本次会话已降级为仅摄像头模式。",
  microphonePermissionDeniedError:
    "浏览器拒绝了麦克风权限，请在地址栏左侧站点设置中允许麦克风后重试。",
  microphoneNotFoundError:
    "没有找到可用麦克风，请确认设备已接入并在系统中启用。",
  microphoneBusyError:
    "麦克风可能正被其他程序占用，请关闭会议软件、录音软件或浏览器其他页面后重试。",
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
  visionAnalyzeError:
    "画面分析失败，请确认后端服务和 DashScope 配置正常。",
  actionAnalyzeError:
    "动作序列分析失败，请确认后端服务和 DashScope 配置正常。",
  conversationError:
    "语音问题发送失败，请确认后端服务正在运行。",
  sessionEndError: "会话结束请求没有成功，但本地设备已经关闭。",
  visionContextSynced: "最新视觉摘要已同步到语音上下文。",
  visionContextSyncFailed:
    "视觉摘要会在下一次语音问题中作为上下文发送。",
  speechUnsupported: "当前浏览器不支持语音识别，请使用 Chrome 或 Edge 测试。",
  speechRecognitionError:
    "浏览器语音识别启动失败，但摄像头仍可继续使用。",
  title: "视觉对话工作台",
  currentSession: "当前会话",
  realtimeLabel: "Qwen Omni Voice + Vision",
  stageTitle: "边看边听，实时回应",
  cameraOnline: "摄像头在线",
  cameraStarting: "摄像头启动中",
  cameraOffline: "摄像头离线",
  micOnline: "麦克风在线",
  micMuted: "麦克风静音",
  backendOnline: "后端在线",
  backendOffline: "后端离线",
  backendUnknown: "后端未知",
  videoStreamConnected: "视频流已连接",
  videoStreamConnecting: "视频流连接中",
  videoStreamFallback: "视频流降级",
  videoStreamIdle: "视频流空闲",
  cameraDeviceLabel: "摄像头",
  cameraDevicePlaceholder: "授权后显示设备",
  unknownCamera: "摄像头",
  emptyVideo: "等待摄像头授权",
  connect: "连接设备",
  connectTitle: "连接摄像头和麦克风",
  toggleMic: "麦克风",
  toggleMicTitle: "切换麦克风",
  toggleCamera: "摄像头",
  toggleCameraTitle: "切换摄像头",
  analyzeFrame: "分析画面",
  analyzeFrameTitle: "分析当前画面",
  autoObserve: "自动观察",
  autoObserveTitle: "自动连续抽帧更新视觉上下文",
  interruptSpeech: "停止回复",
  interruptSpeechTitle: "停止当前播报并继续听你说话",
  endSession: "结束会话",
  endSessionTitle: "结束会话",
  visionSummaryLabel: "Vision Summary",
  currentViewTitle: "AI 当前看到",
  emptySummary:
    "还没有分析画面。点击分析画面后，视觉摘要会作为下一次语音问题的上下文。",
  updatedAt: "更新于",
  waitingFirstFrame: "等待第一帧",
  actionTimelineLabel: "Action Timeline",
  recentActionTitle: "最近动作",
  emptyActionTimeline:
    "还没有形成动作时间线。自动观察会以 2 FPS 本地采样，去重后批量分析最近几秒动作。",
  confidenceNoteLabel: "置信说明",
  visionContextSyncLabels: {
    idle: "未同步到语音上下文",
    pending: "等待下一次语音问题",
    synced: "已准备为语音上下文",
    failed: "等待语音问题携带",
  },
  metricVisionRequests: "视觉请求",
  metricLowDetail: "低细节",
  metricHighDetail: "高细节",
  metricCostLevel: "成本等级",
  metricAutoVisionRequests: "自动抽帧",
  metricSkippedFrames: "跳过帧",
  metricLastAutoVisionAt: "最近自动更新",
  metricFrameFingerprint: "帧指纹",
  metricActionSamples: "本地采样",
  metricDedupedActionFrames: "动作跳过",
  metricActionSequenceRequests: "动作分析",
  metricLastActionTimelineAt: "最近动作更新",
  metricActionBuffer: "动作缓冲",
  metricVideoStreamStatus: "视频流",
  metricStreamedFrames: "流式帧",
  metricStreamBuffer: "流缓冲",
  metricStreamCloudAnalyses: "流式云分析",
  metricStreamTimelineAnalyses: "流式动作成功",
  metricStreamTimelineErrors: "流式动作失败",
  metricLastVideoStreamAt: "最近流更新",
  metricLastStreamError: "最近流错误",
  noAutoVisionYet: "暂无",
  fingerprintReady: "已建立",
  fingerprintPending: "等待中",
  costStrategyLabel: "Cost Strategy",
  strategies: [
    "自动观察在本地 2 FPS 采样",
    "低变化动作帧本地去重",
    "WebSocket 只推送去重关键帧",
    "云端按 3-10 秒节流分析短序列",
    "图片压缩到 768px 宽",
    "默认 detail: low",
    "每分钟最多 6 次自动视觉请求",
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
