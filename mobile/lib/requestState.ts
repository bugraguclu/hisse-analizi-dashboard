/**
 * Pure async-resource state machine & race-condition guard shared across mobile
 * analysis screens. Explicitly distinguishes:
 *  - `loading`: first request in flight, no cached data yet
 *  - `ready`: fresh data returned by the server
 *  - `empty`: request succeeded, zero matching records
 *  - `stale`: last cached snapshot is displayed with its saved timestamp (either while
 *             revalidating or after a refresh failure, with an inline retry action)
 *  - `error`: request failed and no cached snapshot exists
 */

export type ResourceStatus = "loading" | "ready" | "empty" | "stale" | "error";

export interface ResourceState<T> {
  /** Logical cache/identity key (e.g. "stock:THYAO" or "chart:GARAN:1y"). */
  key: string;
  status: ResourceStatus;
  data: T | null;
  /** Timestamp of the displayed data (live fetch time or cache save time). */
  fetchedAt: string | null;
  /** True when a refresh/revalidation is running in the background over existing data. */
  refreshing: boolean;
  /** User-facing Turkish error message when the latest attempt failed. */
  error: string | null;
  /** HTTP status code if available, null for network/timeout errors. */
  errorStatus: number | null;
}

export function initialResourceState<T>(key: string): ResourceState<T> {
  return {
    key,
    status: "loading",
    data: null,
    fetchedAt: null,
    refreshing: false,
    error: null,
    errorStatus: null,
  };
}

export function applyCachedSnapshot<T>(
  state: ResourceState<T>,
  key: string,
  data: T,
  savedAt: string,
  isEmpty?: (value: T) => boolean,
): ResourceState<T> {
  if (state.key !== key) return state;
  // Never overwrite fresh data that already arrived from the network.
  if (state.status === "ready" || state.status === "empty") return state;
  const empty = isEmpty ? isEmpty(data) : false;
  return {
    key,
    status: empty ? "empty" : "stale",
    data,
    fetchedAt: savedAt,
    refreshing: true,
    error: null,
    errorStatus: null,
  };
}

export function applyFetchStart<T>(state: ResourceState<T>, key: string): ResourceState<T> {
  if (state.key !== key) {
    // Switching keys (e.g. THYAO -> GARAN) immediately clears the previous key's data.
    return initialResourceState<T>(key);
  }
  if (state.data !== null) {
    return {
      ...state,
      refreshing: true,
      error: null,
      errorStatus: null,
    };
  }
  return {
    ...state,
    status: "loading",
    refreshing: false,
    error: null,
    errorStatus: null,
  };
}

export function applyFetchSuccess<T>(
  state: ResourceState<T>,
  key: string,
  data: T,
  fetchedAt: string,
  isEmpty?: (value: T) => boolean,
): ResourceState<T> {
  if (state.key !== key) return state;
  const empty = isEmpty ? isEmpty(data) : false;
  return {
    key,
    status: empty ? "empty" : "ready",
    data,
    fetchedAt,
    refreshing: false,
    error: null,
    errorStatus: null,
  };
}

export function applyFetchError<T>(
  state: ResourceState<T>,
  key: string,
  message: string,
  statusCode: number | null = null,
): ResourceState<T> {
  if (state.key !== key) return state;
  if (state.data !== null) {
    return {
      ...state,
      status: "stale",
      refreshing: false,
      error: message,
      errorStatus: statusCode,
    };
  }
  return {
    key,
    status: "error",
    data: null,
    fetchedAt: null,
    refreshing: false,
    error: message,
    errorStatus: statusCode,
  };
}

/**
 * Monotonic request coordinator that cancels superseded requests and rejects stale
 * completions when keys or filters change rapidly.
 */
export class RequestGuard {
  private seq = 0;
  private activeKey = "";
  private controller: AbortController | null = null;

  begin(key: string): { token: number; key: string; signal: AbortSignal } {
    this.controller?.abort();
    this.seq += 1;
    this.activeKey = key;
    const controller = new AbortController();
    this.controller = controller;
    return { token: this.seq, key, signal: controller.signal };
  }

  isCurrent(token: number, key: string): boolean {
    return token === this.seq && key === this.activeKey;
  }

  cancel(): void {
    this.seq += 1;
    this.controller?.abort();
    this.controller = null;
  }
}

export function isAbortError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const name = (error as { name?: unknown }).name;
  return name === "AbortError";
}

export function describeApiFailure(error: unknown): { message: string; status: number | null } {
  if (error && typeof error === "object") {
    const err = error as { status?: unknown; code?: unknown; message?: unknown };
    const status = typeof err.status === "number" ? err.status : null;
    const code = typeof err.code === "string" ? err.code : null;
    const rawMsg = typeof err.message === "string" ? err.message.trim() : "";

    if (code === "timeout") {
      return { message: "Sunucu yanıtı zaman aşımına uğradı. Bağlantınızı kontrol edip tekrar deneyin.", status: null };
    }
    if (code === "network") {
      return { message: "Sunucuya ulaşılamıyor. İnternet bağlantınızı kontrol edin.", status: null };
    }
    if (status === 404) {
      return { message: rawMsg && !rawMsg.startsWith("HTTP ") ? rawMsg : "İstenen kayıt bulunamadı.", status: 404 };
    }
    if (status === 429) {
      return { message: "Çok fazla istek gönderildi. Kısa süre sonra tekrar deneyin.", status: 429 };
    }
    if (status !== null && status >= 500) {
      return {
        message: rawMsg && !rawMsg.startsWith("HTTP ") ? rawMsg : "Veri kaynağı geçici olarak yanıt vermiyor.",
        status,
      };
    }
    if (rawMsg && !rawMsg.startsWith("HTTP ")) {
      return { message: rawMsg, status };
    }
    if (status !== null) {
      return { message: `Veri alınamadı (HTTP ${status}).`, status };
    }
  }
  return { message: "Veri alınırken beklenmeyen bir bağlantı hatası oluştu.", status: null };
}
