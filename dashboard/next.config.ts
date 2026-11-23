import { readFileSync } from "node:fs";
import path from "node:path";
import type { NextConfig } from "next";

const isProduction = process.env.NODE_ENV === "production";

/** Origin of a separately hosted API, only when the browser calls it directly (NEXT_PUBLIC_API_URL). */
function directApiOrigin(): string | null {
  const configured = process.env.NEXT_PUBLIC_API_URL?.trim();
  if (!configured) return null;
  try {
    return new URL(configured).origin;
  } catch {
    return null;
  }
}

function contentSecurityPolicy(): string {
  const directives: Record<string, Array<string | null>> = {
    "default-src": ["'self'"],
    // Next.js inlines its bootstrap/RSC payload scripts and next-themes adds a
    // pre-paint theme script; nonces would need middleware, so inline scripts
    // are allowed. React Refresh needs eval, but only in development.
    "script-src": ["'self'", "'unsafe-inline'", isProduction ? null : "'unsafe-eval'"],
    // Tailwind, next/font and Recharts/framer-motion set inline styles.
    "style-src": ["'self'", "'unsafe-inline'"],
    // No external images are used (logos are rendered as text); data:/blob: for charts/icons.
    "img-src": ["'self'", "data:", "blob:"],
    "font-src": ["'self'", "data:"],
    // All data goes through the same-origin /api proxy; dev HMR uses a websocket.
    "connect-src": ["'self'", directApiOrigin(), isProduction ? null : "ws:", isProduction ? null : "wss:"],
    "worker-src": ["'self'", "blob:"],
    "manifest-src": ["'self'"],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
    "frame-ancestors": ["'none'"],
  };
  return Object.entries(directives)
    .map(([name, sources]) => `${name} ${sources.filter(Boolean).join(" ")}`)
    .join("; ");
}

const securityHeaders = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy() },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  // Browsers ignore HSTS on plain-HTTP responses; only send it from production builds.
  ...(isProduction ? [{ key: "Strict-Transport-Security", value: "max-age=31536000" }] : []),
];

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  reactStrictMode: true,
  // Defined (empty) so the static-demo branches (src/lib/demo.ts) compile to dead code
  // and are dropped; an undefined NEXT_PUBLIC_ variable would be looked up at runtime instead.
  env: { NEXT_PUBLIC_DEMO: "" },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
      {
        // The service worker must never be served from an HTTP cache, or a deployment
        // would not reach open tabs (Caddy sets the same headers in production).
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
      {
        source: "/icons/:file*",
        headers: [{ key: "Cache-Control", value: "public, max-age=86400" }],
      },
    ];
  },
};

/**
 * Static demo (`npm run build:demo`, see src/lib/demo.ts): a static export for
 * GitHub Pages under NEXT_PUBLIC_BASE_PATH whose API calls are answered from the
 * responses recorded in demo/data. Static hosting sends no custom headers and
 * runs no route handlers, so the headers and the /api proxy and sitemap (the
 * only *.ts route files) are left out.
 */
function staticDemoConfig(): NextConfig {
  const basePath = (process.env.NEXT_PUBLIC_BASE_PATH ?? "").replace(/\/$/, "");
  if (basePath && !basePath.startsWith("/")) throw new Error(`NEXT_PUBLIC_BASE_PATH must start with "/": ${basePath}`);
  const manifest = JSON.parse(readFileSync(path.join(process.cwd(), "demo/data/manifest.json"), "utf8")) as {
    capturedAt: string;
    tickers: string[];
  };
  return {
    output: "export",
    basePath: basePath || undefined,
    trailingSlash: true,
    pageExtensions: ["tsx"],
    poweredByHeader: false,
    reactStrictMode: true,
    env: {
      NEXT_PUBLIC_DEMO: "1",
      NEXT_PUBLIC_BASE_PATH: basePath,
      NEXT_PUBLIC_DEMO_CAPTURED_AT: manifest.capturedAt,
      NEXT_PUBLIC_DEMO_TICKERS: manifest.tickers.join(","),
    },
  };
}

export default process.env.NEXT_PUBLIC_DEMO === "1" ? staticDemoConfig() : nextConfig;
