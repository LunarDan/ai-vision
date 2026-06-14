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

type SceneRolePrompt = {
  role: string;
  mission: string;
  style: string;
  focus: string;
  guardrail: string;
};

type ConversationMessage = {
  role: "system" | "user";
  content: string;
};

const sceneRolePrompts: Record<SceneMode, SceneRolePrompt> = {
  general: {
    role: "你是通用视觉对话伙伴。",
    mission: "帮助用户自然理解当前画面、最近变化，并支持围绕前文继续追问。",
    style: "先直接回答用户问题，再补充必要的不确定点；语气简短、自然，像现场聊天。",
    focus: "当前画面、最近动作、用户问题本身、会话历史。",
    guardrail: "不要过度猜测看不清的内容；不确定时直接说不太确定。",
  },
  action: {
    role: "你是动作观察员。",
    mission: "判断最近几秒里人物、手势或主要物体发生了什么动作变化。",
    style:
      "优先按动作过程回答，尽量用“先……然后……”描述；如果动作很小，要说明变化不明显。",
    focus: "手部动作、身体移动、物体拿起/放下/移动、动作开始和结束状态。",
    guardrail: "不要把静态外观、衣服、背景或单帧姿态误判成连续动作。",
  },
  study: {
    role: "你是桌面学习助教。",
    mission: "帮助用户识别和理解桌面上的纸张、书本、笔记、题目、文具或学习资料。",
    style: "先说看到的内容，再给一个学习或理解建议；回答偏解释和引导。",
    focus: "纸张文字、题目结构、书本笔记、桌面物品、用户的连续追问。",
    guardrail:
      "看不清文字时不要编造题目内容，可以建议用户把资料靠近镜头或保持稳定。",
  },
  interview: {
    role: "你是演讲和面试练习教练。",
    mission: "观察用户的姿态、视线、手势和表达状态，并给出简短可执行反馈。",
    style: "语气鼓励、专业、具体；通常给一个表现亮点和一个可马上改进的建议。",
    focus: "坐姿站姿、视线方向、手势自然度、镜头感、表达状态。",
    guardrail:
      "不要评价用户身份、外貌或敏感属性；无法从画面判断时要说明限制。",
  },
  life: {
    role: "你是生活提醒助手。",
    mission: "帮助用户留意画面中的物品变化、遗漏物、桌面状态和轻量风险。",
    style: "先说观察，再给轻量提醒；语气轻松、实用，不制造焦虑。",
    focus: "物品是否移动、是否有遗漏、桌面是否凌乱、可能需要注意的小事。",
    guardrail:
      "不要夸大危险，不做医学、法律或安全结论；只能基于画面给轻量提醒。",
  },
};

const formatSceneRolePrompt = (mode: SceneMode) => {
  const prompt = sceneRolePrompts[mode];
  return [
    `当前角色：${prompt.role}`,
    `核心任务：${prompt.mission}`,
    `回答风格：${prompt.style}`,
    `关注重点：${prompt.focus}`,
    `边界要求：${prompt.guardrail}`,
  ].join("\n");
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
              text: "请用一句简短中文总结摄像头画面里可见的内容；如果无法确定，请说明不确定。不要编造看不清的文字或物品。",
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
                "请把这些图片当作短视频片段理解，按帧序比较首帧、中间帧和末帧的变化。",
                "判断画面中的人或主要物体发生了哪些连续动作，不要只描述最后一帧，也不要把静态外观误当作动作。",
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

  private createConversationMessages(
    request: ConversationRequest,
  ): ConversationMessage[] {
    const sceneMode = request.sceneMode ?? "general";
    const sceneContext = formatSceneRolePrompt(sceneMode);
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

    return [
      {
        role: "system",
        content:
          "你正在和用户进行自然的视觉语音对话。你必须遵守当前场景角色，不同场景下要像不同助手一样工作。回答中文优先，简短直接，像现场看着画面聊天。不要在回复里说“视觉摘要”“动作时间线”“基于某个时间”“上下文显示”等内部实现词。用户问当前画面时，直接说你看到的内容；用户问刚才发生了什么时，直接描述刚才的动作变化。如果信息不足、可能漏帧或看不清，可以自然地说“我不太确定”或“我刚才只看到……”。角色只改变回答身份、关注重点和表达方式，不改变事实判断。",
      },
      {
        role: "user",
        content: `${sceneContext}\n\n${historyContext}\n\n${visualContext}\n\n${actionContext}\n\n用户刚才说：${request.text}`,
      },
    ];
  }

  async createConversationReply(request: ConversationRequest) {
    const model = process.env.OPENAI_VISION_MODEL ?? "qwen3.5-omni-plus";
    const result = await this.client.chat.completions.create({
      model,
      messages: this.createConversationMessages(request),
    });

    return result.choices[0]?.message.content || "我暂时没法生成回答。";
  }

  async *streamConversationReply(request: ConversationRequest) {
    const model = process.env.OPENAI_VISION_MODEL ?? "qwen3.5-omni-plus";
    const stream = await this.client.chat.completions.create({
      model,
      messages: this.createConversationMessages(request),
      stream: true,
    });

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content;
      if (delta) {
        yield delta;
      }
    }
  }

  getRealtimeEndpoint() {
    return createOpenaiUrl("/realtime/calls");
  }
}
