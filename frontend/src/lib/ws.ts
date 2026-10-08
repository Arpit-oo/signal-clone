import type { ServerEvent } from "./types";

type Listener = (event: ServerEvent) => void;
type StatusListener = (status: SocketStatus) => void;
export type SocketStatus = "connecting" | "open" | "closed";

function wsUrl(token: string): string {
  const configured = process.env.NEXT_PUBLIC_WS_URL;
  const base =
    configured ??
    (() => {
      // Local default: the API runs on :8000 next to the Next dev server.
      const { protocol, hostname } = window.location;
      return `${protocol === "https:" ? "wss" : "ws"}://${hostname}:8000`;
    })();
  return `${base.replace(/\/$/, "")}/ws?token=${encodeURIComponent(token)}`;
}

/**
 * One WebSocket per tab with automatic reconnect (exponential backoff with jitter) and a
 * heartbeat so dead connections are noticed quickly.
 */
class SocketClient {
  private ws: WebSocket | null = null;
  private token: string | null = null;
  private listeners = new Set<Listener>();
  private statusListeners = new Set<StatusListener>();
  private retry = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private lastPong = 0;
  status: SocketStatus = "closed";

  connect(token: string) {
    if (this.token === token && this.ws && this.ws.readyState <= WebSocket.OPEN) return;
    this.disconnect();
    this.token = token;
    this.open();
  }

  disconnect() {
    this.token = null;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.reconnectTimer = null;
    this.heartbeat = null;
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.close();
      this.ws = null;
    }
    this.setStatus("closed");
  }

  /** Returns false if the socket isn't open; callers decide whether to queue. */
  send(type: string, data: unknown): boolean {
    if (this.ws?.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify({ type, data }));
    return true;
  }

  subscribe(listener: Listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  onStatus(listener: StatusListener) {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  /** Reconnect right away (e.g. when the browser comes back online). */
  kick() {
    if (!this.token || this.status === "open") return;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.retry = 0;
    this.open();
  }

  private setStatus(status: SocketStatus) {
    this.status = status;
    this.statusListeners.forEach((l) => l(status));
  }

  private open() {
    if (!this.token) return;
    this.setStatus("connecting");
    const ws = new WebSocket(wsUrl(this.token));
    this.ws = ws;

    ws.onopen = () => {
      this.retry = 0;
      this.lastPong = Date.now();
      this.setStatus("open");
      this.heartbeat = setInterval(() => {
        if (Date.now() - this.lastPong > 45_000) {
          ws.close(); // no pong for a while: assume the connection is dead
          return;
        }
        this.send("ping", null);
      }, 20_000);
    };

    ws.onmessage = (e) => {
      let event: ServerEvent;
      try {
        event = JSON.parse(e.data);
      } catch {
        return;
      }
      if (event.type === "pong") {
        this.lastPong = Date.now();
        return;
      }
      this.listeners.forEach((l) => l(event));
    };

    ws.onclose = (e) => {
      if (this.heartbeat) clearInterval(this.heartbeat);
      this.heartbeat = null;
      this.ws = null;
      this.setStatus("closed");
      if (e.code === 1008 || !this.token) return; // auth rejected or logged out
      const delay = Math.min(30_000, 500 * 2 ** this.retry) * (0.75 + Math.random() * 0.5);
      this.retry += 1;
      this.reconnectTimer = setTimeout(() => this.open(), delay);
    };
  }
}

export const socket = new SocketClient();
