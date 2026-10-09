"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useCall } from "@/stores/call";
import { usePrefs } from "@/stores/prefs";
import { sounds } from "@/lib/sounds";
import { Avatar, Button, Icon, Modal } from "@/components/ui";
import "./calls.css";

function CallMedia({
  stream,
  local,
  video,
}: {
  stream: MediaStream | null;
  local?: boolean;
  video: boolean;
}) {
  const ref = useRef<HTMLVideoElement & HTMLAudioElement>(null);
  const [blocked, setBlocked] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    let active = true;
    element.srcObject = stream;
    if (stream)
      void element
        .play()
        .then(() => {
          if (active) setBlocked(false);
        })
        .catch((error: unknown) => {
          if (
            active &&
            !local &&
            error instanceof DOMException &&
            error.name === "NotAllowedError"
          )
            setBlocked(true);
        });
    return () => {
      active = false;
      element.srcObject = null;
    };
  }, [stream, local]);
  return (
    <>
      {video ? (
        <video
          ref={ref}
          autoPlay
          playsInline
          muted={!!local}
          aria-label={local ? "Your camera" : "Remote video"}
          className={local ? "call-local-video" : "call-remote-video"}
        />
      ) : (
        <audio ref={ref} autoPlay aria-label="Call audio" />
      )}
      {blocked && (
        <Button
          className="call-play-audio"
          onClick={() => {
            void ref.current
              ?.play()
              .then(() => setBlocked(false))
              .catch(() => undefined);
          }}
        >
          Play call audio
        </Button>
      )}
    </>
  );
}

export function CallWindow() {
  const {
    call,
    localStream,
    remoteStream,
    muted,
    cameraOff,
    startedAt,
    accept,
    end,
    toggleMute,
    toggleCamera,
  } = useCall();
  const ringtone = usePrefs((state) => state.callRingtone);
  const soundReady = useSyncExternalStore(
    sounds.subscribe,
    sounds.ready,
    () => false,
  );
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!startedAt) return;
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [startedAt]);
  if (!call) return null;
  const seconds = startedAt
    ? Math.max(0, Math.floor((now - startedAt) / 1000))
    : 0;
  const duration = `${Math.floor(seconds / 60)
    .toString()
    .padStart(2, "0")}:${(seconds % 60).toString().padStart(2, "0")}`;
  const subtitle =
    call.phase === "connected"
      ? duration
      : call.phase === "incoming"
        ? `Incoming ${call.kind} call`
        : call.phase === "preparing"
          ? "Getting ready…"
          : call.phase === "ringing"
            ? "Ringing…"
            : "Connecting…";
  const remoteVideo =
    call.kind === "video" && !!remoteStream && call.phase !== "incoming";
  return (
    <Modal
      title={call.kind === "video" ? "Video call" : "Voice call"}
      className="call-window"
      dismissible={false}
      onClose={() => end()}
    >
      <div className={`call-stage ${remoteVideo ? "with-video" : ""}`}>
        {remoteStream && (
          <CallMedia stream={remoteStream} video={remoteVideo} />
        )}
        <div
          className={`call-person ${call.phase === "ringing" || call.phase === "incoming" ? "is-ringing" : ""}`}
        >
          {!remoteVideo && (
            <Avatar
              name={call.peer.display_name}
              color={call.peer.avatar_color}
              url={call.peer.avatar_url}
              size={96}
            />
          )}
          <h2>{call.peer.nickname || call.peer.display_name}</h2>
          <p
            role="status"
            aria-live="polite"
            aria-label="Call status"
            data-phase={call.phase}
          >
            {subtitle}
          </p>
          {ringtone &&
            !soundReady &&
            (call.phase === "incoming" || call.phase === "ringing") && (
              <Button
                className="call-enable-sound"
                onClick={() => void sounds.unlock()}
              >
                Enable call sound
              </Button>
            )}
        </div>
        {call.kind === "video" && localStream && !cameraOff && (
          <CallMedia stream={localStream} video local />
        )}
        {call.phase === "incoming" ? (
          <div className="call-controls incoming-controls">
            <button
              className="call-control call-hangup"
              onClick={() => end("declined")}
              aria-label="Decline call"
            >
              <Icon name="phone" size={24} />
              <span>Decline</span>
            </button>
            <button
              className="call-control call-accept"
              onClick={() => void accept()}
              aria-label="Accept call"
            >
              <Icon
                name={call.kind === "video" ? "video" : "phone"}
                size={24}
              />
              <span>Accept</span>
            </button>
          </div>
        ) : (
          <div className="call-controls">
            <button
              className={`call-control ${muted ? "is-off" : ""}`}
              disabled={!localStream}
              onClick={toggleMute}
              aria-label={muted ? "Unmute microphone" : "Mute microphone"}
              aria-pressed={muted}
            >
              <Icon name={muted ? "mic-off" : "mic"} size={24} />
              <span>{muted ? "Unmute" : "Mute"}</span>
            </button>
            {call.kind === "video" && (
              <button
                className={`call-control ${cameraOff ? "is-off" : ""}`}
                disabled={!localStream}
                onClick={toggleCamera}
                aria-label={cameraOff ? "Turn camera on" : "Turn camera off"}
                aria-pressed={cameraOff}
              >
                <Icon name={cameraOff ? "video-off" : "video"} size={24} />
                <span>Camera</span>
              </button>
            )}
            <button
              className="call-control call-hangup"
              onClick={() => end()}
              aria-label="Hang up"
            >
              <Icon name="phone" size={24} />
              <span>End call</span>
            </button>
          </div>
        )}
      </div>
    </Modal>
  );
}
