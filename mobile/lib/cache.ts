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

export function createSnapshotCache(store?: KeyValueStore) {
  const getStore = async () => store ?? resolveDefaultStore();

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
