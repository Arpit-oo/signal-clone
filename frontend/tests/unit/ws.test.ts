import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { socket } from "@/lib/ws";

class FakeSocket {
  static OPEN = 1;
  static CONNECTING = 0;
  static instances: FakeSocket[] = [];
  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;
  send = vi.fn();
  constructor(public url: string) { FakeSocket.instances.push(this); }
  open() { this.readyState = 1; this.onopen?.(); }
  close(code = 1000) { this.readyState = 3; this.onclose?.({ code }); }
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("WebSocket", FakeSocket);
  vi.stubGlobal("window", { location: { protocol: "http:", hostname: "127.0.0.1" } });
  FakeSocket.instances = [];
});
afterEach(() => { socket.disconnect(); vi.useRealTimers(); vi.unstubAllGlobals(); });

it("keeps one connection while repeated retry clicks arrive during connecting", () => {
  socket.connect("token");
  socket.kick();
  socket.kick();
  expect(FakeSocket.instances).toHaveLength(1);
  FakeSocket.instances[0].open();
  expect(socket.status).toBe("open");
});

it("removes old callbacks when switching accounts so late events cannot corrupt a new connection", () => {
  socket.connect("old-token");
  const old = FakeSocket.instances[0];
  socket.connect("new-token");
  expect(old.onopen).toBeNull();
  expect(old.onmessage).toBeNull();
  expect(old.onclose).toBeNull();
  FakeSocket.instances[1].open();
  old.close();
  expect(socket.status).toBe("open");
});

it("reconnects after a close but cancels pending retries on sign-out", () => {
  socket.connect("token");
  FakeSocket.instances[0].open();
  FakeSocket.instances[0].close();
  vi.advanceTimersByTime(1000);
  expect(FakeSocket.instances).toHaveLength(2);
  FakeSocket.instances[1].open();
  FakeSocket.instances[1].close();
  socket.disconnect();
  vi.advanceTimersByTime(60_000);
  expect(FakeSocket.instances).toHaveLength(2);
});
