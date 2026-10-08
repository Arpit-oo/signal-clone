import { defineConfig, devices } from "@playwright/test";
import { mkdirSync, mkdtempSync } from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "..");
const runtime = path.join(root, ".runtime");
mkdirSync(runtime, { recursive: true });
const dataDir = mkdtempSync(path.join(runtime, "e2e-"));
const backend = path.join(root, "backend");
const python = path.join(backend, ".venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
process.env.PLAYWRIGHT_BROWSERS_PATH ??= path.join(root, ".cache", "playwright");

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: "list",
  use: { baseURL: "http://127.0.0.1:3001", trace: "retain-on-failure", screenshot: "only-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: `"${python}" -m uvicorn app.main:app --app-dir "${backend}" --host 127.0.0.1 --port 8001 --no-access-log`,
      url: "http://127.0.0.1:8001/health",
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        DATABASE_URL: `sqlite+aiosqlite:///${path.join(dataDir, "signal.db").replaceAll("\\", "/")}`,
        UPLOAD_DIR: path.join(dataDir, "uploads"),
        JWT_SECRET: "isolated-browser-tests-secret-0123456789",
        AUTO_MIGRATE_ON_STARTUP: "true",
        SEED_ON_STARTUP: "true",
      },
    },
    {
      command: "npm run dev -- --hostname 127.0.0.1 --port 3001",
      url: "http://127.0.0.1:3001/login",
      reuseExistingServer: false,
      timeout: 120_000,
      env: { API_ORIGIN: "http://127.0.0.1:8001", NEXT_PUBLIC_WS_URL: "ws://127.0.0.1:8001", NEXT_DIST_DIR: ".next-e2e" },
    },
  ],
});
