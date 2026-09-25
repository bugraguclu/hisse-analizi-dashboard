import type { NextRequest } from "next/server";
import { clientIpFromForwardedFor, trustedProxyHops } from "@/lib/client-ip";

/**
 * Same-origin proxy: browser → /api/<path> → FastAPI <API_URL>/<path>.
 *
 * - Only an allowlist of request headers is forwarded (no cookies, no
 *   Authorization / X-Admin-Key, no hop-by-hop or Next-internal headers).
 * - X-Forwarded-For is rebuilt as a single entry — the client address picked
 *   with TRUSTED_PROXY_HOPS (see lib/client-ip.ts) — so the backend limiter
 *   only has to trust this server.
 * - Responses are buffered under an upstream timeout and failures become
 *   JSON 502/504 errors with a Turkish `detail`.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ path: string[] }>;
};

/** Mount point of this route (app/api/[...path]). */
const PROXY_PREFIX = "/api";
const UPSTREAM_TIMEOUT_MS = 30_000;
const MAX_BODY_BYTES = 1_000_000;

const FORWARDED_REQUEST_HEADERS = [
  "accept",
  "accept-language",
  "content-type",
  "if-modified-since",
  "if-none-match",
  "user-agent",
];

const DROPPED_RESPONSE_HEADERS = [
  "connection",
  "content-encoding", // fetch() already decompressed the body
  "content-length",
  "date",
  "keep-alive",
  "proxy-authenticate",
  "server",
  "set-cookie",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "x-powered-by",
];

/**
 * Admin-only or personal-data endpoints — and the API docs, which list the admin
 * surface — are not reachable through the public proxy.
 */
const BLOCKED_PATHS: readonly RegExp[] = [
  /^admin(\/|$)/,
  /^notifications(\/|$)/,
  /^outbox(\/|$)/,
  /^(docs|redoc)(\/|$)/,
  /^openapi\.json$/,
];

function jsonError(status: number, detail: string, code: string): Response {
  return Response.json({ detail, code }, { status, headers: { "cache-control": "no-store" } });
}

function getApiBaseUrl(): URL {
  const configured = process.env.API_URL?.trim() || process.env.NEXT_PUBLIC_API_URL?.trim() || "http://localhost:8000";
  const url = new URL(configured);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("API_URL must use the http or https protocol.");
  }
  return url;
}

/**
 * Read the request body, giving up as soon as it exceeds `limit` bytes: a
 * chunked upload has no Content-Length, and request.arrayBuffer() would buffer
 * all of it before the size could be checked. Null when over the limit.
 */
async function readBodyWithin(request: NextRequest, limit: number): Promise<Uint8Array<ArrayBuffer> | null> {
  if (!request.body) return new Uint8Array(0);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

/** Map a backend redirect (absolute backend URL) back onto the proxy path. */
function rewriteLocation(location: string, apiBase: URL): string {
  try {
    const target = new URL(location, apiBase);
    const basePath = apiBase.pathname.replace(/\/$/, "");
    if (target.origin !== apiBase.origin || !target.pathname.startsWith(basePath)) return location;
    return `${PROXY_PREFIX}${target.pathname.slice(basePath.length) || "/"}${target.search}`;
  } catch {
    return location;
  }
}

async function proxyRequest(request: NextRequest, context: RouteContext): Promise<Response> {
  const { path = [] } = await context.params;
  if (path.length === 0 || path.some((segment) => segment === "" || segment === "." || segment === "..")) {
    return jsonError(404, "İstenen kaynak bulunamadı.", "not_found");
  }
  const relativePath = path.join("/");
  if (BLOCKED_PATHS.some((pattern) => pattern.test(relativePath))) {
    return jsonError(404, "İstenen kaynak bulunamadı.", "not_found");
  }

  let apiBase: URL;
  try {
    apiBase = getApiBaseUrl();
  } catch (error) {
    console.error("API proxy misconfigured:", error instanceof Error ? error.message : error);
    return jsonError(502, "Backend servisine şu anda ulaşılamıyor.", "proxy_misconfigured");
  }
  const upstreamUrl = new URL(apiBase);
  upstreamUrl.pathname = `${apiBase.pathname.replace(/\/$/, "")}/${path.map(encodeURIComponent).join("/")}`;
  upstreamUrl.search = request.nextUrl.search;

  const headers = new Headers();
  for (const name of FORWARDED_REQUEST_HEADERS) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  const ip = clientIpFromForwardedFor(request.headers.get("x-forwarded-for"), trustedProxyHops());
  if (ip) headers.set("x-forwarded-for", ip);
  const proto = request.headers.get("x-forwarded-proto") === "https" ? "https" : request.nextUrl.protocol.replace(":", "");
  headers.set("x-forwarded-proto", proto === "https" ? "https" : "http");

  let body: Uint8Array<ArrayBuffer> | undefined;
  if (request.method !== "GET" && request.method !== "HEAD") {
    const declaredTooLarge = Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES;
    const read = declaredTooLarge ? null : await readBodyWithin(request, MAX_BODY_BYTES);
    if (!read) return jsonError(413, "İstek gövdesi çok büyük.", "payload_too_large");
    body = read;
  }

  // One controller cancels the upstream call on timeout *and* on client disconnect.
  const controller = new AbortController();
  const abortFromClient = () => controller.abort();
  request.signal.addEventListener("abort", abortFromClient, { once: true });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, UPSTREAM_TIMEOUT_MS);
  const cleanup = () => {
    clearTimeout(timer);
    request.signal.removeEventListener("abort", abortFromClient);
  };

  const failure = (error: unknown): Response => {
    cleanup();
    if (timedOut) return jsonError(504, "Backend servisi zamanında yanıt vermedi. Lütfen tekrar deneyin.", "upstream_timeout");
    if (request.signal.aborted) return new Response(null, { status: 499 });
    console.error(`API proxy: ${request.method} /${relativePath} failed:`, error instanceof Error ? error.message : error);
    return jsonError(502, "Backend servisine şu anda ulaşılamıyor.", "upstream_unavailable");
  };

  let upstream: Response;
  try {
    upstream = await fetch(upstreamUrl, {
      method: request.method,
      headers,
      body,
      redirect: "manual",
      cache: "no-store",
      signal: controller.signal,
    });
  } catch (error) {
    return failure(error);
  }

  const responseHeaders = new Headers(upstream.headers);
  for (const name of DROPPED_RESPONSE_HEADERS) responseHeaders.delete(name);
  const location = upstream.headers.get("location");
  if (location) responseHeaders.set("location", rewriteLocation(location, apiBase));

  const hasNoBody = request.method === "HEAD" || [101, 204, 205, 304].includes(upstream.status);
  let payload: ArrayBuffer | null = null;
  try {
    payload = hasNoBody ? null : await upstream.arrayBuffer();
  } catch (error) {
    return failure(error);
  }
  cleanup();
  return new Response(payload, { status: upstream.status, statusText: upstream.statusText, headers: responseHeaders });
}

export const GET = proxyRequest;
export const HEAD = proxyRequest;
export const POST = proxyRequest;
