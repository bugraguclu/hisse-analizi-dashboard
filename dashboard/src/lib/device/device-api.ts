/**
 * Requests to the anonymous-device API (`/api/push/...`, `/api/me/...`),
 * authenticated with the device key header. Pure fetch wrapper (Node-testable).
 */

import { DEVICE_KEY_HEADER } from "./device-key.ts";

export const DEVICE_API_BASE = "/api";
const REQUEST_TIMEOUT_MS = 20_000;

export type DeviceMethod = "GET" | "POST" | "PUT" | "DELETE";

export interface DeviceRequest {
  method?: DeviceMethod;
  body?: unknown;
  deviceKey?: string | null;
  idempotencyKey?: string;
  signal?: AbortSignal;
}

/**
 * `status` is null when no response arrived (offline, DNS, timeout): those are
 * the failures the offline outbox queues and retries. `body` is the parsed JSON
 * error payload (FastAPI `detail`, our `code`, and `current` for conflicts).
 */
export class DeviceApiError extends Error {
  readonly status: number | null;
  readonly code: string | null;
  readonly body: unknown;

  constructor(message: string, status: number | null, code: string | null = null, body: unknown = null) {
    super(message);
    this.name = "DeviceApiError";
    this.status = status;
    this.code = code;
    this.body = body;
  }

  /** Worth retrying later: no response, a timeout, rate limiting or a server/gateway error. */
  get transient(): boolean {
    return this.status === null || this.status === 408 || this.status === 429 || this.status >= 500;
  }
}

function detailText(payload: unknown, fallback: string): string {
  if (payload && typeof payload === "object" && "detail" in payload) {
    const detail = (payload as { detail: unknown }).detail;
    if (typeof detail === "string" && detail.trim()) return detail;
    if (Array.isArray(detail)) {
      const messages = detail.map((item) => (item && typeof item === "object" && "msg" in item ? String(item.msg) : "")).filter(Boolean);
      if (messages.length) return messages.join("; ");
    }
  }
  return fallback;
}

export async function deviceRequest<T>(path: string, options: DeviceRequest = {}, fetchImpl: typeof fetch = fetch): Promise<T> {
  const headers: Record<string, string> = { accept: "application/json" };
  if (options.deviceKey) headers[DEVICE_KEY_HEADER] = options.deviceKey;
  if (options.idempotencyKey) headers["Idempotency-Key"] = options.idempotencyKey;
  if (options.body !== undefined) headers["content-type"] = "application/json";

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const abort = () => controller.abort();
  options.signal?.addEventListener("abort", abort, { once: true });

  let response: Response;
  try {
    response = await fetchImpl(`${DEVICE_API_BASE}${path}`, {
      method: options.method ?? "GET",
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      cache: "no-store",
      credentials: "same-origin",
      signal: controller.signal,
    });
  } catch (error) {
    throw new DeviceApiError(error instanceof Error ? error.message : "network error", null, "network");
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", abort);
  }

  if (response.status === 204) return null as T;
  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  if (!response.ok) {
    const code = payload && typeof payload === "object" && "code" in payload ? String((payload as { code: unknown }).code) : null;
    throw new DeviceApiError(detailText(payload, `HTTP ${response.status}`), response.status, code, payload);
  }
  return payload as T;
}

/** Random idempotency key (8–128 of [A-Za-z0-9._:-], as the API requires). */
export function newIdempotencyKey(prefix = "m"): string {
  const random = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${random}`;
}
