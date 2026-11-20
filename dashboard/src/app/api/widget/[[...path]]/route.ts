import type { NextRequest } from "next/server";
import { clientIpFromForwardedFor, trustedProxyHops } from "@/lib/client-ip";

/**
 * Dedicated same-origin proxy for iOS widget pairing & read-only summary routes:
 *   /api/widget/<path> -> FastAPI <API_URL>/widget/<path>
 *
 * Kept separate from app/api/[...path]/route.ts so the general public proxy
 * continues to drop Authorization and admin headers while widget routes can
 * carry read-only device Bearer tokens and the browser's X-Widget-Owner key.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ path?: string[] }>;
};

const UPSTREAM_TIMEOUT_MS = 20_000;
const MAX_BODY_BYTES = 64_000;

const ALLOWED_SUBPATHS = [
  /^devices$/,
  /^devices\/[0-9a-fA-F-]{36}$/,
  /^pair$/,
  /^summary$/,
] as const;

const FORWARDED_HEADERS = [
  "accept",
  "accept-language",
  "authorization",
  "content-type",
  "user-agent",
  "x-widget-owner",
] as const;

const DROPPED_RESPONSE_HEADERS = [
  "connection",
  "content-encoding",
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
] as const;

function jsonError(status: number, detail: string, code: string): Response {
  return Response.json({ detail, code }, { status, headers: { "cache-control": "no-store" } });
}

function getApiBaseUrl(): URL {
  const configured = process.env.API_URL?.trim() || process.env.NEXT_PUBLIC_API_URL?.trim() || "http://localhost:8000";
  const url = new URL(configured);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("API_URL must use http or https.");
  }
  return url;
}

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

async function proxyWidget(request: NextRequest, context: RouteContext): Promise<Response> {
  const { path = [] } = await context.params;
  if (path.length === 0 || path.some((segment) => segment === "" || segment === "." || segment === "..")) {
    return jsonError(404, "İstenen kaynak bulunamadı.", "not_found");
  }
  const subpath = path.join("/");
  if (!ALLOWED_SUBPATHS.some((pattern) => pattern.test(subpath))) {
    return jsonError(404, "İstenen kaynak bulunamadı.", "not_found");
  }

  let apiBase: URL;
  try {
    apiBase = getApiBaseUrl();
  } catch {
    return jsonError(502, "Backend servisine şu anda ulaşılamıyor.", "proxy_misconfigured");
  }

  const upstreamUrl = new URL(apiBase);
  upstreamUrl.pathname = `${apiBase.pathname.replace(/\/$/, "")}/widget/${path.map(encodeURIComponent).join("/")}`;
  upstreamUrl.search = request.nextUrl.search;

  const headers = new Headers();
  for (const name of FORWARDED_HEADERS) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  const ip = clientIpFromForwardedFor(request.headers.get("x-forwarded-for"), trustedProxyHops());
  if (ip) headers.set("x-forwarded-for", ip);
  const proto = request.headers.get("x-forwarded-proto") === "https" ? "https" : request.nextUrl.protocol.replace(":", "");
  headers.set("x-forwarded-proto", proto === "https" ? "https" : "http");

  let body: Uint8Array<ArrayBuffer> | undefined;
  if (request.method !== "GET" && request.method !== "HEAD" && request.method !== "DELETE") {
    const declaredTooLarge = Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES;
    const read = declaredTooLarge ? null : await readBodyWithin(request, MAX_BODY_BYTES);
    if (!read) return jsonError(413, "İstek gövdesi çok büyük.", "payload_too_large");
    body = read;
  }

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

  try {
    const upstream = await fetch(upstreamUrl, {
      method: request.method,
      headers,
      body,
      redirect: "manual",
      cache: "no-store",
      signal: controller.signal,
    });
    const responseHeaders = new Headers(upstream.headers);
    for (const name of DROPPED_RESPONSE_HEADERS) responseHeaders.delete(name);
    responseHeaders.set("cache-control", "no-store");
    const hasNoBody = request.method === "HEAD" || [101, 204, 205, 304].includes(upstream.status);
    const payload = hasNoBody ? null : await upstream.arrayBuffer();
    cleanup();
    return new Response(payload, { status: upstream.status, statusText: upstream.statusText, headers: responseHeaders });
  } catch {
    cleanup();
    if (timedOut) return jsonError(504, "Backend servisi zamanında yanıt vermedi.", "upstream_timeout");
    if (request.signal.aborted) return new Response(null, { status: 499 });
    return jsonError(502, "Backend servisine şu anda ulaşılamıyor.", "upstream_unavailable");
  }
}

export const GET = proxyWidget;
export const POST = proxyWidget;
export const PATCH = proxyWidget;
export const DELETE = proxyWidget;
