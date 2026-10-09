import { create } from "zustand";
import { toast } from "sonner";
import { socket } from "@/lib/ws";
import type { Conversation, ServerEvent, User } from "@/lib/types";

export type CallKind = "voice" | "video";
interface CallUI {
  id: string;
  conversationId: number;
  kind: CallKind;
  peer: User;
  incoming: boolean;
  phase: "preparing" | "incoming" | "ringing" | "connecting" | "connected";
  offer?: RTCSessionDescriptionInit;
}
interface CallState {
  call: CallUI | null;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  muted: boolean;
  cameraOff: boolean;
  startedAt: number | null;
  start: (conversation: Conversation, kind: CallKind) => Promise<void>;
  accept: () => Promise<void>;
  end: (reason?: string) => void;
  toggleMute: () => void;
  toggleCamera: () => void;
}

let peerConnection: RTCPeerConnection | null = null;
let localCandidates: RTCIceCandidateInit[] = [];
let remoteCandidates: RTCIceCandidateInit[] = [];
let canSignal = false;
let disconnectTimer: ReturnType<typeof setTimeout> | null = null;
let connectionTimer: ReturnType<typeof setTimeout> | null = null;
let eventQueue = Promise.resolve();
let eventGeneration = 0;

const initial = {
  call: null,
  localStream: null,
  remoteStream: null,
  muted: false,
  cameraOff: false,
  startedAt: null,
};
function current(id: string) {
  return useCall.getState().call?.id === id;
}

function cleanup() {
  if (disconnectTimer) clearTimeout(disconnectTimer);
  if (connectionTimer) clearTimeout(connectionTimer);
  disconnectTimer = connectionTimer = null;
  if (peerConnection) {
    peerConnection.onconnectionstatechange = null;
    peerConnection.onicecandidate = null;
    peerConnection.ontrack = null;
    peerConnection.close();
    peerConnection = null;
  }
  useCall
    .getState()
    .localStream?.getTracks()
    .forEach((track) => track.stop());
  useCall
    .getState()
    .remoteStream?.getTracks()
    .forEach((track) => track.stop());
  localCandidates = [];
  remoteCandidates = [];
  canSignal = false;
  useCall.setState(initial);
}

function signal(id: string, data: Record<string, unknown>) {
  return socket.send("call.signal", { call_id: id, ...data });
}
function flushLocal(id: string) {
  if (!canSignal || !current(id)) return;
  for (const candidate of localCandidates.splice(0)) signal(id, { candidate });
}
async function flushRemote(pc: RTCPeerConnection, id: string) {
  // An old accept can finish after hang-up while the next call is gathering ICE.
  // Check ownership before consuming the queue shared by the active call.
  if (!current(id) || peerConnection !== pc || !pc.remoteDescription) return;
  for (const candidate of remoteCandidates.splice(0)) {
    if (!current(id)) return;
    await pc.addIceCandidate(candidate);
  }
}

function iceServers(): RTCIceServer[] {
  // Supply a JSON array with TURN credentials for connections across restrictive networks.
  try {
    return JSON.parse(
      process.env.NEXT_PUBLIC_RTC_ICE_SERVERS || "[]",
    ) as RTCIceServer[];
  } catch {
    return [];
  }
}

async function prepare(call: CallUI) {
  if (
    !navigator.mediaDevices?.getUserMedia ||
    typeof RTCPeerConnection === "undefined"
  )
    throw new Error(
      "Calling needs a browser with microphone access. Open the app on localhost or HTTPS.",
    );
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true },
    video:
      call.kind === "video"
        ? { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } }
        : false,
  });
  // Permission prompts may resolve after the other person hangs up.
  if (!current(call.id)) {
    stream.getTracks().forEach((track) => track.stop());
    return null;
  }
  useCall.setState({ localStream: stream });
  const pc = new RTCPeerConnection({ iceServers: iceServers() });
  peerConnection = pc;
  stream.getTracks().forEach((track) => pc.addTrack(track, stream));
  pc.onicecandidate = (event) => {
    if (!event.candidate || !current(call.id)) return;
    localCandidates.push(event.candidate.toJSON());
    flushLocal(call.id);
  };
  pc.ontrack = (event) => {
    if (!current(call.id)) return;
    const remote = useCall.getState().remoteStream ?? new MediaStream();
    if (!remote.getTracks().some((track) => track.id === event.track.id))
      remote.addTrack(event.track);
    useCall.setState({ remoteStream: new MediaStream(remote.getTracks()) });
  };
  pc.onconnectionstatechange = () => {
    if (!current(call.id)) return;
    if (pc.connectionState === "connected") {
      if (disconnectTimer) clearTimeout(disconnectTimer);
      if (connectionTimer) clearTimeout(connectionTimer);
      disconnectTimer = connectionTimer = null;
      useCall.setState((state) => ({
        call: state.call ? { ...state.call, phase: "connected" } : null,
        startedAt: state.startedAt ?? Date.now(),
      }));
      socket.send("call.connected", { call_id: call.id });
    } else if (pc.connectionState === "failed")
      fail(call.id, new Error("The call couldn't connect. Try again."));
    else if (pc.connectionState === "disconnected" && !disconnectTimer) {
      disconnectTimer = setTimeout(
        () => fail(call.id, new Error("The call connection was lost.")),
        10000,
      );
    }
  };
  return pc;
}

function fail(id: string, error: unknown) {
  if (!current(id)) return;
  let message =
    error instanceof Error ? error.message : "Couldn't start this call.";
  if (error instanceof DOMException) {
    if (error.name === "NotAllowedError")
      message =
        "Allow microphone and camera access in your browser to make calls.";
    else if (error.name === "NotFoundError")
      message =
        "No microphone or camera was found. Connect a device and try again.";
    else if (error.name === "NotReadableError")
      message =
        "Your microphone or camera is in use. Close the other app and try again.";
  }
  useCall.getState().end("media_error");
  toast.error(message);
}

function waitForConnection(id: string) {
  connectionTimer = setTimeout(() => {
    if (current(id) && useCall.getState().call?.phase !== "connected") {
      useCall.getState().end("connection_failed");
      toast.error("The call couldn't connect. Please try again.");
    }
  }, 35000);
}

export const useCall = create<CallState>()((set, get) => ({
  ...initial,
  start: async (conversation, kind) => {
    if (get().call) {
      toast.info("Finish your current call first.");
      return;
    }
    if (conversation.type !== "direct" || !conversation.peer) {
      toast.info("Calls are available in one-to-one chats.");
      return;
    }
    if (conversation.peer.is_blocked) {
      toast.error("Unblock this person to call them.");
      return;
    }
    if (socket.status !== "open") {
      toast.error("Reconnect before starting a call.");
      return;
    }
    const call: CallUI = {
      id: crypto.randomUUID(),
      conversationId: conversation.id,
      peer: conversation.peer,
      kind,
      incoming: false,
      phase: "preparing",
    };
    set({ ...initial, call });
    try {
      const pc = await prepare(call);
      if (!pc || !current(call.id)) return;
      await pc.setLocalDescription(await pc.createOffer());
      if (!current(call.id)) return;
      set({ call: { ...call, phase: "ringing" } });
      if (
        !socket.send("call.invite", {
          call_id: call.id,
          conversation_id: call.conversationId,
          kind,
          offer: pc.localDescription?.toJSON(),
        })
      )
        throw new Error("Connection lost. Try again.");
    } catch (error) {
      fail(call.id, error);
    }
  },
  accept: async () => {
    const call = get().call;
    if (!call || call.phase !== "incoming") return;
    set({ call: { ...call, phase: "connecting" } });
    if (!socket.send("call.accept", { call_id: call.id })) {
      fail(call.id, new Error("Connection lost. Try again."));
      return;
    }
    waitForConnection(call.id);
    try {
      const pc = await prepare(call);
      if (!pc || !call.offer || !current(call.id)) return;
      await pc.setRemoteDescription(call.offer);
      await flushRemote(pc, call.id);
      if (!current(call.id)) return;
      await pc.setLocalDescription(await pc.createAnswer());
      if (!current(call.id)) return;
      signal(call.id, { description: pc.localDescription?.toJSON() });
      canSignal = true;
      flushLocal(call.id);
    } catch (error) {
      fail(call.id, error);
    }
  },
  end: (reason = "hangup") => {
    const call = get().call;
    if (call) socket.send("call.end", { call_id: call.id, reason });
    cleanup();
  },
  toggleMute: () => {
    const muted = !get().muted;
    get()
      .localStream?.getAudioTracks()
      .forEach((track) => {
        track.enabled = !muted;
      });
    set({ muted });
  },
  toggleCamera: () => {
    const cameraOff = !get().cameraOff;
    get()
      .localStream?.getVideoTracks()
      .forEach((track) => {
        track.enabled = !cameraOff;
      });
    set({ cameraOff });
  },
}));

async function receive(event: ServerEvent) {
  if (event.type === "call.incoming") {
    const existing = useCall.getState().call;
    if (existing) {
      // A local permission prompt can overlap a remote invitation before the
      // server knows this tab is busy. Decline that invitation explicitly.
      if (existing.id !== event.data.call_id) socket.send("call.end", { call_id: event.data.call_id, reason: "declined" });
      return;
    }
    cleanup();
    useCall.setState({
      call: {
        id: event.data.call_id,
        conversationId: event.data.conversation_id,
        kind: event.data.kind,
        peer: event.data.caller,
        offer: event.data.offer,
        incoming: true,
        phase: "incoming",
      },
    });
    return;
  }
  const call = useCall.getState().call;
  if (!call) return;
  if (
    event.type === "error" &&
    event.data.event?.startsWith("call.") &&
    event.data.ref.call_id === call.id
  ) {
    // Late cleanup errors (e.g. cancelling a permission prompt) have no active call to affect.
    cleanup();
    return;
  }
  if (
    !event.type.startsWith("call.") ||
    !("call_id" in (event.data ?? {})) ||
    (event.data as { call_id: string }).call_id !== call.id
  )
    return;
  if (event.type === "call.dismissed") {
    cleanup();
    return;
  }
  if (event.type === "call.ended") {
    cleanup();
    const messages: Record<string, string> = {
      declined: "Call declined",
      no_answer: "No answer",
      disconnected: "Call disconnected",
      connection_failed: "The call couldn't connect",
      media_error:
        "The other person couldn't access their microphone or camera",
    };
    if (messages[event.data.reason]) toast.info(messages[event.data.reason]);
  } else if (event.type === "call.accepted" && !call.incoming) {
    useCall.setState({ call: { ...call, phase: "connecting" } });
    canSignal = true;
    flushLocal(call.id);
    waitForConnection(call.id);
  } else if (event.type === "call.signal") {
    try {
      if (event.data.description && peerConnection) {
        const pc = peerConnection;
        await pc.setRemoteDescription(event.data.description);
        await flushRemote(pc, call.id);
      }
      if (!current(call.id)) return;
      if (event.data.candidate) {
        remoteCandidates.push(event.data.candidate);
        if (peerConnection) await flushRemote(peerConnection, call.id);
      }
    } catch (error) {
      fail(call.id, error);
    }
  }
}

export function handleCallEvent(event: ServerEvent) {
  // Preserve offer/answer/candidate order despite asynchronous browser RTC APIs.
  const generation = eventGeneration;
  eventQueue = eventQueue
    .then(() => (generation === eventGeneration ? receive(event) : undefined))
    .catch(() => undefined);
}
export function disconnectCall() {
  eventGeneration += 1;
  cleanup();
}
