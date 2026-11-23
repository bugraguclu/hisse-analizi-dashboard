import { readFileSync } from "node:fs";
import path from "node:path";
import { serviceWorkerScript } from "@/lib/pwa/service-worker";

/**
 * `/sw.js`: the service worker, versioned with the running build's id so every
 * deployment changes its bytes (the browser's update check sees a new version).
 * Served with `no-cache` and an explicit root scope; Caddy repeats both headers.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

let cachedVersion: string | null = null;

function buildVersion(): string {
  if (cachedVersion) return cachedVersion;
  try {
    // `next start` and the standalone server both run from the app root.
    cachedVersion = readFileSync(path.join(process.cwd(), ".next", "BUILD_ID"), "utf8").trim();
  } catch {
    cachedVersion = "dev";
  }
  return cachedVersion;
}

export function GET(): Response {
  return new Response(serviceWorkerScript(buildVersion()), {
    headers: {
      "content-type": "application/javascript; charset=utf-8",
      "cache-control": "no-cache, no-store, must-revalidate",
      "service-worker-allowed": "/",
    },
  });
}
