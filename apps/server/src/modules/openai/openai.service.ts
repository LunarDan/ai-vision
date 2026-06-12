import { Injectable } from "@nestjs/common";
import type { ConversationRequest } from "@ai-vision/shared";
import OpenAI from "openai";

const openaiBaseUrl = process.env.OPENAI_BASE_URL ?? "https://dashscope.aliyuncs.com/compatible-mode/v1";
const createOpenaiUrl = (path: string) => `${openaiBaseUrl.replace(/\/$/, "")}${path}`;

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

  async createConversationReply(request: ConversationRequest) {
    const model = process.env.OPENAI_VISION_MODEL ?? "qwen3.5-omni-plus";
    const visualContext = request.visionSummary
      ? [
          "最近一次摄像头画面摘要：",
          request.visionSummary.summary,
          `分析时间：${request.visionSummary.createdAt}`,
        ].join("\n")
      : "当前没有可用的摄像头画面摘要。";

    const result = await this.client.chat.completions.create({
      model,
      messages: [
        {
          role: "system",
          content:
            "你是一个通义千问视觉语音助手。回答要自然、简短、中文优先。用户问画面相关问题时，优先参考视觉摘要；信息不足时要说明不确定。",
        },
        {
          role: "user",
          content: `${visualContext}\n\n用户语音文本：${request.text}`,
        },
      ],
    });

    return result.choices[0]?.message.content || "我暂时无法生成回答。";
  }

  getRealtimeEndpoint() {
    return createOpenaiUrl("/realtime/calls");
  }
}
