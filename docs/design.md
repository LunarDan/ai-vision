# AI 视觉对话助手设计文档

## 1. 项目目标

本项目实现一款 Web 端 AI 视觉对话助手。用户授权摄像头和麦克风后，AI 能听到用户说话、看到摄像头画面，并基于语音内容和视觉摘要给出自然回应。

技术方案采用 pnpm monorepo、React、NestJS、PostgreSQL、Prisma、MinIO 和 OpenAI Realtime/vision API。v1 不采用微服务，而使用 NestJS 模块化单体，优先保证演示稳定性和功能完整度。

## 2. 用户故事

| 用户故事 | 计划实现 | 当前实现状态 |
| --- | --- | --- |
| 用户进入网页后能授权摄像头和麦克风 | 是 | 已完成前端基础能力 |
| 用户能看到摄像头实时预览 | 是 | 已完成 |
| 用户能通过语音与 AI 对话 | 是 | 已预留 Realtime 接口，待接入完整 WebRTC 客户端 |
| 用户问“你看到了什么”时 AI 能描述画面 | 是 | 已完成手动抽帧分析链路骨架 |
| 用户可以手动触发画面分析 | 是 | 已完成 |
| 用户可以查看最近视觉摘要 | 是 | 已完成 |
| 用户可以查看成本控制指标 | 是 | 已完成基础指标展示 |
| 用户可以静音麦克风、开关摄像头、结束会话 | 是 | 已完成基础控制 |
| AI 回复可以被用户自然打断 | 是 | 待接入完整 Realtime WebRTC 后完成 |

## 3. 架构设计

### 3.1 Monorepo

- `apps/web`：React + Vite 前端工作台。
- `apps/server`：NestJS 后端 API。
- `packages/shared`：前后端共享类型。
- `docs`：设计文档。

### 3.2 后端模块

- `RealtimeModule`：创建 OpenAI Realtime ephemeral client secret。
- `VisionModule`：接收关键帧并调用视觉模型生成摘要。
- `SessionModule`：结束会话并汇总指标。
- `StorageModule`：将被分析的关键帧存入 MinIO。
- `OpenaiModule`：封装 OpenAI API 调用。

### 3.3 数据库

默认使用 PostgreSQL。v1 数据模型包括：

- `Session`：会话状态、开始和结束时间、成本模式。
- `Message`：用户和 AI 消息。
- `VisionSnapshot`：视觉摘要、图片大小、detail 档位、延迟和对象存储信息。
- `SessionMetric`：语音时长、视觉请求数、上传图片大小、成本指标。

## 4. 成本控制策略

| 策略 | 计划采用 | 当前实现状态 |
| --- | --- | --- |
| 不上传连续视频，只上传关键帧 | 是 | 已采用 |
| 前端压缩图片尺寸和质量 | 是 | 已采用，当前宽度 768px，JPEG 质量 0.72 |
| 默认使用 `detail: low` | 是 | 已采用 |
| 视觉相关问题时临时升频或升到 `detail: high` | 是 | 待接入语义判断 |
| 静止画面减少重复上传 | 是 | 待实现帧差检测 |
| 使用 ephemeral key，前端不暴露 OpenAI API key | 是 | 已预留后端接口 |
| 记录会话指标用于成本复盘 | 是 | 已完成前端指标骨架，待持久化 |
| 服务端限制会话时长和请求频率 | 是 | 待实现 NestJS guard/interceptor |

## 5. UI/UX 设计

前端采用桌面级 AI 工作台布局，而不是普通 demo 页面：

- 左侧展示会话状态和系统消息。
- 中间展示摄像头主画面和核心控制按钮。
- 右侧展示视觉摘要、请求指标和成本策略。
- 控制按钮采用图标加文字，便于答辩现场快速操作。
- 当前状态包括 `idle`、`connecting`、`listening`、`thinking`、`speaking` 和 `error`。
- UI 文案集中维护在 `apps/web/src/copy.ts`，避免组件中散落硬编码文案。
- 摄像头授权失败、画面未就绪、视觉分析失败和结束会话失败都会进入消息流反馈。

## 6. 不采用微服务的原因

v1 不采用微服务，原因如下：

- 本项目核心风险在多模态交互体验，不在分布式系统治理。
- 微服务会增加部署、链路追踪、服务间通信和调试成本。
- NestJS 模块化单体已经能清晰表达服务边界。
- 后续可以把视觉分析、成本统计和异步任务独立拆分。

## 7. 后续实现重点

1. 将视觉摘要注入 Realtime 对话上下文。
2. 接入 Prisma，把会话、消息、视觉摘要和指标写入 PostgreSQL。
3. 增加帧差检测和请求频率限制。
4. 补充接口测试和端到端演示脚本。

## 8. Realtime WebRTC 接入

前端通过 `apps/web/src/realtimeClient.ts` 建立 OpenAI Realtime WebRTC 连接：

- 浏览器先调用后端 `/api/realtime/session` 获取 ephemeral client secret。
- 前端创建 `RTCPeerConnection`，把麦克风音轨加入连接。
- 前端创建 `oai-events` data channel，用于接收 Realtime 事件。
- 前端将 SDP offer 发送到 OpenAI Realtime calls endpoint，并用返回的 SDP answer 完成连接。
- 远端音频通过浏览器 `Audio` 元素自动播放。
- 连接失败时 UI 会进入 `error` 状态，并关闭已获取的本地媒体流。

当前 Realtime 接入只负责语音通道。视觉摘要注入、自动抽帧和更完整的事件解析会在后续 PR 中完成。

## 9. MinIO 对象存储

项目接入 MinIO 作为对象存储层。PostgreSQL 只保存结构化元数据，MinIO 保存被分析的摄像头关键帧。

- 本地开发可以直接使用 D 盘下载的 `minio.exe`，不强制使用 Docker。
- 推荐启动命令：`D:\path\to\minio.exe server D:\minio-data --console-address ":9001"`。
- MinIO API 地址为 `http://localhost:9000`，控制台地址为 `http://localhost:9001`。
- 后端默认 bucket 为 `ai-vision-assets`，启动时会自动创建。
- 视觉接口会把每张被分析的关键帧存为 `sessions/{sessionId}/vision/{timestamp}-{snapshotId}.jpg`。
- 成本控制策略保持不变：只保存被分析的关键帧，不保存连续视频流。
