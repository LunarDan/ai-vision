import { Injectable } from "@nestjs/common";
import OpenAI from "openai";

@Injectable()
export class OpenaiService {
  private readonly client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  async createRealtimeSession() {
    const model = process.env.OPENAI_REALTIME_MODEL ?? "gpt-realtime";

    const response = await fetch("https://api.openai.com/v1/realtime/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        voice: "alloy",
        instructions:
          "You are an AI vision conversation assistant. Use the latest visual summary when answering camera-related questions. Be concise and natural in spoken replies.",
      }),
    });

    if (!response.ok) {
      throw new Error(`Failed to create realtime session: ${response.status}`);
    }

    return response.json() as Promise<{
      client_secret?: { value?: string; expires_at?: number };
    }>;
  }

  async analyzeImage(imageBase64: string, detail: "low" | "high") {
    const model = process.env.OPENAI_VISION_MODEL ?? "gpt-4.1-mini";
    const result = await this.client.responses.create({
      model,
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: "Summarize what is visible in this camera frame in one short Chinese sentence. Mention uncertainty if needed.",
            },
            {
              type: "input_image",
              image_url: imageBase64,
              detail,
            },
          ],
        },
      ],
    });

    return result.output_text || "暂时无法确认画面内容。";
  }
}
