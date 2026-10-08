import type { NextConfig } from "next";

const API_ORIGIN = process.env.API_ORIGIN ?? "http://127.0.0.1:8000";

const nextConfig: NextConfig = {
  devIndicators: false,
  output: process.env.NEXT_STANDALONE === "true" ? "standalone" : undefined,
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  // REST and media go through the Next server, so the browser only talks to one origin.
  // The WebSocket connects to the API directly (NEXT_PUBLIC_WS_URL).
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${API_ORIGIN}/api/:path*` }];
  },
};

export default nextConfig;
