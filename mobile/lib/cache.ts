/**
 * Lightweight, corruption-tolerant snapshot cache backed by AsyncStorage (or an
 * injected store in unit tests). Each entry carries an explicit `savedAt` ISO
 * timestamp so stale fallback banners always show when the cached record was saved.
 */

export interface CacheEntry<T> {
  savedAt: string;
  data: T;
}

export interface KeyValueStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

const CACHE_PREFIX = "hisse_analizi_cache_v1:";

let defaultStorePromise: Promise<KeyValueStore> | null = null;

async function resolveDefaultStore(): Promise<KeyValueStore> {
  if (!defaultStorePromise) {
    defaultStorePromise = import("@react-native-async-storage/async-storage")
      .then((mod) => mod.default as KeyValueStore)
      .catch(() => {
        const mem = new Map<string, string>();
        return {
          async getItem(key: string) {
            return mem.get(key) ?? null;
          },
          async setItem(key: string, value: string) {
            mem.set(key, value);
          },
          async removeItem(key: string) {
            mem.delete(key);
          },
        };
      });
  }
  return defaultStorePromise;
}

const INDEX_KEY = `${CACHE_PREFIX}__index`;
/** Snapshots kept on the device; per-ticker/period entries would otherwise grow without bound. */
export const MAX_CACHE_ENTRIES = 48;

export function createSnapshotCache(store?: KeyValueStore, maxEntries = MAX_CACHE_ENTRIES) {
  const getStore = async () => store ?? resolveDefaultStore();
  // Index updates are serialised so concurrent writes never lose each other's keys.
  let indexQueue: Promise<void> = Promise.resolve();

  const touchIndex = (key: string) => {
    indexQueue = indexQueue
      .then(async () => {
        const kv = await getStore();
        let index: Record<string, number> = {};
        try {
          const parsed = JSON.parse((await kv.getItem(INDEX_KEY)) ?? "{}") as unknown;
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            index = parsed as Record<string, number>;
          }
        } catch {
          index = {};
        }
        index[key] = Date.now();
        const keys = Object.keys(index).sort((a, b) => (index[a] ?? 0) - (index[b] ?? 0));
        const evicted = keys.slice(0, Math.max(0, keys.length - maxEntries));
        for (const old of evicted) {
          delete index[old];
          await kv.removeItem(`${CACHE_PREFIX}${old}`);
        }
        await kv.setItem(INDEX_KEY, JSON.stringify(index));
      })
      .catch(() => {
        // Eviction is best effort; a failed index update never blocks rendering.
      });
    return indexQueue;
  };

  return {
    async read<T>(key: string): Promise<CacheEntry<T> | null> {
      try {
        const kv = await getStore();
        const raw = await kv.getItem(`${CACHE_PREFIX}${key}`);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as unknown;
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
        const record = parsed as Record<string, unknown>;
        if (typeof record.savedAt !== "string" || !("data" in record)) return null;
        return { savedAt: record.savedAt, data: record.data as T };
      } catch {
        return null;
      }
    },

    async write<T>(key: string, data: T, savedAt = new Date().toISOString()): Promise<CacheEntry<T>> {
      const entry: CacheEntry<T> = { savedAt, data };
      try {
        const kv = await getStore();
        await kv.setItem(`${CACHE_PREFIX}${key}`, JSON.stringify(entry));
        await touchIndex(key);
      } catch {
        // Storage quota / availability failures never block live UI rendering.
      }
      return entry;
    },

    async clear(key: string): Promise<void> {
      try {
        const kv = await getStore();
        await kv.removeItem(`${CACHE_PREFIX}${key}`);
      } catch {
        // Ignore cleanup failures.
      }
    },
  };
}

export const snapshotCache = createSnapshotCache();
