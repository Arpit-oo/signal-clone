import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useCall, handleCallEvent, disconnectCall } from "@/stores/call";
import type { Conversation } from "@/lib/types";
import { socket } from "@/lib/ws";

vi.mock("@/lib/ws", () => ({
  socket: { status: "open", send: vi.fn(() => true) },
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), info: vi.fn() } }));
const conversation = {
  id: 1,
  type: "direct",
  peer: { id: 2, display_name: "Priya", is_blocked: false },
} as Conversation;
beforeEach(() => {
  vi.clearAllMocks();
  disconnectCall();
});
afterEach(() => {
  disconnectCall();
  vi.unstubAllGlobals();
});

it("drops queued incoming events after the session disconnects", async () => {
  handleCallEvent({ type: "call.incoming", data: { call_id: "late", conversation_id: 1, kind: "voice", caller: conversation.peer!, offer: { type: "offer", sdp: "test" } } });
  disconnectCall();
  await Promise.resolve(); await Promise.resolve();
  expect(useCall.getState().call).toBeNull();
});

it("stops a microphone granted after the user has already cancelled", async () => {
  let resolve!: (stream: MediaStream) => void;
  const permission = new Promise<MediaStream>((done) => {
    resolve = done;
  });
  vi.stubGlobal("navigator", {
    mediaDevices: { getUserMedia: () => permission },
  });
  vi.stubGlobal("RTCPeerConnection", vi.fn());
  const stop = vi.fn();
  const starting = useCall.getState().start(conversation, "voice");
  expect(useCall.getState().call?.phase).toBe("preparing");
  useCall.getState().end();
  resolve({ getTracks: () => [{ stop }] } as unknown as MediaStream);
  await starting;
  expect(stop).toHaveBeenCalledOnce();
  expect(useCall.getState().call).toBeNull();
  expect(socket.send).not.toHaveBeenCalledWith(
    "call.invite",
    expect.anything(),
  );
});

it("cleans up a denied microphone instead of leaving a ringing call", async () => {
  vi.stubGlobal("navigator", {
    mediaDevices: {
      getUserMedia: vi
        .fn()
        .mockRejectedValue(new DOMException("Denied", "NotAllowedError")),
    },
  });
  vi.stubGlobal("RTCPeerConnection", vi.fn());
  await useCall.getState().start(conversation, "voice");
  expect(useCall.getState().call).toBeNull();
  expect(socket.send).not.toHaveBeenCalledWith(
    "call.invite",
    expect.anything(),
  );
});

it("ignores an old call's end notification when a different call is ringing", async () => {
  useCall.setState({
    call: {
      id: "current",
      conversationId: 1,
      kind: "voice",
      peer: conversation.peer!,
      incoming: true,
      phase: "incoming",
    },
  });
  handleCallEvent({
    type: "call.ended",
    data: { call_id: "old", reason: "hangup" },
  });
  await vi.waitFor(() => expect(useCall.getState().call?.id).toBe("current"));
  await Promise.resolve();
  await Promise.resolve();
  expect(useCall.getState().call?.id).toBe("current");
});

it("keeps a new call's ICE candidates when an old accept finishes late", async () => {
  let finishOldDescription!: () => void;
  const oldDescription = new Promise<void>((resolve) => {
    finishOldDescription = resolve;
  });
  const peers: TestPeer[] = [];
  class TestPeer {
    remoteDescription: RTCSessionDescriptionInit | null = null;
    localDescription = { toJSON: () => ({ type: "offer", sdp: "new offer" }) };
    addTrack = vi.fn();
    close = vi.fn();
    addIceCandidate = vi.fn().mockResolvedValue(undefined);
    createOffer = vi.fn().mockResolvedValue({ type: "offer", sdp: "new offer" });
    createAnswer = vi.fn().mockResolvedValue({ type: "answer", sdp: "old answer" });
    setLocalDescription = vi.fn().mockResolvedValue(undefined);
    setRemoteDescription = vi.fn(async (description: RTCSessionDescriptionInit) => {
      if (this === peers[0]) await oldDescription;
      this.remoteDescription = description;
    });
    constructor() { peers.push(this); }
  }
  vi.stubGlobal("RTCPeerConnection", TestPeer);
  vi.stubGlobal("navigator", {
    mediaDevices: {
      getUserMedia: async () => ({ getTracks: () => [{ stop: vi.fn() }] }),
    },
  });
  useCall.setState({
    call: {
      id: "old",
      conversationId: 1,
      kind: "voice",
      peer: conversation.peer!,
      incoming: true,
      phase: "incoming",
      offer: { type: "offer", sdp: "old offer" },
    },
  });
  const accepting = useCall.getState().accept();
  await vi.waitFor(() => expect(peers[0]?.setRemoteDescription).toHaveBeenCalled());
  useCall.getState().end();
  await useCall.getState().start(conversation, "voice");
  const newId = useCall.getState().call!.id;
  const candidate = { candidate: "candidate:new-call", sdpMid: "0" };
  handleCallEvent({ type: "call.signal", data: { call_id: newId, candidate } });
  await new Promise((resolve) => setTimeout(resolve, 0));
  finishOldDescription();
  await accepting;
  handleCallEvent({
    type: "call.signal",
    data: { call_id: newId, description: { type: "answer", sdp: "new answer" } },
  });
  await vi.waitFor(() => expect(peers[1].addIceCandidate).toHaveBeenCalledWith(candidate));
  expect(useCall.getState().call?.id).toBe(newId);
});
