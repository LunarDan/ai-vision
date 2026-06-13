import { createHash, randomBytes } from "node:crypto";
import type { IncomingMessage, Server } from "node:http";
import type { Socket } from "node:net";
import type {
  ConversationRequest,
  OmniClientEvent,
  OmniServerEvent,
  VideoStreamFrame,
  VisionActionTimeline,
  VisionSequenceFrame,
  VisionSummary,
} from "@ai-vision/shared";
import type { OpenaiService } from "../openai/openai.service.js";

type OmniConnectionState = {
  sessionId: string;
  cloudAnalyses: number;
  timelineAnalyses: number;
  timelineErrors: number;
  timelineAnalysesInFlight: boolean;
  receivedFrames: number;
  lastSummaryAt: number;
  lastTimelineAt: number;
  lastError: string | null;
  videoFrames: VideoStreamFrame[];
  visionTimeline: VisionActionTimeline | null;
  visionSummary: VisionSummary | null;
};

const videoMemoryWindowMs = 15000;
const summaryIntervalMs = 10000;
const timelineIntervalMs = 5000;
const maxBufferedVideoFrames = 24;
const maxVideoFrameBase64Length = 260000;
const minTimelineFrames = 3;
const maxTimelineSequenceFrames = 8;

const textDecoder = new TextDecoder();

const encodeFrame = (payload: string) => {
  const data = Buffer.from(payload);
  const length = data.length;

  if (length < 126) {
    return Buffer.concat([Buffer.from([0x81, length]), data]);
  }

  if (length <= 65535) {
    const header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(length, 2);
    return Buffer.concat([header, data]);
  }

  const header = Buffer.alloc(10);
  header[0] = 0x81;
  header[1] = 127;
  header.writeBigUInt64BE(BigInt(length), 2);
  return Buffer.concat([header, data]);
};

const sendJson = (socket: Socket, event: OmniServerEvent) => {
  if (socket.destroyed || !socket.writable) return;
  socket.write(encodeFrame(JSON.stringify(event)));
};

const pruneVideoFrames = (frames: VideoStreamFrame[]) => {
  const cutoff = Date.now() - videoMemoryWindowMs;
  return frames
    .filter((frame) => new Date(frame.capturedAt).getTime() >= cutoff)
    .slice(-maxBufferedVideoFrames);
};

const toSequenceFrames = (frames: VideoStreamFrame[]): VisionSequenceFrame[] => {
  const orderedFrames = pruneVideoFrames(frames);
  const selectedFrames =
    orderedFrames.length <= maxTimelineSequenceFrames
      ? orderedFrames
      : Array.from({ length: maxTimelineSequenceFrames }, (_, index) => {
          const frameIndex = Math.round(
            (index * (orderedFrames.length - 1)) /
              (maxTimelineSequenceFrames - 1),
          );
          return orderedFrames[frameIndex];
        });
  const firstFrameAt = new Date(
    selectedFrames[0]?.capturedAt ?? new Date(),
  ).getTime();
  return selectedFrames.map((frame) => ({
    id: frame.id,
    imageBase64: frame.imageBase64,
    capturedAt: frame.capturedAt,
    offsetMs: new Date(frame.capturedAt).getTime() - firstFrameAt,
  }));
};

const createVisionSummary = (
  sessionId: string,
  summary: string,
  imageBytes: number,
  latencyMs: number,
): VisionSummary => ({
  id: randomBytes(8).toString("hex"),
  sessionId,
  summary,
  detail: "low",
  imageBytes,
  latencyMs,
  createdAt: new Date().toISOString(),
});

const createActionTimeline = (
  sessionId: string,
  frames: VideoStreamFrame[],
  analysis: {
    summary: string;
    steps: VisionActionTimeline["steps"];
    confidenceNote: string;
  },
  latencyMs: number,
): VisionActionTimeline => {
  const orderedFrames = pruneVideoFrames(frames);
  const startedAt = orderedFrames[0]?.capturedAt ?? new Date().toISOString();
  const endedAt =
    orderedFrames[orderedFrames.length - 1]?.capturedAt ?? startedAt;

  return {
    id: randomBytes(8).toString("hex"),
    sessionId,
    summary: analysis.summary,
    steps: analysis.steps,
    confidenceNote: analysis.confidenceNote,
    frameCount: orderedFrames.length,
    dedupedFrameCount: 0,
    startedAt,
    endedAt,
    latencyMs,
    createdAt: new Date().toISOString(),
  };
};

const decodeTextFrames = (buffer: Buffer) => {
  const messages: string[] = [];
  let offset = 0;

  while (offset + 2 <= buffer.length) {
    const firstByte = buffer[offset];
    const secondByte = buffer[offset + 1];
    const opcode = firstByte & 0x0f;
    const masked = (secondByte & 0x80) === 0x80;
    let payloadLength = secondByte & 0x7f;
    offset += 2;

    if (payloadLength === 126) {
      if (offset + 2 > buffer.length) break;
      payloadLength = buffer.readUInt16BE(offset);
      offset += 2;
    } else if (payloadLength === 127) {
      if (offset + 8 > buffer.length) break;
      payloadLength = Number(buffer.readBigUInt64BE(offset));
      offset += 8;
    }

    if (!masked || offset + 4 + payloadLength > buffer.length) break;
    const mask = buffer.subarray(offset, offset + 4);
    offset += 4;
    const payload = buffer.subarray(offset, offset + payloadLength);
    offset += payloadLength;

    if (opcode === 0x8) break;
    if (opcode !== 0x1) continue;

    const unmasked = Buffer.alloc(payload.length);
    payload.forEach((byte, index) => {
      unmasked[index] = byte ^ mask[index % 4];
    });
    messages.push(textDecoder.decode(unmasked));
  }

  return messages;
};

const acceptWebSocket = (request: IncomingMessage, socket: Socket) => {
  const key = request.headers["sec-websocket-key"];
  if (!key || Array.isArray(key)) {
    socket.destroy();
    return false;
  }

  const accept = createHash("sha1")
    .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
    .digest("base64");

  socket.write(
    [
      "HTTP/1.1 101 Switching Protocols",
      "Upgrade: websocket",
      "Connection: Upgrade",
      `Sec-WebSocket-Accept: ${accept}`,
      "",
      "",
    ].join("\r\n"),
  );
  return true;
};

const sendStatus = (socket: Socket, state: OmniConnectionState) => {
  sendJson(socket, {
    type: "video_status",
    receivedFrames: state.receivedFrames,
    bufferedFrames: state.videoFrames.length,
    cloudAnalyses: state.cloudAnalyses,
    timelineAnalyses: state.timelineAnalyses,
    timelineErrors: state.timelineErrors,
    lastTimelineAt: state.visionTimeline?.createdAt ?? null,
    lastError: state.lastError,
    updatedAt: new Date().toISOString(),
  });
};

const handleVideoFrame = (
  netSocket: Socket,
  openaiService: OpenaiService,
  state: OmniConnectionState,
  frame: VideoStreamFrame,
) => {
  if (!frame?.imageBase64 || frame.imageBase64.length > maxVideoFrameBase64Length) {
    sendJson(netSocket, {
      type: "error",
      message: "视频关键帧过大或格式无效，已跳过。",
    });
    return;
  }

  state.receivedFrames += 1;
  state.videoFrames = pruneVideoFrames([...state.videoFrames, frame]);
  const now = Date.now();

  if (now - state.lastSummaryAt >= summaryIntervalMs) {
    state.lastSummaryAt = now;
    const startedAt = Date.now();
    void openaiService
      .analyzeImage(frame.imageBase64, "low")
      .then((summary) => {
        state.cloudAnalyses += 1;
        state.lastError = null;
        state.visionSummary = createVisionSummary(
          state.sessionId,
          summary,
          Buffer.byteLength(frame.imageBase64),
          Date.now() - startedAt,
        );
        sendJson(netSocket, {
          type: "video_summary",
          snapshot: state.visionSummary,
        });
        sendStatus(netSocket, state);
      })
      .catch((error: unknown) => {
        state.lastError = `视频流画面摘要失败：${String(
          error instanceof Error ? error.message : error,
        )}`;
        sendJson(netSocket, {
          type: "error",
          message: state.lastError,
        });
      });
  }

  if (
    now - state.lastTimelineAt >= timelineIntervalMs &&
    state.videoFrames.length >= minTimelineFrames &&
    !state.timelineAnalysesInFlight
  ) {
    state.lastTimelineAt = now;
    state.timelineAnalysesInFlight = true;
    const selectedFrames = [...state.videoFrames];
    const startedAt = Date.now();
    void openaiService
      .analyzeImageSequence(toSequenceFrames(selectedFrames))
      .then((analysis) => {
        state.cloudAnalyses += 1;
        state.timelineAnalyses += 1;
        state.lastError = null;
        state.visionTimeline = createActionTimeline(
          state.sessionId,
          selectedFrames,
          analysis,
          Date.now() - startedAt,
        );
        sendJson(netSocket, {
          type: "action_timeline",
          timeline: state.visionTimeline,
        });
        sendStatus(netSocket, state);
      })
      .catch((error: unknown) => {
        state.timelineErrors += 1;
        state.lastError = `视频流动作分析失败：${String(
          error instanceof Error ? error.message : error,
        )}`;
        sendJson(netSocket, {
          type: "error",
          message: state.lastError,
        });
      })
      .finally(() => {
        state.timelineAnalysesInFlight = false;
        sendStatus(netSocket, state);
      });
  }

  sendStatus(netSocket, state);
};

export const attachOmniWebSocketProxy = (
  server: Server,
  openaiService: OpenaiService,
) => {
  server.on("upgrade", (request, socket) => {
    const netSocket = socket as Socket;
    const url = request.url ?? "";
    if (!url.startsWith("/api/omni/realtime")) {
      netSocket.destroy();
      return;
    }

    if (!acceptWebSocket(request, netSocket)) return;

    const state: OmniConnectionState = {
      sessionId: randomBytes(8).toString("hex"),
      cloudAnalyses: 0,
      timelineAnalyses: 0,
      timelineErrors: 0,
      timelineAnalysesInFlight: false,
      receivedFrames: 0,
      lastSummaryAt: 0,
      lastTimelineAt: 0,
      lastError: null,
      videoFrames: [],
      visionTimeline: null,
      visionSummary: null,
    };
    sendJson(netSocket, { type: "ready", provider: "fallback" });

    netSocket.on("data", (buffer) => {
      for (const message of decodeTextFrames(buffer)) {
        let event: OmniClientEvent;
        try {
          event = JSON.parse(message) as OmniClientEvent;
        } catch {
          sendJson(netSocket, {
            type: "error",
            message: "WebSocket 消息格式无效，已忽略。",
          });
          continue;
        }

        if (event.type === "start") {
          state.sessionId = event.sessionId;
          sendJson(netSocket, { type: "ready", provider: "fallback" });
        }

        if (event.type === "vision_context") {
          state.visionSummary = event.snapshot;
          sendJson(netSocket, {
            type: "text",
            text: "视觉摘要已同步。",
            final: true,
          });
        }

        if (event.type === "video_frame") {
          handleVideoFrame(netSocket, openaiService, state, event.frame);
        }

        if (event.type === "text") {
          const requestBody: ConversationRequest = {
            sessionId: state.sessionId,
            text: event.text,
            visionTimeline: state.visionTimeline,
            visionSummary: state.visionSummary,
          };

          void openaiService
            .createConversationReply(requestBody)
            .then((reply) =>
              sendJson(netSocket, { type: "text", text: reply, final: true }),
            )
            .catch((error: unknown) =>
              sendJson(netSocket, {
                type: "error",
                message: `通义千问回复失败：${String(
                  error instanceof Error ? error.message : error,
                )}`,
              }),
            );
        }

        if (event.type === "stop") {
          sendJson(netSocket, { type: "closed" });
          netSocket.end();
        }
      }
    });
  });
};
