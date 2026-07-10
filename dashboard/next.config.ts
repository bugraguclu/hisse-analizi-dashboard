import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Optional same-origin proxy: lets the app call /api/* instead of a
  // cross-origin backend URL (useful behind a single reverse proxy).
  // Client code uses API_BASE from src/lib/api.ts; this stays as a
  // deployment fallback.
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"}/:path*`,
      },
    ];
  },
};

export default nextConfig;
