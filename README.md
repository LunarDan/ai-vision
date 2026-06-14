# AI 视觉对话助手

当前实现采用“本地关键帧采样 + 去重 + WebSocket 视觉记忆 + 流式文字回复”的方案：浏览器持续观察画面；后端按会话维护最新视觉状态和动作时间线，在用户提问时作为上下文提供给多模态模型。

## 核心功能

- **摄像头与麦克风接入**：支持摄像头预览、麦克风授权、浏览器语音识别和浏览器 TTS 播报。
- **持续视觉观察**：前端本地低频采样、压缩和帧差去重，只把有变化的关键帧发送给后端。
- **最近动作理解**：保留短窗口关键帧，批量分析为动作变化，用于回答“我刚才做了什么”“有没有动”等问题。
- **语音与文字双入口**：用户可以直接说话，也可以在会话栏底部打字提问；两种入口共享同一套视觉上下文和历史记忆。
- **流式文字回复**：优先使用 `fetch` streaming 调用 `/api/conversation/respond-stream`，AI 回复边生成边显示；失败时回退普通 JSON 对话接口。
- **语音体验增强**：展示“正在听 / 已听到 / 正在思考 / 正在回复”状态，支持停止回复、重新说一遍和语速调节。
- **场景角色模式**：内置通用视觉对话、动作理解助手、演讲/面试练习助手、生活提醒助手，并支持用户自定义 AI 角色。
- **场景助手面板**：右侧展示当前场景目标、推荐问题、AI 当前观察、最近变化和演示建议；成本与调试指标折叠保留。
- **会话历史归档**：结束会话时保存用户/AI 消息、指标和最后一帧图片引用；历史记录以全局弹层查看。
- **端云协同成本控制**：本地采样不等于云端高频调用，云端只处理去重后的关键帧、短序列或用户提问触发的上下文。

## 设计文档

题目要求的设计文档位于 [docs/design.md](docs/design.md)，包含：

- 计划实现的用户故事与最终实现情况。
- 视觉理解、语音交互、场景角色、历史归档和产品化体验说明。
- 端云协同与运营成本控制策略。
- 当前限制和后续增强方向。

## 技术栈

```text
ai-vision
├─ apps/web           React + Vite + shadcn 风格组件 + Tailwind 配置
├─ apps/server        NestJS API、WebSocket 视觉记忆、模型调用、历史归档
├─ packages/shared    前后端共享 TypeScript 类型
└─ docs/design.md     题目要求的设计文档
```

主要依赖：

- 前端：React 19、Vite、Radix UI、lucide-react、shadcn 风格组件源码。
- 后端：NestJS、OpenAI compatible SDK、Prisma、PostgreSQL、MinIO。
- 模型：默认走 OpenAI compatible 接口，可配置 DashScope/Qwen Omni 类模型。

## 快速开始

### 1. 安装依赖

```powershell
pnpm install
```

### 2. 准备环境变量

复制环境变量模板：

```powershell
Copy-Item .env.example .env
```

按需修改 `.env`：

```env
OPENAI_API_KEY="sk-..."
OPENAI_BASE_URL="https://dashscope.aliyuncs.com/compatible-mode/v1"
OPENAI_VISION_MODEL="qwen3.5-omni-plus"

PORT=3001
WEB_ORIGIN="http://localhost:5173"

DATABASE_URL="postgresql://postgres:postgres@localhost:5432/ai_vision?schema=public"

MINIO_ENDPOINT="localhost"
MINIO_PORT=9000
MINIO_USE_SSL=false
MINIO_ACCESS_KEY="minioadmin"
MINIO_SECRET_KEY="minioadmin"
MINIO_BUCKET="ai-vision-assets"
```

说明：

- `OPENAI_BASE_URL` 不在 `.env.example` 里时也可以手动添加；后端会按 OpenAI compatible 方式调用模型。
- 如果只体验实时对话和视觉理解，核心必填项是 `OPENAI_API_KEY`、`OPENAI_VISION_MODEL`、`PORT`、`WEB_ORIGIN`。
- 如果要使用历史归档和最后一帧预览，需要 PostgreSQL 和 MinIO。

### 3. 启动 PostgreSQL

本地没有 PostgreSQL 时，可以用 Docker 启动：

```powershell
docker run --name ai-vision-postgres `
  -e POSTGRES_USER=postgres `
  -e POSTGRES_PASSWORD=postgres `
  -e POSTGRES_DB=ai_vision `
  -p 5432:5432 `
  -d postgres:16
```

初始化 Prisma：

```powershell
pnpm.cmd db:generate
pnpm.cmd db:migrate
```

### 4. 启动 MinIO（可选但推荐）

MinIO 用于保存结束会话时的最后一帧图片。数据库只保存对象引用，不直接保存图片二进制。

示例：

```powershell
minio.exe server D:\minio-data --console-address ":9001"
```

默认地址：

- API: `http://localhost:9000`
- Console: `http://localhost:9001`
- 默认账号：`minioadmin`
- 默认密码：`minioadmin`
- 默认 bucket：`ai-vision-assets`

如果 MinIO 不可用，结束会话仍会保存文字历史，只是最后一帧预览会降级为空。

### 5. 启动项目

```powershell
pnpm.cmd dev
```

默认地址：

- 前端：`http://localhost:5173`
- 后端：`http://localhost:3001`

Vite 会把 `/api` 和 WebSocket 请求代理到后端。建议使用 Chrome 或 Edge，并在 `localhost` 或 HTTPS 环境下运行，以保证摄像头、麦克风和语音识别权限正常。

## 常用命令

```powershell
pnpm.cmd dev
pnpm.cmd typecheck
pnpm.cmd build
pnpm.cmd lint
```

数据库相关：

```powershell
pnpm.cmd db:generate
pnpm.cmd db:migrate
```

只检查前端：

```powershell
pnpm.cmd --filter @ai-vision/web typecheck
```

## 使用方式

1. 打开页面后点击“连接设备”，授权摄像头和麦克风。
2. 选择一个场景模式，例如“动作理解助手”或“演讲/面试练习助手”。
3. 通过语音或文字提问，例如：
   - “你现在看到什么？”
   - “我刚才做了什么动作？”
   - “我手里拿的是什么？”
   - “我刚才表现怎么样？”
4. AI 回复会流式显示，完整生成后自动语音播报。
5. 如果 AI 正在播报，可以点击“停止回复”打断。
6. 如果想再听一次，可以点击“重新说一遍”，这只会重播本地 TTS，不会重新请求模型。
7. 可以用“语速”滑杆调整 AI 播报速度，范围为 `0.5x` 到 `3.0x`。
8. 点击“结束会话”后，会归档本轮对话、指标和最后一帧图片引用。
9. 点击“历史记录”可以打开全局历史弹层，查看已结束会话。

## 场景模式

| 模式 | AI 角色 | 适合演示 |
| --- | --- | --- |
| 通用视觉对话 | 通用视觉对话伙伴 | 询问当前画面、物品、环境变化 |
| 动作理解助手 | 动作观察员 | 询问刚才做了什么、有没有移动、手势变化 |
| 演讲/面试练习助手 | 演讲和面试练习教练 | 观察姿态、视线、手势，给简短反馈 |
| 生活提醒助手 | 生活提醒助手 | 描述物品变化、遗漏物、轻量提醒 |
| 自定义模式 | 用户填写的角色卡 | 健身教练、手工助手、实验观察员等自定义场景 |

场景模式会同时影响：

- 后端对话 prompt 中的 AI 角色和回答风格。
- 右侧场景助手面板的推荐问题和展示重点。

场景模式不会增加额外云端调用次数，只改变同一次对话请求里的角色设定。

## 自定义模式示例

可以创建一个“健身动作教练”：

- 角色身份：你是一名健身动作观察教练。
- 核心任务：根据摄像头画面和最近动作，提醒用户动作是否稳定、节奏是否合理。
- 回答风格：简短、鼓励、给一个具体改进建议。
- 关注重点：手臂轨迹、身体姿态、动作幅度、节奏变化。
- 推荐问题：我刚才动作标准吗？我有没有晃动？下一组要注意什么？
- 边界要求：不要做医疗诊断，不替代专业教练。

自定义模式保存在浏览器 `localStorage`，第一版不做账号同步。

## 端云协同与成本控制

本项目重点避免“浏览器 2 FPS 采样 = 云端 2 FPS 调用”的成本失控：

- 浏览器本地采样、压缩、计算帧指纹和帧差。
- 静止或低变化画面会被跳过，不进入云端分析。
- WebSocket 只推送去重后的关键帧。
- 后端按会话节流云端视觉分析和动作序列分析。
- 页面不可见、摄像头关闭、后端离线、AI 播报中时暂停或降低观察上传。
- 用户主动提问视觉/动作问题时，才提高最新视觉上下文优先级。
- “重新说一遍”只重播本地缓存回复，不重新请求模型。
- 历史图片保存到 MinIO，数据库只保存 `bucket`、`objectKey`、`sha256` 等对象引用。
- 成本与调试指标默认折叠，演示答辩时可展开说明采样帧、跳过帧和云端分析次数。

## 关键接口

- `POST /api/vision/analyze`：单帧画面分析。
- `POST /api/vision/analyze-sequence`：多帧动作序列分析。
- `POST /api/conversation/respond`：普通 JSON 对话回复 fallback。
- `POST /api/conversation/respond-stream`：流式文字回复。
- `POST /api/session/end`：结束会话并归档历史。
- `GET /api/session/history`：获取历史会话列表。
- `GET /api/session/history/:sessionId`：获取历史会话详情。
- `GET /api/session/history/:sessionId/final-frame-url`：获取最后一帧预览 URL。
- `WS /api/omni/realtime`：视频关键帧、视觉记忆和对话 WebSocket 通道。


## 后续方向

- 接入云端原生实时音视频多模态协议，进一步提升实时对话感。
- 增加流式 TTS，让回复边生成边播报。
- 增加历史记录删除、导出、搜索和场景筛选。
- 增加用户级预算、调用审计和更细的成本看板。
- 增加演示脚本和端到端测试，覆盖摄像头、麦克风、视觉观察、动作提问和历史归档。
