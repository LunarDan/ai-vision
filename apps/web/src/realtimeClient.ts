import type { RealtimeSessionResponse } from "@ai-vision/shared";

type RealtimeClientOptions = {
  apiBase: string;
  mediaStream: MediaStream;
  onAssistantMessage: (message: string) => void;
  onStatusChange: (status: RTCPeerConnectionState) => void;
};

export type RealtimeClient = {
  peerConnection: RTCPeerConnection;
  dataChannel: RTCDataChannel;
  remoteAudio: HTMLAudioElement;
  disconnect: () => void;
};

const realtimeEndpoint = "https://api.openai.com/v1/realtime/calls";

const isTextDeltaEvent = (event: unknown): event is { delta?: string; text?: string } => {
  if (!event || typeof event !== "object") return false;
  return "delta" in event || "text" in event;
};

const readAssistantText = (event: unknown) => {
  if (!isTextDeltaEvent(event)) return "";
  return event.delta ?? event.text ?? "";
};

export const createRealtimeClient = async ({
  apiBase,
  mediaStream,
  onAssistantMessage,
  onStatusChange,
}: RealtimeClientOptions): Promise<RealtimeClient> => {
  const sessionResponse = await fetch(`${apiBase}/realtime/session`, {
    method: "POST",
  });

  if (!sessionResponse.ok) {
    throw new Error(`Realtime session failed with ${sessionResponse.status}`);
  }

  const session = (await sessionResponse.json()) as RealtimeSessionResponse;
  if (!session.clientSecret) {
    throw new Error("Realtime session did not return a client secret.");
  }

  const peerConnection = new RTCPeerConnection();
  const remoteAudio = new Audio();
  remoteAudio.autoplay = true;

  peerConnection.onconnectionstatechange = () => {
    onStatusChange(peerConnection.connectionState);
  };

  peerConnection.ontrack = (event) => {
    const [remoteStream] = event.streams;
    if (remoteStream) {
      remoteAudio.srcObject = remoteStream;
    }
  };

  mediaStream.getAudioTracks().forEach((track) => {
    peerConnection.addTrack(track, mediaStream);
  });

  const dataChannel = peerConnection.createDataChannel("oai-events");
  dataChannel.onmessage = (messageEvent) => {
    try {
      const event = JSON.parse(String(messageEvent.data)) as unknown;
      const assistantText = readAssistantText(event);
      if (assistantText) {
        onAssistantMessage(assistantText);
      }
    } catch {
      // Realtime events can include non-text payloads. Ignore anything the UI cannot render yet.
    }
  };

  const offer = await peerConnection.createOffer();
  await peerConnection.setLocalDescription(offer);

  const sdpResponse = await fetch(`${realtimeEndpoint}?model=${encodeURIComponent(session.model)}`, {
    method: "POST",
    body: offer.sdp,
    headers: {
      Authorization: `Bearer ${session.clientSecret}`,
      "Content-Type": "application/sdp",
    },
  });

  if (!sdpResponse.ok) {
    peerConnection.close();
    throw new Error(`Realtime SDP exchange failed with ${sdpResponse.status}`);
  }

  const answerSdp = await sdpResponse.text();
  await peerConnection.setRemoteDescription({ type: "answer", sdp: answerSdp });

  return {
    peerConnection,
    dataChannel,
    remoteAudio,
    disconnect: () => {
      dataChannel.close();
      peerConnection.getSenders().forEach((sender) => sender.track?.stop());
      peerConnection.close();
      remoteAudio.srcObject = null;
    },
  };
};
