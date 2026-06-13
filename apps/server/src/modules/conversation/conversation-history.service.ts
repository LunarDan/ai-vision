import { Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type {
  ConversationHistoryItem,
  ConversationTurnContext,
  VisionSummary,
} from "@ai-vision/shared";

const maxHistoryItemsPerSession = 20;

const createImageReference = (
  visionSummary?: VisionSummary | null,
): ConversationTurnContext["imageReference"] => {
  if (!visionSummary) return null;
  const { objectKey, bucket, contentType, sha256 } = visionSummary;
  if (!objectKey && !bucket && !sha256) return null;

  return {
    objectKey,
    bucket,
    contentType,
    sha256,
  };
};

@Injectable()
export class ConversationHistoryService {
  private readonly historyBySession = new Map<string, ConversationHistoryItem[]>();

  getHistory(sessionId: string) {
    return [...(this.historyBySession.get(sessionId) ?? [])];
  }

  recordUserTurn(
    sessionId: string,
    content: string,
    context: Omit<ConversationTurnContext, "imageReference">,
  ) {
    this.append({
      id: randomUUID(),
      sessionId,
      role: "user",
      content,
      createdAt: new Date().toISOString(),
      context: {
        ...context,
        imageReference: createImageReference(context.visionSummary),
      },
    });
  }

  recordAssistantTurn(
    sessionId: string,
    content: string,
    context: ConversationTurnContext,
  ) {
    this.append({
      id: randomUUID(),
      sessionId,
      role: "assistant",
      content,
      createdAt: new Date().toISOString(),
      context,
    });
  }

  clearSession(sessionId: string) {
    this.historyBySession.delete(sessionId);
  }

  private append(item: ConversationHistoryItem) {
    const current = this.historyBySession.get(item.sessionId) ?? [];
    this.historyBySession.set(
      item.sessionId,
      [...current, item].slice(-maxHistoryItemsPerSession),
    );
  }
}
