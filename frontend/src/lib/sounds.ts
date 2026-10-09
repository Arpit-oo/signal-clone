export type RingTone = "incoming" | "outgoing";
type Sound = RingTone | "message";

interface Note {
  at: number;
  duration: number;
  frequencies: number[];
}

// Original, softly enveloped tones. Audio-clock loops keep ringing even when
// browsers throttle JavaScript timers in background tabs; no remote assets.
const patterns: Record<Sound, { duration: number; notes: Note[] }> = {
  incoming: {
    duration: 3,
    notes: [
      { at: 0, duration: 0.2, frequencies: [659.25] },
      { at: 0.27, duration: 0.24, frequencies: [880] },
      { at: 0.64, duration: 0.2, frequencies: [659.25] },
      { at: 0.91, duration: 0.32, frequencies: [880] },
    ],
  },
  outgoing: {
    duration: 4,
    notes: [{ at: 0, duration: 1.4, frequencies: [440, 480] }],
  },
  message: {
    duration: 0.4,
    notes: [
      { at: 0, duration: 0.13, frequencies: [1046.5] },
      { at: 0.1, duration: 0.25, frequencies: [1318.5] },
    ],
  },
};

function toneBuffer(context: AudioContext, sound: Sound) {
  const pattern = patterns[sound];
  const buffer = context.createBuffer(
    1,
    Math.ceil(context.sampleRate * pattern.duration),
    context.sampleRate,
  );
  const samples = buffer.getChannelData(0);
  for (const note of pattern.notes) {
    const length = Math.floor(note.duration * context.sampleRate);
    const offset = Math.floor(note.at * context.sampleRate);
    for (let i = 0; i < length; i++) {
      const time = i / context.sampleRate;
      const fade = Math.min(1, time / 0.012, (note.duration - time) / 0.035);
      const wave =
        note.frequencies.reduce(
          (sum, frequency) => sum + Math.sin(2 * Math.PI * frequency * time),
          0,
        ) / note.frequencies.length;
      samples[offset + i] += wave * fade * 0.18;
    }
  }
  return buffer;
}

function browserContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Constructor =
    window.AudioContext ??
    (window as Window & { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  return Constructor ? new Constructor() : null;
}

export class SoundPlayer {
  private context: AudioContext | null = null;
  private buffers = new Map<Sound, AudioBuffer>();
  private requestedRing: RingTone | null = null;
  private ringSource: AudioBufferSourceNode | null = null;
  private messages = new Set<AudioBufferSourceNode>();
  private listeners = new Set<() => void>();
  private resuming: Promise<boolean> | null = null;
  private lastChime = -Infinity;
  private messageGeneration = 0;

  constructor(
    private createContext: () => AudioContext | null = browserContext,
  ) {}

  ready = () => this.context?.state === "running";
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private notify() {
    this.listeners.forEach((listener) => listener());
  }

  // Call only from user interaction. Incoming events never create/resume an
  // audio context or queue message chimes that might play much later.
  unlock(): Promise<boolean> {
    try {
      if (!this.context || this.context.state === "closed") {
        if (this.context) {
          this.stopSource(this.ringSource);
          this.ringSource = null;
          this.stopMessages();
          this.context.onstatechange = null;
        }
        this.context = this.createContext();
        this.buffers.clear();
        if (!this.context) return Promise.resolve(false);
        this.context.onstatechange = () => {
          this.syncRing();
          this.notify();
        };
      }
      const context = this.context;
      if (context.state === "running") {
        this.syncRing();
        this.notify();
        return Promise.resolve(true);
      }
      if (this.resuming) return this.resuming;
      const attempt = context
        .resume()
        .then(() => {
          if (this.context !== context) return false;
          this.syncRing();
          this.notify();
          return this.ready();
        })
        .catch(() => false)
        .finally(() => {
          if (this.resuming === attempt) this.resuming = null;
        });
      this.resuming = attempt;
      return attempt;
    } catch {
      return Promise.resolve(false);
    }
  }

  setRing(tone: RingTone | null) {
    if (this.requestedRing === tone && this.ringSource) return;
    this.requestedRing = tone;
    this.stopSource(this.ringSource);
    this.ringSource = null;
    this.syncRing();
  }

  private syncRing() {
    if (this.requestedRing && !this.ringSource && this.ready()) {
      this.ringSource = this.play(this.requestedRing, true);
    }
  }

  private play(sound: Sound, loop = false): AudioBufferSourceNode | null {
    const context = this.context;
    if (!context || !this.ready()) return null;
    let source: AudioBufferSourceNode | null = null;
    try {
      let buffer = this.buffers.get(sound);
      if (!buffer) {
        buffer = toneBuffer(context, sound);
        this.buffers.set(sound, buffer);
      }
      source = context.createBufferSource();
      source.buffer = buffer;
      source.loop = loop;
      source.connect(context.destination);
      source.start();
      return source;
    } catch {
      this.stopSource(source);
      return null;
    }
  }

  playMessage() {
    if (
      !this.ready() ||
      this.requestedRing ||
      Date.now() - this.lastChime < 800
    )
      return;
    const source = this.play("message");
    if (!source) return;
    this.lastChime = Date.now();
    this.messages.add(source);
    source.onended = () => {
      this.messages.delete(source);
      source.disconnect();
    };
  }

  async previewMessage() {
    const unlocking = this.unlock();
    const generation = this.messageGeneration;
    if ((await unlocking) && generation === this.messageGeneration) {
      this.lastChime = -Infinity;
      this.playMessage();
    }
  }

  private stopSource(source: AudioBufferSourceNode | null) {
    if (!source) return;
    source.onended = null;
    try {
      source.stop();
    } catch {
      /* Already ended or unavailable. */
    }
    source.disconnect();
  }

  stopMessages() {
    this.messageGeneration += 1;
    this.messages.forEach((source) => this.stopSource(source));
    this.messages.clear();
  }

  dispose() {
    this.setRing(null);
    this.stopMessages();
    const context = this.context;
    this.context = null;
    this.resuming = null;
    this.buffers.clear();
    this.lastChime = -Infinity;
    if (context) {
      context.onstatechange = null;
      void context.close().catch(() => undefined);
    }
    this.notify();
  }
}

export const sounds = new SoundPlayer();
