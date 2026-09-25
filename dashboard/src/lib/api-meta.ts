import { useSyncExternalStore } from "react";

/**
 * Last `meta` block (provenance/freshness, see components/shared/DataMeta.tsx) seen per
 * API path. The API client records every GET response here, so a card can show whether
 * its data came live, from the store or from a stale copy without threading `meta`
 * through the query parsers. Payloads without a `meta` block record nothing.
 */

interface Entry {
  meta: unknown;
  seq: number;
}

const entries = new Map<string, Entry>();
const listeners = new Set<() => void>();
let seq = 0;
let version = 0;

export function recordApiMeta(path: string, payload: unknown): void {
  const meta = payload && typeof payload === "object" && !Array.isArray(payload) ? (payload as { meta?: unknown }).meta : undefined;
  const had = entries.has(path);
  if (meta && typeof meta === "object") entries.set(path, { meta, seq: ++seq });
  else if (had) entries.delete(path);
  else return;
  version += 1;
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Newest recorded `{ meta }` among paths starting with `prefix` (e.g. "/market/ticker/THYAO/history"). */
function latestFor(prefix: string): { meta: unknown } | null {
  let best: Entry | null = null;
  for (const [path, entry] of entries) {
    if (path.startsWith(prefix) && (best === null || entry.seq > best.seq)) best = entry;
  }
  return best ? { meta: best.meta } : null;
}

const snapshots = new Map<string, { version: number; value: { meta: unknown } | null }>();

/** `{ meta }` of the newest response under `prefix` (pass it to <DataMeta payload>), or null. */
export function useApiMeta(prefix: string | null): { meta: unknown } | null {
  return useSyncExternalStore(
    subscribe,
    () => {
      if (prefix === null) return null;
      const cached = snapshots.get(prefix);
      if (cached && cached.version === version) return cached.value;
      const next = latestFor(prefix);
      // Keep the previous object when nothing changed so React does not re-render in a loop.
      const value = cached && cached.value?.meta === next?.meta ? cached.value : next;
      snapshots.set(prefix, { version, value });
      return value;
    },
    () => null,
  );
}
