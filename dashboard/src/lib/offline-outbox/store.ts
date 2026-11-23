/**
 * Outbox persistence: IndexedDB in the browser (survives reloads, shared with
 * the service worker), memory elsewhere (SSR, tests, IndexedDB blocked).
 */

import { OUTBOX_STORE, openLocalDb } from "../local-store/idb.ts";
import type { OutboxEntry, OutboxStoreLike } from "./core.ts";

export interface OutboxStore extends OutboxStoreLike {
  apply(plan: { put: OutboxEntry[]; remove: string[] }): Promise<void>;
  /** False when entries live only in memory (lost on reload). */
  readonly durable: boolean;
}

export function createMemoryOutboxStore(initial: OutboxEntry[] = []): OutboxStore {
  const entries = new Map(initial.map((entry) => [entry.id, structuredClone(entry)]));
  return {
    durable: false,
    async list() {
      return [...entries.values()].map((entry) => structuredClone(entry)).sort((a, b) => a.seq - b.seq);
    },
    async put(entry) {
      entries.set(entry.id, structuredClone(entry));
    },
    async remove(id) {
      entries.delete(id);
    },
    async apply(plan) {
      for (const id of plan.remove) entries.delete(id);
      for (const entry of plan.put) entries.set(entry.id, structuredClone(entry));
    },
  };
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => Promise<T> | T): Promise<T> {
  const db = await openLocalDb();
  if (!db) throw new Error("indexeddb-unavailable");
  try {
    const tx = db.transaction(OUTBOX_STORE, mode);
    const done = new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error("aborted"));
    });
    const result = await work(tx.objectStore(OUTBOX_STORE));
    await done;
    return result;
  } finally {
    db.close();
  }
}

const memoryFallback = createMemoryOutboxStore();

/** IndexedDB-backed store; falls back to session memory if IndexedDB is unusable. */
export function createIndexedDbOutboxStore(): OutboxStore {
  let durable = typeof indexedDB !== "undefined";
  const fallback = async <T,>(work: () => Promise<T>, onFail: () => Promise<T>): Promise<T> => {
    if (!durable) return onFail();
    try {
      return await work();
    } catch {
      durable = false;
      return onFail();
    }
  };
  return {
    get durable() {
      return durable;
    },
    list: () =>
      fallback(
        () => withStore("readonly", (store) => request(store.getAll() as IDBRequest<OutboxEntry[]>)).then((rows) => rows.sort((a, b) => a.seq - b.seq)),
        () => memoryFallback.list(),
      ),
    put: (entry) =>
      fallback(
        () => withStore("readwrite", (store) => void store.put(entry)),
        () => memoryFallback.put(entry),
      ),
    remove: (id) =>
      fallback(
        () => withStore("readwrite", (store) => void store.delete(id)),
        () => memoryFallback.remove(id),
      ),
    // One transaction: a merge or a resolution is applied completely or not at all.
    apply: (plan) =>
      fallback(
        () =>
          withStore("readwrite", (store) => {
            for (const id of plan.remove) store.delete(id);
            for (const entry of plan.put) store.put(entry);
          }),
        () => memoryFallback.apply(plan),
      ),
  };
}
