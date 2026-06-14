import { Injectable } from "@nestjs/common";
import type {
  ConversationHistoryItem,
  ConversationRequest,
  SceneMode,
  VisionActionStep,
  VisionSequenceFrame,
} from "@ai-vision/shared";
import OpenAI from "openai";

const openaiBaseUrl =
  process.env.OPENAI_BASE_URL ?? "https://dashscope.aliyuncs.com/compatible-mode/v1";
const createOpenaiUrl = (path: string) =>
  `${openaiBaseUrl.replace(/\/$/, "")}${path}`;

type ImageSequenceAnalysis = {
  summary: string;
  steps: VisionActionStep[];
  confidenceNote: string;
};

const sceneModePrompts: Record<SceneMode, string> = {
  general:
    "当前场景是通用视觉对话。请结合当前画面、最近动作和历史对话，像正在自然交流一样直接回答用户。",
  action:
    "当前场景是动作理解助手。用户通常关心刚才做了什么、有没有移动、手势或连续变化。回答时优先描述动作变化，不要把静态外观误判成动作。",
  study:
    "当前场景是桌面学习助手。用户可能展示纸张、笔记、题目、书本或桌面物品。回答时优先解释可见的学习和办公内容，并支持连续追问。",
  interview:
    "当前场景是演讲/面试练习助手。用户希望获得表达状态、视线、坐姿、手势和临场表现反馈。回答时给出简短、建设性的观察和建议。",
  life:
    "当前场景是生活提醒助手。用户通常关心画面里的物品、变化和需要注意的地方。回答时偏向轻量提醒、物品变化和潜在风险，但不要夸大危险。",
};

const formatHistoryItem = (item: ConversationHistoryItem) => {
  const context = item.context;
  const visualSummary = context?.visionSummary?.summary
    ? `\n当时看到：${context.visionSummary.summary}`
    : "";
  const actionSummary = context?.visionTimeline?.summary
    ? `\n当时动作：${context.visionTimeline.summary}`
    : "";
  const imageReference = context?.imageReference
    ? `\n当时关联图片引用：${JSON.stringify(context.imageReference)}`
    : "";

  return [
    `${item.role === "user" ? "用户" : "AI"}（${item.createdAt}）：`,
    item.content,
    visualSummary,
    actionSummary,
    imageReference,
  ].join("");
};

@Injectable()
export class OpenaiService {
  private readonly client = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: openaiBaseUrl,
  });

  async createRealtimeSession(): Promise<never> {
    throw new Error(
      "OpenAI Realtime WebRTC is disabled. Use the Omni WebSocket proxy instead.",
    );
  }

  async analyzeImage(imageBase64: string, detail: "low" | "high") {
    const model = process.env.OPENAI_VISION_MODEL ?? "qwen3.5-omni-plus";
    const result = await this.client.chat.completions.create({
      model,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "请用一句简短中文总结摄像头画面里可见的内容；如果无法确定，请说明不确定。",
            },
            {
              type: "image_url",
              image_url: {
                url: imageBase64,
                detail,
              },
            },
          ],
        },
      ],
    });

    return result.choices[0]?.message.content || "暂时无法确认画面内容。";
  }

  async analyzeImageSequence(
    frames: VisionSequenceFrame[],
  ): Promise<ImageSequenceAnalysis> {
    const model = process.env.OPENAI_VISION_MODEL ?? "qwen3.5-omni-plus";
    const orderedFrames = frames.slice(0, 8);
    const result = await this.client.chat.completions.create({
      model,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: [
                "下面是一组按时间排序的摄像头关键帧，来自最近一小段视频采样。",
                "请把这些图片当作一个短视频片段来理解，必须按帧序比较首帧、中间帧和末帧的变化。",
                "请判断画面中的人或主要物体发生了哪些连续动作，不要只描述最后一帧，也不要把静态外观误当作动作。",
                "输出要体现动作过程，例如：开始状态 -> 中间变化 -> 结束状态。",
                "请严格返回 JSON，格式为：",
                '{"summary":"一句话总结动作序列","steps":[{"timeRange":"0.0s-1.0s","description":"动作描述"}],"confidenceNote":"置信度和不确定性说明"}',
                "如果动作不明显、帧间变化很小或主体被遮挡，请说明画面基本静止或无法确定。",
                orderedFrames
                  .map(
                    (frame, index) =>
                      `第 ${index + 1} 帧：offsetMs=${frame.offsetMs}, capturedAt=${frame.capturedAt}`,
                  )
                  .join("\n"),
              ].join("\n"),
            },
            ...orderedFrames.map((frame) => ({
              type: "image_url" as const,
              image_url: {
                url: frame.imageBase64,
                detail: "low" as const,
              },
            })),
          ],
        },
      ],
    });

    const content = result.choices[0]?.message.content || "";
    return this.parseImageSequenceAnalysis(content);
  }

  private parseImageSequenceAnalysis(content: string): ImageSequenceAnalysis {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    const rawJson = jsonMatch?.[0] ?? content;

    try {
      const parsed = JSON.parse(rawJson) as Partial<ImageSequenceAnalysis>;
      return {
        summary: parsed.summary || "暂时无法确认动作序列。",
        steps: Array.isArray(parsed.steps)
          ? parsed.steps
              .filter(
                (step): step is VisionActionStep =>
                  typeof step?.timeRange === "string" &&
                  typeof step?.description === "string",
              )
              .slice(0, 6)
          : [],
        confidenceNote: parsed.confidenceNote || "模型未提供置信说明。",
      };
    } catch {
      return {
        summary: content || "暂时无法确认动作序列。",
        steps: [],
        confidenceNote: "模型没有返回结构化 JSON，已保留原始摘要。",
      };
    }
  }

  async createConversationReply(request: ConversationRequest) {
    const model = process.env.OPENAI_VISION_MODEL ?? "qwen3.5-omni-plus";
    const sceneMode = request.sceneMode ?? "general";
    const sceneContext = sceneModePrompts[sceneMode];
    const historyContext =
      request.history && request.history.length > 0
        ? [
            "最近对话历史如下。用户追问前文时请结合历史；如果历史和当前画面冲突，以当前画面为准。",
            ...request.history.slice(-20).map(formatHistoryItem),
          ].join("\n\n")
        : "当前会话没有可用的历史对话。";
    const visualContext = request.visionSummary
      ? [
          "当前可见画面：",
          request.visionSummary.summary,
          `内部时间：${request.visionSummary.createdAt}`,
        ].join("\n")
      : "当前没有可用的画面信息。";
    const actionContext = request.visionTimeline
      ? [
          "刚才几秒内的动作变化：",
          request.visionTimeline.summary,
          ...request.visionTimeline.steps.map(
            (step) => `${step.timeRange}：${step.description}`,
          ),
          `内部动作窗口：${request.visionTimeline.startedAt} 到 ${request.visionTimeline.endedAt}`,
          `可信度说明：${request.visionTimeline.confidenceNote}`,
        ].join("\n")
      : "当前没有可用的动作变化信息。";

    const result = await this.client.chat.completions.create({
      model,
      messages: [
        {
          role: "system",
          content:
            "你是一个正在和用户自然对话的视觉语音助手。回答要像现场看着画面聊天一样，中文优先，简短直接。不要在回复里说“视觉摘要”“动作时间线”“基于某个时间”“上下文显示”等内部实现词。用户问当前画面时，直接说你看到的内容；用户问刚才发生了什么时，直接描述刚才的动作变化。如果信息不足、可能漏帧或看不清，可以自然地说“我不太确定”或“我刚才只看到……”。场景模式只改变回答侧重点，不改变事实判断。",
        },
        {
          role: "user",
          content: `${sceneContext}\n\n${historyContext}\n\n${visualContext}\n\n${actionContext}\n\n用户刚才说：${request.text}`,
        },
      ],
    });

    return result.choices[0]?.message.content || "我暂时没法生成回答。";
  }

  getRealtimeEndpoint() {
    return createOpenaiUrl("/realtime/calls");
  }
}
