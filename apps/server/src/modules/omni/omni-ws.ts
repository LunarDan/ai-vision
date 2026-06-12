import { createHash, randomBytes } from "node:crypto";
import type { IncomingMessage, Server } from "node:http";
import type { Socket } from "node:net";
import type { ConversationRequest, OmniClientEvent, OmniServerEvent, VisionSummary } from "@ai-vision/shared";
import type { OpenaiService } from "../openai/openai.service.js";

type OmniConnectionState = {
  sessionId: string;
  visionSummary: VisionSummary | null;
};

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
  socket.write(encodeFrame(JSON.stringify(event)));
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

export const attachOmniWebSocketProxy = (server: Server, openaiService: OpenaiService) => {
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
      visionSummary: null,
    };
    sendJson(netSocket, { type: "ready", provider: "fallback" });

    netSocket.on("data", (buffer) => {
      for (const message of decodeTextFrames(buffer)) {
        const event = JSON.parse(message) as OmniClientEvent;

        if (event.type === "start") {
          state.sessionId = event.sessionId;
          sendJson(netSocket, { type: "ready", provider: "fallback" });
        }

        if (event.type === "vision_context") {
          state.visionSummary = event.snapshot;
          sendJson(netSocket, { type: "text", text: "视觉摘要已同步。", final: true });
        }

        if (event.type === "text") {
          const requestBody: ConversationRequest = {
            sessionId: state.sessionId,
            text: event.text,
            visionSummary: state.visionSummary,
          };

          void openaiService
            .createConversationReply(requestBody)
            .then((reply) => sendJson(netSocket, { type: "text", text: reply, final: true }))
            .catch((error: unknown) =>
              sendJson(netSocket, {
                type: "error",
                message: `通义千问回复失败：${String(error instanceof Error ? error.message : error)}`,
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
