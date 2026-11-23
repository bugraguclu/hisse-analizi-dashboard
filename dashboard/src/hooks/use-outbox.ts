"use client";

import { useSyncExternalStore } from "react";
import { outboxCounts, type OutboxEntry } from "@/lib/offline-outbox/core";
import { listOutbox, subscribeOutbox } from "@/lib/offline-outbox/runtime";

export interface OutboxState {
  entries: OutboxEntry[];
  pending: number;
  conflicts: number;
  rejected: number;
  loaded: boolean;
}

const EMPTY: OutboxState = { entries: [], pending: 0, conflicts: 0, rejected: 0, loaded: false };
let state: OutboxState = EMPTY;
const listeners = new Set<() => void>();
let unsubscribe: (() => void) | null = null;
let reading: Promise<void> | null = null;

/** Re-read the queue (IndexedDB) and notify subscribers. */
export function refreshOutboxState(): Promise<void> {
  reading ??= listOutbox()
    .then((entries) => {
      state = { entries, ...outboxCounts(entries), loaded: true };
      listeners.forEach((listener) => listener());
    })
    .catch(() => undefined)
    .finally(() => {
      reading = null;
    });
  return reading;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (!unsubscribe) {
    unsubscribe = subscribeOutbox(() => void refreshOutboxState());
    void refreshOutboxState();
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && unsubscribe) {
      unsubscribe();
      unsubscribe = null;
    }
  };
}

/** Queued changes (pending, conflicts, rejected) across tabs and the service worker. */
export function useOutbox(): OutboxState {
  return useSyncExternalStore(subscribe, () => state, () => EMPTY);
}
