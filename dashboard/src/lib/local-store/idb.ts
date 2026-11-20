/**
 * Persistent IndexedDB archive for workspace restore points (pre-restore
 * rollback copies + manual snapshots) and extended offline market snapshots.
 *
 * Falls back gracefully to an in-memory store when IndexedDB is unavailable
 * (SSR, private mode with blocked IDB, or Node unit tests).
 */

export type RestorePointKind = "prerestore" | "manual";

export interface RestorePointMeta {
  id: string;
  kind: RestorePointKind;
  name: string;
  createdAt: number;
  size: number;
  watchlistCount: number;
  layoutCount: number;
  drawingCount: number;
}

export interface RestorePointRecord extends RestorePointMeta {
  contents: string;
}

export interface BackupArchiveStore {
  list(): Promise<RestorePointMeta[]>;
  read(id: string): Promise<RestorePointRecord | null>;
  write(record: RestorePointRecord): Promise<void>;
  remove(id: string): Promise<void>;
}

const DB_NAME = "hisse-analizi-local";
const DB_VERSION = 1;
const BACKUPS_STORE = "backups";
const OFFLINE_STORE = "offlineSnapshots";

function openLocalDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(BACKUPS_STORE)) {
          db.createObjectStore(BACKUPS_STORE, { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains(OFFLINE_STORE)) {
          db.createObjectStore(OFFLINE_STORE, { keyPath: "key" });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

function toMeta(record: RestorePointRecord): RestorePointMeta {
  return {
    id: record.id,
    kind: record.kind,
    name: record.name,
    createdAt: record.createdAt,
    size: record.size,
    watchlistCount: record.watchlistCount,
    layoutCount: record.layoutCount,
    drawingCount: record.drawingCount,
  };
}

export function createMemoryArchiveStore(): BackupArchiveStore {
  const entries = new Map<string, RestorePointRecord>();
  return {
    async list() {
      return [...entries.values()]
        .map(toMeta)
        .sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id));
    },
    async read(id) {
      return entries.get(id) ?? null;
    },
    async write(record) {
      entries.set(record.id, { ...record });
    },
    async remove(id) {
      entries.delete(id);
    },
  };
}

const fallbackArchive = createMemoryArchiveStore();

/**
 * Browser IndexedDB archive store. If IndexedDB is blocked or fails, falls back
 * to the session memory store so rollback still works during the active session.
 */
export function createIndexedDbArchiveStore(): BackupArchiveStore {
  return {
    async list() {
      const db = await openLocalDb();
      if (!db) return fallbackArchive.list();
      const memory = await fallbackArchive.list();
      return new Promise((resolve) => {
        try {
          const tx = db.transaction(BACKUPS_STORE, "readonly");
          const req = tx.objectStore(BACKUPS_STORE).getAll();
          req.onsuccess = () => {
            const rows = (req.result as RestorePointRecord[] | undefined) ?? [];
            const combined = new Map(
              [...rows.filter((row) => row && typeof row.id === "string").map(toMeta), ...memory]
                .map((row) => [row.id, row]),
            );
            resolve(
              [...combined.values()]
                .sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id)),
            );
          };
          req.onerror = () => resolve(fallbackArchive.list());
        } catch {
          resolve(fallbackArchive.list());
        } finally {
          db.close();
        }
      });
    },
    async read(id) {
      const memory = await fallbackArchive.read(id);
      if (memory) return memory;
      const db = await openLocalDb();
      if (!db) return fallbackArchive.read(id);
      return new Promise((resolve) => {
        try {
          const tx = db.transaction(BACKUPS_STORE, "readonly");
          const req = tx.objectStore(BACKUPS_STORE).get(id);
          req.onsuccess = () => resolve((req.result as RestorePointRecord | undefined) ?? fallbackArchive.read(id));
          req.onerror = () => resolve(fallbackArchive.read(id));
        } catch {
          resolve(fallbackArchive.read(id));
        } finally {
          db.close();
        }
      });
    },
    async write(record) {
      await fallbackArchive.write(record);
      const db = await openLocalDb();
      if (!db) return;
      await new Promise<void>((resolve) => {
        try {
          const tx = db.transaction(BACKUPS_STORE, "readwrite");
          tx.objectStore(BACKUPS_STORE).put(record);
          tx.oncomplete = () => { void fallbackArchive.remove(record.id).then(resolve); };
          tx.onerror = () => resolve();
          tx.onabort = () => resolve();
        } catch {
          resolve();
        } finally {
          db.close();
        }
      });
    },
    async remove(id) {
      await fallbackArchive.remove(id);
      const db = await openLocalDb();
      if (!db) return;
      await new Promise<void>((resolve) => {
        try {
          const tx = db.transaction(BACKUPS_STORE, "readwrite");
          tx.objectStore(BACKUPS_STORE).delete(id);
          tx.oncomplete = () => resolve();
          tx.onerror = () => resolve();
          tx.onabort = () => resolve();
        } catch {
          resolve();
        } finally {
          db.close();
        }
      });
    },
  };
}

/** Mirror an offline snapshot into IndexedDB for extra durability beyond localStorage. */
export async function writeIdbOfflineSnapshot(key: string, payload: unknown): Promise<void> {
  const db = await openLocalDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(OFFLINE_STORE, "readwrite");
      tx.objectStore(OFFLINE_STORE).put({ key, payload, updatedAt: Date.now() });
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      resolve();
    } finally {
      db.close();
    }
  });
}

export async function readIdbOfflineSnapshot<T>(key: string): Promise<T | null> {
  const db = await openLocalDb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(OFFLINE_STORE, "readonly");
      const req = tx.objectStore(OFFLINE_STORE).get(key);
      req.onsuccess = () => {
        const record = req.result as { payload?: T } | undefined;
        resolve(record?.payload ?? null);
      };
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    } finally {
      db.close();
    }
  });
}

export async function clearIdbOfflineSnapshot(key: string): Promise<void> {
  const db = await openLocalDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(OFFLINE_STORE, "readwrite");
      tx.objectStore(OFFLINE_STORE).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      resolve();
    } finally {
      db.close();
    }
  });
}
