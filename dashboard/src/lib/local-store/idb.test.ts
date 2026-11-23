import assert from "node:assert/strict";
import test from "node:test";
import { createIndexedDbArchiveStore, type RestorePointRecord } from "./idb.ts";

test("a restore point remains readable when IndexedDB writes fail but reads recover", async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "indexedDB");
  const request = <T>(value: T): IDBRequest<T> => {
    const result = { result: value } as IDBRequest<T>;
    queueMicrotask(() => result.onsuccess?.(new Event("success")));
    return result;
  };
  const db = {
    close() {},
    transaction() {
      return { objectStore() {
        return {
          put() { throw new Error("QuotaExceededError"); },
          getAll() { return request([]); },
          get() { return request(undefined); },
        };
      } };
    },
  };
  Object.defineProperty(globalThis, "indexedDB", {
    configurable: true,
    value: { open: () => request(db) } as unknown as IDBFactory,
  });
  try {
    const archive = createIndexedDbArchiveStore();
    const record: RestorePointRecord = {
      id: "prerestore-quota-regression", kind: "prerestore", name: "Before restore", createdAt: 1,
      size: 2, watchlistCount: 1, layoutCount: 0, drawingCount: 0, contents: "{}",
    };
    await archive.write(record);
    assert.equal((await archive.list()).find((item) => item.id === record.id)?.name, record.name);
    assert.deepEqual(await archive.read(record.id), record);
  } finally {
    if (descriptor) Object.defineProperty(globalThis, "indexedDB", descriptor);
    else Reflect.deleteProperty(globalThis, "indexedDB");
  }
});
