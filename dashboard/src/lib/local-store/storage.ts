/**
 * Cross-platform storage abstraction and cross-tab coordination helpers for
 * personal workspace persistence.
 *
 * Pure browser-free interface (`StorageAdapter`) so validation, migration,
 * backup/restore and offline snapshot logic can be unit-tested in Node and
 * reused across Web (localStorage / IndexedDB) and future native targets.
 */

export interface StorageAdapter {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  keys(): string[];
}

/** Dispatched on `window` whenever bulk local-store mutations (restore/migration) occur. */
export const WORKSPACE_STORAGE_EVENT = "hisse-workspace-storage-changed";

export function createBrowserStorage(): StorageAdapter | null {
  if (typeof window === "undefined") return null;
  try {
    const storage = window.localStorage;
    // Probe access once; Safari private / restricted iframes can throw on access.
    void storage.length;
    return {
      getItem(key) {
        try {
          return storage.getItem(key);
        } catch {
          return null;
        }
      },
      setItem(key, value) {
        storage.setItem(key, value);
      },
      removeItem(key) {
        try {
          storage.removeItem(key);
        } catch {
          // Ignore removal failures when storage is locked.
        }
      },
      keys() {
        try {
          const out: string[] = [];
          for (let i = 0; i < storage.length; i += 1) {
            const key = storage.key(i);
            if (key !== null) out.push(key);
          }
          return out;
        } catch {
          return [];
        }
      },
    };
  } catch {
    return null;
  }
}

export function createMemoryStorage(initial: Record<string, string> = {}): StorageAdapter {
  const map = new Map<string, string>(Object.entries(initial));
  return {
    getItem(key) {
      return map.get(key) ?? null;
    },
    setItem(key, value) {
      map.set(key, value);
    },
    removeItem(key) {
      map.delete(key);
    },
    keys() {
      return [...map.keys()];
    },
  };
}

export function emitWorkspaceStorageChange(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(WORKSPACE_STORAGE_EVENT));
}

export function subscribeWorkspaceStorage(listener: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(WORKSPACE_STORAGE_EVENT, listener);
  return () => {
    window.removeEventListener(WORKSPACE_STORAGE_EVENT, listener);
  };
}

let workQueue: Promise<unknown> = Promise.resolve();

/**
 * Serialize backup/restore work within this tab and across tabs (via Web Locks
 * when available) so concurrent writes or restores never interleave.
 */
export function serializeLocalStoreWork<T>(task: () => Promise<T>, lockName = "hisse-workspace-local-store"): Promise<T> {
  const run = async (): Promise<T> => {
    const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
    if (locks && typeof locks.request === "function") {
      return locks.request(lockName, () => task());
    }
    return task();
  };
  const next = workQueue.then(run, run);
  workQueue = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}
