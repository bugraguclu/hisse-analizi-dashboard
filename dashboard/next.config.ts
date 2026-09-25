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
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
