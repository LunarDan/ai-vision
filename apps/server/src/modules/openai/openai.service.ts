import { Injectable } from "@nestjs/common";
import type {
  ConversationRequest,
  VisionActionStep,
  VisionSequenceFrame,
} from "@ai-vision/shared";
import OpenAI from "openai";

const openaiBaseUrl = process.env.OPENAI_BASE_URL ?? "https://dashscope.aliyuncs.com/compatible-mode/v1";
const createOpenaiUrl = (path: string) => `${openaiBaseUrl.replace(/\/$/, "")}${path}`;

type ImageSequenceAnalysis = {
  summary: string;
  steps: VisionActionStep[];
  confidenceNote: string;
};

@Injectable()
export class OpenaiService {
  private readonly client = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: openaiBaseUrl,
  });

  async createRealtimeSession(): Promise<never> {
    throw new Error("OpenAI Realtime WebRTC is disabled. Use the Omni WebSocket proxy instead.");
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
                "下面是一组按时间排序的摄像头关键帧，来自最近几秒的视频采样。",
                "请判断画面中的人或主要物体发生了哪些连续动作，不要只描述最后一帧。",
                "请严格返回 JSON，格式为：",
                '{"summary":"一句话总结动作序列","steps":[{"timeRange":"0.0s-1.0s","description":"动作描述"}],"confidenceNote":"置信度和不确定性说明"}',
                "如果动作不明显，请说明画面基本静止或无法确定。",
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
    const visualContext = request.visionSummary
      ? [
          "最近一次摄像头画面摘要：",
          request.visionSummary.summary,
          `分析时间：${request.visionSummary.createdAt}`,
        ].join("\n")
      : "当前没有可用的摄像头画面摘要。";
    const actionContext = request.visionTimeline
      ? [
          "最近几秒动作时间线：",
          request.visionTimeline.summary,
          ...request.visionTimeline.steps.map(
            (step) => `${step.timeRange}：${step.description}`,
          ),
          `动作分析窗口：${request.visionTimeline.startedAt} 到 ${request.visionTimeline.endedAt}`,
          `置信说明：${request.visionTimeline.confidenceNote}`,
        ].join("\n")
      : "当前没有可用的多帧动作时间线。";

    const result = await this.client.chat.completions.create({
      model,
      messages: [
        {
          role: "system",
          content:
            "你是一个通义千问视觉语音助手。回答要自然、简短、中文优先。用户问当前画面时，参考最近摄像头关键帧摘要；用户问刚才发生了什么、做了什么动作、手势或连续变化时，优先参考最近几秒多帧动作时间线。如果摘要或时间线可能漏帧、过期、信息不足或无法确定，要明确说明不确定，不要假装正在连续观看完整实时视频。",
        },
        {
          role: "user",
          content: `${visualContext}\n\n${actionContext}\n\n用户语音文本：${request.text}`,
        },
      ],
    });

    return result.choices[0]?.message.content || "我暂时无法生成回答。";
  }

  getRealtimeEndpoint() {
    return createOpenaiUrl("/realtime/calls");
  }
}
