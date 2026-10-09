import { afterEach, expect, it, vi } from "vitest";
import { SoundPlayer } from "@/lib/sounds";

function audioContext(state = "running") {
  const sources: Array<{
    buffer: AudioBuffer | null;
    loop: boolean;
    start: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
    onended: (() => void) | null;
  }> = [];
  const context = {
    state,
    sampleRate: 8000,
    destination: {},
    onstatechange: null,
    createBuffer: (_channels: number, length: number) => {
      const data = new Float32Array(length);
      return { length, getChannelData: () => data };
    },
    createBufferSource: () => {
      const source = {
        buffer: null,
        loop: false,
        start: vi.fn(),
        stop: vi.fn(),
        connect: vi.fn(),
        disconnect: vi.fn(),
        onended: null,
      };
      sources.push(source);
      return source;
    },
    resume: vi.fn(async () => {
      context.state = "running";
    }),
    close: vi.fn(async () => {
      context.state = "closed";
    }),
  };
  return {
    context,
    sources,
    player: new SoundPlayer(() => context as unknown as AudioContext),
  };
}

afterEach(() => {
  vi.useRealTimers();
});

it("defers incoming ringtone until user interaction unlocks audio", async () => {
  const { player, sources } = audioContext("suspended");
  player.setRing("incoming");
  player.playMessage();
  expect(sources).toHaveLength(0);
  await player.unlock();
  expect(sources).toHaveLength(1);
  expect(sources[0].loop).toBe(true);
  expect(
    sources[0]
      .buffer!.getChannelData(0)
      .some((sample) => Math.abs(sample) > 0.01),
  ).toBe(true);
  player.setRing(null);
  expect(sources[0].stop).toHaveBeenCalledOnce();
  expect(sources[0].disconnect).toHaveBeenCalledOnce();
});

it("does not restart a cancelled ringtone when audio permission resumes late", async () => {
  const { context, player, sources } = audioContext("suspended");
  let finish!: () => void;
  context.resume.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  player.setRing("incoming");
  const unlocking = player.unlock();
  player.setRing(null);
  context.state = "running";
  finish();
  await unlocking;
  expect(sources).toHaveLength(0);
});

it("switches ring patterns once and silences them on acceptance or teardown", async () => {
  const { player, context, sources } = audioContext();
  await player.unlock();
  player.setRing("outgoing");
  player.setRing("outgoing");
  expect(sources).toHaveLength(1);
  player.setRing("incoming");
  expect(sources[0].stop).toHaveBeenCalledOnce();
  expect(sources[1].buffer!.length).not.toBe(sources[0].buffer!.length);
  player.setRing(null);
  expect(sources[1].stop).toHaveBeenCalledOnce();
  player.dispose();
  expect(context.close).toHaveBeenCalledOnce();
  expect(player.ready()).toBe(false);
});

it("coalesces message bursts and never queues locked notification chimes", async () => {
  vi.useFakeTimers();
  const { player, sources } = audioContext();
  player.playMessage();
  await player.unlock();
  expect(sources).toHaveLength(0);
  player.playMessage();
  player.playMessage();
  expect(sources).toHaveLength(1);
  expect(sources[0].loop).toBe(false);
  vi.advanceTimersByTime(801);
  player.playMessage();
  expect(sources).toHaveLength(2);
  player.stopMessages();
  expect(sources.every((source) => source.stop.mock.calls.length === 1)).toBe(
    true,
  );
});

it("keeps chimes quiet during ringing and allows an explicit user preview", async () => {
  const { player, sources } = audioContext();
  await player.unlock();
  player.setRing("outgoing");
  player.playMessage();
  expect(sources).toHaveLength(1);
  player.setRing(null);
  await player.previewMessage();
  expect(sources).toHaveLength(2);
  expect(sources[1].loop).toBe(false);
});

it("cancels a pending preview when sounds are disabled or the session ends", async () => {
  const { context, player, sources } = audioContext("suspended");
  let finish!: () => void;
  context.resume.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const preview = player.previewMessage();
  player.stopMessages();
  context.state = "running";
  finish();
  await preview;
  expect(sources).toHaveLength(0);
});

it("handles unsupported audio and rejected autoplay without affecting calling", async () => {
  const unsupported = new SoundPlayer(() => null);
  unsupported.setRing("incoming");
  expect(await unsupported.unlock()).toBe(false);
  const { player, context, sources } = audioContext("suspended");
  context.resume.mockRejectedValue(
    new DOMException("Blocked", "NotAllowedError"),
  );
  player.setRing("incoming");
  expect(await player.unlock()).toBe(false);
  expect(sources).toHaveLength(0);
});

it("does not play sounds after disposal resolves a previous resume", async () => {
  const { player, context, sources } = audioContext("suspended");
  let finish!: () => void;
  context.resume.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  player.setRing("incoming");
  const unlocking = player.unlock();
  player.dispose();
  finish();
  expect(await unlocking).toBe(false);
  expect(sources).toHaveLength(0);
});
