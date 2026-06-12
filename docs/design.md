# AI 视觉语音助手设计文档

## 1. 项目目标

本项目实现一款 Web 端视觉语音助手。用户授权摄像头和麦克风后，可以手动分析摄像头画面，并通过语音向 AI 提问。后端统一持有 DashScope API Key，前端不暴露模型密钥。

当前方案采用 pnpm monorepo、React、NestJS、MinIO 和通义千问 DashScope compatible API。视觉分析使用 `chat/completions` 多模态接口；语音交互通过浏览器语音识别、本项目 WebSocket 通道和浏览器语音播报形成可演示闭环。

## 2. 当前能力

| 能力 | 状态 |
| --- | --- |
| 摄像头和麦克风授权 | 已实现 |
| 摄像头实时预览 | 已实现 |
| 手动抽帧并压缩图片 | 已实现 |
| 通义千问视觉分析 | 已接入 DashScope compatible `chat/completions` |
| 语音输入 | 使用浏览器 SpeechRecognition |
| AI 语音播报 | 使用浏览器 SpeechSynthesis |
| 视觉摘要同步到语音上下文 | 已实现 |
| MinIO 关键帧存储 | 已实现，连接失败时降级不阻塞演示 |

## 3. 架构设计

- `apps/web`：React + Vite 前端工作台，负责摄像头预览、语音识别、语音播报和 WebSocket 通信。
- `apps/server`：NestJS API 服务，负责 DashScope 调用、MinIO 存储和 Omni WebSocket 代理入口。
- `packages/shared`：前后端共享类型，包括视觉摘要、会话指标和 Omni 事件。
- `docs`：设计文档。

后端模块：

- `VisionModule`：接收关键帧，调用通义千问多模态模型生成视觉摘要。
- `ConversationModule`：接收语音识别文本和最近视觉摘要，生成中文回复。
- `OpenaiModule`：封装 DashScope OpenAI-compatible 调用。
- `StorageModule`：将被分析的关键帧写入 MinIO，失败时降级继续运行。
- `SessionModule`：结束会话并汇总前端指标。

## 4. 语音交互流程

1. 用户点击连接，前端申请摄像头和麦克风权限。
2. 前端连接后端 WebSocket：`/api/omni/realtime`。
3. 前端启动浏览器语音识别，识别到最终文本后发送 `text` 事件。
4. 后端将用户文本和最近视觉摘要传给通义千问模型。
5. 后端通过 WebSocket 返回中文回复。
6. 前端将回复写入消息流，并使用浏览器 TTS 播报。

当前实现优先保证可演示闭环。后续如果需要接入 DashScope 原生 Omni 音频 WebSocket，可替换后端代理内部实现，前端事件协议保持稳定。

## 5. 视觉上下文

手动分析画面成功后，前端保存最近一次 `VisionSummary`，并通过 WebSocket 发送 `vision_context` 事件。后端在后续语音回复中优先参考这条摘要。

右侧面板会显示视觉摘要同步状态：

- 未同步到语音上下文
- 等待语音通道同步
- 已同步到语音上下文
- 同步失败

## 6. 成本控制策略

- 不上传连续视频，只上传用户触发分析的关键帧。
- 前端将图片压缩到 768px 宽，JPEG 质量 0.72。
- 默认使用低细节分析请求。
- MinIO 只保存被分析的关键帧，不保存连续视频流。
- 后续可增加帧差检测、请求频率限制和会话时长限制。

## 7. 环境变量

关键配置：

```env
OPENAI_API_KEY="DashScope API Key"
OPENAI_BASE_URL="https://dashscope.aliyuncs.com/compatible-mode/v1"
OPENAI_VISION_MODEL="qwen3.5-omni-plus"
OPENAI_REALTIME_MODEL="qwen3.5-omni-plus"
MINIO_ENDPOINT="10.62.110.137"
MINIO_PORT=9000
MINIO_USE_SSL=false
MINIO_ACCESS_KEY="admin"
MINIO_SECRET_KEY="12345678"
MINIO_BUCKET="ai-vision-assets"
```

`OPENAI_REALTIME_MODEL` 当前保留为配置项，实际语音回复使用 `ConversationModule` 调用通义千问文本/多模态模型。

## 8. 后续重点

1. 接入 DashScope 原生 Omni 音频 WebSocket，替换当前浏览器语音识别/TTS fallback。
2. 增加自动抽帧和视觉问题识别。
3. 接入 Prisma，把会话、消息、视觉摘要和指标持久化到 PostgreSQL。
4. 增加服务端限流、错误监控和端到端演示脚本。
