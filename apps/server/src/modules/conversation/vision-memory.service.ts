import { Injectable } from "@nestjs/common";
import type {
  UsedVisionContext,
  VisionActionTimeline,
  VisionSummary,
} from "@ai-vision/shared";

type VisionMemory = {
  visionSummary: VisionSummary | null;
  visionTimeline: VisionActionTimeline | null;
  summaryAnalyzing: boolean;
  timelineAnalyzing: boolean;
  updatedAt: string;
  listeners: Set<() => void>;
};

const visionFreshMs = 5000;
const timelineFreshMs = 8000;
const defaultWaitMs = 1500;

@Injectable()
export class VisionMemoryService {
  private readonly memories = new Map<string, VisionMemory>();

  getMemory(sessionId: string) {
    return this.ensureMemory(sessionId);
  }

  updateSummary(sessionId: string, visionSummary: VisionSummary | null) {
    const memory = this.ensureMemory(sessionId);
    memory.visionSummary = visionSummary;
    memory.updatedAt = new Date().toISOString();
    this.notify(memory);
  }

  updateTimeline(sessionId: string, visionTimeline: VisionActionTimeline | null) {
    const memory = this.ensureMemory(sessionId);
    memory.visionTimeline = visionTimeline;
    memory.updatedAt = new Date().toISOString();
    this.notify(memory);
  }

  setAnalyzing(
    sessionId: string,
    kind: "summary" | "timeline",
    analyzing: boolean,
  ) {
    const memory = this.ensureMemory(sessionId);
    if (kind === "summary") {
      memory.summaryAnalyzing = analyzing;
    } else {
      memory.timelineAnalyzing = analyzing;
    }
    memory.updatedAt = new Date().toISOString();
    this.notify(memory);
  }

  isAnalyzing(sessionId: string) {
    const memory = this.ensureMemory(sessionId);
    return memory.summaryAnalyzing || memory.timelineAnalyzing;
  }

  getFreshness(sessionId: string): "fresh" | "stale" | "missing" {
    const memory = this.ensureMemory(sessionId);
    if (!memory.visionSummary && !memory.visionTimeline) return "missing";
    const summaryFresh = this.isSummaryFresh(memory.visionSummary);
    const timelineFresh = this.isTimelineFresh(memory.visionTimeline);
    return summaryFresh || timelineFresh ? "fresh" : "stale";
  }

  async waitForFreshContext(sessionId: string, timeoutMs = defaultWaitMs) {
    const memory = this.ensureMemory(sessionId);
    if (!this.isAnalyzing(sessionId)) return false;
    if (this.hasFreshContext(memory)) return false;

    return new Promise<boolean>((resolve) => {
      let resolved = false;
      const finish = (waited: boolean) => {
        if (resolved) return;
        resolved = true;
        clearTimeout(timer);
        memory.listeners.delete(listener);
        resolve(waited);
      };
      const listener = () => {
        if (!this.isAnalyzing(sessionId) || this.hasFreshContext(memory)) {
          finish(true);
        }
      };
      const timer = setTimeout(() => finish(true), timeoutMs);
      memory.listeners.add(listener);
    });
  }

  resolveContext(
    sessionId: string,
    fallback: {
      visionSummary?: VisionSummary | null;
      visionTimeline?: VisionActionTimeline | null;
    },
    waitedForFreshVision: boolean,
  ) {
    const memory = this.ensureMemory(sessionId);
    const visionSummary = memory.visionSummary ?? fallback.visionSummary ?? null;
    const visionTimeline =
      memory.visionTimeline ?? fallback.visionTimeline ?? null;
    const usedVisionContext: UsedVisionContext = {
      visionSummaryAt: visionSummary?.createdAt ?? null,
      visionTimelineAt: visionTimeline?.createdAt ?? null,
      waitedForFreshVision,
      source:
        memory.visionSummary || memory.visionTimeline
          ? "server-memory"
          : visionSummary || visionTimeline
            ? "request-cache"
            : "none",
    };

    return { visionSummary, visionTimeline, usedVisionContext };
  }

  clearSession(sessionId: string) {
    this.memories.delete(sessionId);
  }

  private ensureMemory(sessionId: string): VisionMemory {
    const existing = this.memories.get(sessionId);
    if (existing) return existing;

    const memory: VisionMemory = {
      visionSummary: null,
      visionTimeline: null,
      summaryAnalyzing: false,
      timelineAnalyzing: false,
      updatedAt: new Date().toISOString(),
      listeners: new Set(),
    };
    this.memories.set(sessionId, memory);
    return memory;
  }

  private notify(memory: VisionMemory) {
    for (const listener of memory.listeners) listener();
  }

  private hasFreshContext(memory: VisionMemory) {
    return (
      this.isSummaryFresh(memory.visionSummary) ||
      this.isTimelineFresh(memory.visionTimeline)
    );
  }

  private isSummaryFresh(summary: VisionSummary | null) {
    return (
      !!summary &&
      Date.now() - new Date(summary.createdAt).getTime() <= visionFreshMs
    );
  }

  private isTimelineFresh(timeline: VisionActionTimeline | null) {
    return (
      !!timeline &&
      Date.now() - new Date(timeline.createdAt).getTime() <= timelineFreshMs
    );
  }
}
