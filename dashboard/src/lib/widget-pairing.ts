/**
 * Client helpers for iOS widget QR pairing and paired device management.
 *
 * Uses an opaque per-browser workspace owner key stored in localStorage (`X-Widget-Owner`),
 * which the server hashes with SHA-256. Paired phones never receive this key — they receive
 * a separate read-only Bearer token (`scope: "widget:read"`) after consuming a 10-minute code.
 */

const OWNER_STORAGE_KEY = "hisse.widget.ownerKey";
const WIDGET_API_BASE = "/api/widget";

export class WidgetPairingError extends Error {
  status: number | null;
  code?: string;

  constructor(message: string, status: number | null = null, code?: string) {
    super(message);
    this.name = "WidgetPairingError";
    this.status = status;
    this.code = code;
  }
}

export interface WidgetPairingCode {
  code: string;
  expires_at: string;
  watchlist_id: string;
  watchlist_name: string;
  tickers: string[];
}

export interface WidgetDevice {
  id: string;
  name: string;
  scope: string;
  watchlist_id: string;
  watchlist_name: string;
  tickers: string[];
  dashboard_id: string | null;
  created_at: string;
  last_seen_at: string | null;
}

export interface WidgetPairingPayload {
  watchlist_id: string;
  watchlist_name: string;
  tickers: string[];
  dashboard_id?: string | null;
}

let memoryOwnerKey: string | null = null;

function randomOwnerKey(): string {
  const bytes = new Uint8Array(24);
  // This key is the only credential for managing paired devices, so never fall back to
  // Math.random: without a secure random source we would rather fail than issue a guessable key.
  if (typeof crypto === "undefined" || typeof crypto.getRandomValues !== "function") {
    throw new Error("Secure random source unavailable");
  }
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Stable opaque workspace key used to list, update, and revoke paired iPhone widgets. */
export function getWidgetOwnerKey(): string {
  if (memoryOwnerKey) return memoryOwnerKey;
  if (typeof window === "undefined") return "";
  try {
    const existing = window.localStorage.getItem(OWNER_STORAGE_KEY);
    if (existing && /^[A-Za-z0-9_-]{16,128}$/.test(existing)) {
      memoryOwnerKey = existing;
      return existing;
    }
    const created = randomOwnerKey();
    window.localStorage.setItem(OWNER_STORAGE_KEY, created);
    memoryOwnerKey = created;
    return created;
  } catch {
    memoryOwnerKey = randomOwnerKey();
    return memoryOwnerKey;
  }
}

/** Format an 8-character pairing code into a readable `ABCD-2345` pair. */
export function formatPairingCode(code: string): string {
  const cleaned = code.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  return cleaned.length === 8 ? `${cleaned.slice(0, 4)}-${cleaned.slice(4)}` : cleaned;
}

/** Build the custom-scheme deep link opened by iPhone Camera or the "Open in App" button. */
export function buildPairingLink(origin: string, code: string): string {
  const normalizedOrigin = origin.trim().replace(/\/+$/, "");
  const cleanedCode = code.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  return `hisseanalizi://pair?server=${encodeURIComponent(normalizedOrigin)}&code=${encodeURIComponent(cleanedCode)}`;
}

/** True when the pairing code's expiration timestamp has passed. */
export function isPairingExpired(expiresAt: string, nowMs: number = Date.now()): boolean {
  const parsed = Date.parse(expiresAt);
  return Number.isNaN(parsed) || parsed <= nowMs;
}

async function widgetFetch<T>(
  subpath: string,
  options: { method?: "GET" | "POST" | "PATCH" | "DELETE"; body?: unknown; signal?: AbortSignal } = {},
): Promise<T> {
  const { method = "GET", body, signal } = options;
  const headers: Record<string, string> = {
    Accept: "application/json",
    "X-Widget-Owner": getWidgetOwnerKey(),
  };
  if (body !== undefined) headers["Content-Type"] = "application/json";

  const path = `${WIDGET_API_BASE}${subpath}`;
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      cache: "no-store",
      signal,
    });
  } catch {
    throw new WidgetPairingError("Sunucuya ulaşılamadı. İnternet bağlantınızı kontrol edin.", null, "network");
  }

  if (!res.ok) {
    let detail = `Sunucu hatası (${res.status}).`;
    let code: string | undefined;
    try {
      const payload = (await res.json()) as { detail?: string; code?: string };
      if (typeof payload.detail === "string" && payload.detail.trim()) detail = payload.detail.trim();
      if (typeof payload.code === "string") code = payload.code;
    } catch {
      // ignore invalid error body
    }
    throw new WidgetPairingError(detail, res.status, code);
  }
  return (await res.json()) as T;
}

export async function listWidgetDevices(signal?: AbortSignal): Promise<WidgetDevice[]> {
  const data = await widgetFetch<{ devices: WidgetDevice[] }>("/devices", { signal });
  return data.devices;
}

export async function createPairingCode(payload: WidgetPairingPayload): Promise<WidgetPairingCode> {
  return widgetFetch<WidgetPairingCode>("/devices", { method: "POST", body: payload });
}

export async function updateWidgetDevice(deviceId: string, payload: WidgetPairingPayload): Promise<WidgetDevice> {
  return widgetFetch<WidgetDevice>(`/devices/${encodeURIComponent(deviceId)}`, { method: "PATCH", body: payload });
}

export async function revokeWidgetDevice(deviceId: string): Promise<void> {
  await widgetFetch<{ revoked: boolean }>(`/devices/${encodeURIComponent(deviceId)}`, { method: "DELETE" });
}
