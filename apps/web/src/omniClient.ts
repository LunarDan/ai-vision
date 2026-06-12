import type { OmniClientEvent, OmniServerEvent, VisionSummary } from "@ai-vision/shared";

type OmniClientOptions = {
  apiBase: string;
  sessionId: string;
  onAssistantMessage: (message: string) => void;
  onStatusChange: (status: "connecting" | "connected" | "closed" | "error") => void;
};

export type OmniSendStatus = "sent" | "queued" | "failed";

export type OmniClient = {
  disconnect: () => void;
  sendText: (text: string) => OmniSendStatus;
  syncVisionContext: (snapshot: VisionSummary) => OmniSendStatus;
};

const createWsUrl = (apiBase: string) => {
  if (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") {
    return "ws://localhost:3001/api/omni/realtime";
  }

  const baseUrl = new URL(apiBase, window.location.origin);
  baseUrl.protocol = baseUrl.protocol === "https:" ? "wss:" : "ws:";
  if (baseUrl.port && baseUrl.port !== "3001") {
    baseUrl.port = "3001";
  }
  baseUrl.pathname = `${baseUrl.pathname.replace(/\/$/, "")}/omni/realtime`;
  return baseUrl.toString();
};

const speak = (text: string) => {
  if (!("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "zh-CN";
  window.speechSynthesis.speak(utterance);
};

export const createOmniClient = ({ apiBase, sessionId, onAssistantMessage, onStatusChange }: OmniClientOptions) => {
  const socket = new WebSocket(createWsUrl(apiBase));
  const queuedEvents: OmniClientEvent[] = [];

  const sendEvent = (event: OmniClientEvent): OmniSendStatus => {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(event));
      return "sent";
    }

    if (socket.readyState === WebSocket.CONNECTING) {
      queuedEvents.push(event);
      return "queued";
    }

    return "failed";
  };

  socket.onopen = () => {
    onStatusChange("connected");
    sendEvent({ type: "start", sessionId });
    while (queuedEvents.length > 0) {
      const event = queuedEvents.shift();
      if (event) {
        socket.send(JSON.stringify(event));
      }
    }
  };

  socket.onclose = () => {
    onStatusChange("closed");
  };

  socket.onerror = () => {
    onStatusChange("error");
  };

  socket.onmessage = (messageEvent) => {
    const event = JSON.parse(String(messageEvent.data)) as OmniServerEvent;
    if (event.type === "text") {
      onAssistantMessage(event.text);
      if (event.final ?? true) {
        speak(event.text);
      }
    }
    if (event.type === "error") {
      onAssistantMessage(event.message);
      onStatusChange("error");
    }
  };

  onStatusChange("connecting");

  return {
    disconnect: () => {
      sendEvent({ type: "stop" });
      socket.close();
      window.speechSynthesis?.cancel();
    },
    sendText: (text: string) => sendEvent({ type: "text", text }),
    syncVisionContext: (snapshot: VisionSummary) => sendEvent({ type: "vision_context", snapshot }),
  };
};
