"use client";

import { useQuery } from "@tanstack/react-query";
import { api, API_BASE } from "@/lib/api";
import { isFeatureEnabled } from "@/lib/demo";
import { createSseParser, type AssistantEvent, type buildAskBody } from "./model";

export type AskBody = ReturnType<typeof buildAskBody>;

/** Failure before the stream started (HTTP error, network) — `code` drives the message. */
export class AssistantRequestError extends Error {
  constructor(
    readonly code: "rate_limited" | "not_configured" | "invalid" | "network" | "server",
    readonly detail: string | null = null,
    readonly retryAfter: number | null = null,
  ) {
    super(code);
    this.name = "AssistantRequestError";
  }
}

/** Whether the assistant is configured on the server (cached for the session). */
export function useAssistantStatus() {
  return useQuery({
    queryKey: ["assistant-status"],
    queryFn: ({ signal }) => api.assistantStatus(signal),
    staleTime: 10 * 60_000,
    retry: 1,
    // The static demo has no server: never ask, the assistant stays hidden.
    enabled: isFeatureEnabled("assistant"),
  });
}

/**
 * `POST /assistant/ask` and read its Server-Sent Events until the stream ends.
 * Abort with `signal`; HTTP/network failures throw {@link AssistantRequestError}.
 */
export async function askAssistant(
  body: AskBody,
  { signal, onEvent }: { signal: AbortSignal; onEvent: (event: AssistantEvent) => void },
): Promise<void> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}/assistant/ask`, {
      method: "POST",
      headers: { Accept: "text/event-stream", "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
      signal,
    });
  } catch (error) {
    if (signal.aborted) throw error;
    throw new AssistantRequestError("network");
  }

  if (!response.ok) {
    let detail: string | null = null;
    let code: string | null = null;
    try {
      const payload = (await response.json()) as { detail?: unknown; code?: unknown };
      if (typeof payload.detail === "string") detail = payload.detail;
      if (typeof payload.code === "string") code = payload.code;
    } catch {
      // Non-JSON error page (proxy) — the status decides.
    }
    if (response.status === 429) {
      const retryAfter = Number(response.headers.get("retry-after"));
      throw new AssistantRequestError("rate_limited", detail, Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : null);
    }
    if (response.status === 503 && code === "assistant_not_configured") throw new AssistantRequestError("not_configured", detail);
    if (response.status === 422) throw new AssistantRequestError("invalid", detail);
    throw new AssistantRequestError("server", detail);
  }
  if (!response.body || !(response.headers.get("content-type") ?? "").startsWith("text/event-stream")) {
    throw new AssistantRequestError("server");
  }

  const parser = createSseParser(onEvent);
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      parser.feed(value);
    }
    parser.end();
  } catch (error) {
    if (signal.aborted) throw error;
    throw new AssistantRequestError("network");
  } finally {
    reader.releaseLock();
  }
}
