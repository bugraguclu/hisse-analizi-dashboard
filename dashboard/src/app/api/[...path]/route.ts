import type { NextRequest } from "next/server";

type RouteContext = {
  params: Promise<{ path: string[] }>;
};

const REQUEST_HEADERS_TO_REMOVE = [
  "connection",
  "content-length",
  "host",
  "transfer-encoding",
];

const RESPONSE_HEADERS_TO_REMOVE = [
  "connection",
  "content-encoding",
  "content-length",
  "transfer-encoding",
];

export const dynamic = "force-dynamic";

function getApiBaseUrl(): URL {
  const configuredUrl =
    process.env.API_URL?.trim() ||
    process.env.NEXT_PUBLIC_API_URL?.trim() ||
    "http://localhost:8000";
  const apiUrl = new URL(configuredUrl);

  if (apiUrl.protocol !== "http:" && apiUrl.protocol !== "https:") {
    throw new Error("API_URL must use the http or https protocol.");
  }

  return apiUrl;
}

async function proxyRequest(request: NextRequest, context: RouteContext) {
  try {
    const { path } = await context.params;
    const upstreamUrl = getApiBaseUrl();
    const basePath = upstreamUrl.pathname.replace(/\/$/, "");
    const encodedPath = path.map(encodeURIComponent).join("/");

    upstreamUrl.pathname = `${basePath}/${encodedPath}`;
    upstreamUrl.search = request.nextUrl.search;

    const requestHeaders = new Headers(request.headers);
    REQUEST_HEADERS_TO_REMOVE.forEach((header) => requestHeaders.delete(header));

    const init: RequestInit = {
      method: request.method,
      headers: requestHeaders,
      redirect: "manual",
      cache: "no-store",
    };

    if (request.method !== "GET" && request.method !== "HEAD") {
      init.body = await request.arrayBuffer();
    }

    const upstreamResponse = await fetch(upstreamUrl, init);
    const responseHeaders = new Headers(upstreamResponse.headers);
    RESPONSE_HEADERS_TO_REMOVE.forEach((header) => responseHeaders.delete(header));

    return new Response(upstreamResponse.body, {
      status: upstreamResponse.status,
      statusText: upstreamResponse.statusText,
      headers: responseHeaders,
    });
  } catch (error) {
    console.error("API proxy request failed:", error);
    return Response.json(
      { detail: "Backend servisine şu anda ulaşılamıyor." },
      { status: 502 },
    );
  }
}

export const GET = proxyRequest;
export const POST = proxyRequest;
export const PUT = proxyRequest;
export const PATCH = proxyRequest;
export const DELETE = proxyRequest;
export const HEAD = proxyRequest;
export const OPTIONS = proxyRequest;
