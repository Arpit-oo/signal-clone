import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api, ApiError, getToken, setToken } from "@/lib/api";
import { useSession } from "@/stores/session";

vi.mock("@/lib/ws", () => ({ socket: { connect: vi.fn(), disconnect: vi.fn() } }));

beforeEach(() => {
  const storage = new Map<string, string>();
  vi.stubGlobal("window", {});
  vi.stubGlobal("localStorage", { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) });
  useSession.setState(useSession.getInitialState(), true);
  setToken("saved-session");
});
afterEach(() => { setToken(null); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("preserves a saved login during a temporary backend outage", async () => {
  vi.spyOn(api.me, "get").mockRejectedValueOnce(new ApiError(0, "Offline"));
  await useSession.getState().restore();
  expect(getToken()).toBe("saved-session");
  expect(useSession.getState().status).toBe("unavailable");
  expect(useSession.getState().error).toBe("Offline");
});

it("clears an expired token and returns to anonymous login", async () => {
  vi.spyOn(api.me, "get").mockRejectedValueOnce(new ApiError(401, "Expired"));
  await useSession.getState().restore();
  expect(getToken()).toBeNull();
  expect(useSession.getState().status).toBe("anonymous");
});

it("can keep the current token when browser storage is unavailable", () => {
  vi.stubGlobal("localStorage", { getItem: () => { throw new Error("Storage disabled"); }, setItem: () => { throw new Error("Storage disabled"); }, removeItem: () => { throw new Error("Storage disabled"); } });
  setToken("memory-session");
  expect(getToken()).toBe("memory-session");
});
