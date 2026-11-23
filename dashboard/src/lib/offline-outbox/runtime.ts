/**
 * Browser side of the outbox: enqueue, flush (foreground), Background Sync
 * registration and change notifications across tabs and the service worker.
 *
 * Every read-modify-write of the queue and every replay runs under the same Web
 * Lock ("hisse-outbox"), which the service worker takes too, so a merge can never
 * interleave with a send of the entry it merges into.
 */

import {
  outboxCounts,
  planEnqueue,
  replayOutbox,
  resolveEntry,
  type AppliedResult,
  type OutboxDraft,
  type OutboxEntry,
  type ReplaySummary,
  type Resolution,
} from "./core";
import { createIndexedDbOutboxStore, type OutboxStore } from "./store";

export const OUTBOX_LOCK = "hisse-outbox";
export const OUTBOX_CHANNEL = "hisse-outbox";
export const OUTBOX_SYNC_TAG = "hisse-outbox";
const RETRY_DELAYS_MS = [5_000, 15_000, 30_000, 60_000, 120_000, 300_000];

export type OutboxMessage = { type: "changed" } | { type: "applied"; applied: AppliedResult[] };

let store: OutboxStore | null = null;
function getStore(): OutboxStore {
  store ??= createIndexedDbOutboxStore();
  return store;
}

let localChain: Promise<unknown> = Promise.resolve();
function withLock<T>(task: () => Promise<T>): Promise<T> {
  const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
  if (locks?.request) return locks.request(OUTBOX_LOCK, task) as Promise<T>;
  const next = localChain.then(task, task);
  localChain = next.catch(() => undefined);
  return next;
}

// --- Notifications ----------------------------------------------------------------------

const listeners = new Set<(message: OutboxMessage) => void>();
let channel: BroadcastChannel | null = null;

function ensureChannel(): void {
  if (channel || typeof BroadcastChannel === "undefined") return;
  channel = new BroadcastChannel(OUTBOX_CHANNEL);
  channel.onmessage = (event: MessageEvent<OutboxMessage>) => {
    for (const listener of listeners) listener(event.data);
  };
}

function emit(message: OutboxMessage): void {
  for (const listener of listeners) listener(message);
  ensureChannel();
  channel?.postMessage(message);
}

/** Queue changes in this tab, other tabs and the service worker's background replays. */
export function subscribeOutbox(listener: (message: OutboxMessage) => void): () => void {
  ensureChannel();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// --- Queue operations -------------------------------------------------------------------

export function listOutbox(): Promise<OutboxEntry[]> {
  return getStore().list();
}

export function outboxIsDurable(): boolean {
  return getStore().durable;
}

let lastSeq = 0;
function nextSeq(existing: readonly OutboxEntry[]): number {
  const highest = existing.reduce((max, entry) => Math.max(max, entry.seq), 0);
  lastSeq = Math.max(Date.now() * 1000, highest + 1, lastSeq + 1);
  return lastSeq;
}

export function newOutboxId(): string {
  return `ob-${crypto.randomUUID()}`;
}

export type DraftInput = Omit<OutboxDraft, "id" | "seq" | "createdAt">;

export async function enqueueMutation(input: DraftInput): Promise<void> {
  await withLock(async () => {
    const existing = await getStore().list();
    const draft: OutboxDraft = { ...input, id: newOutboxId(), seq: nextSeq(existing), createdAt: Date.now() };
    await getStore().apply(planEnqueue(existing, draft));
  });
  emit({ type: "changed" });
  void registerBackgroundSync();
  void flushOutbox();
}

export async function resolveOutboxEntry(entryId: string, resolution: Resolution): Promise<OutboxEntry | null> {
  let resolved: OutboxEntry | null = null;
  await withLock(async () => {
    const entries = await getStore().list();
    resolved = entries.find((entry) => entry.id === entryId) ?? null;
    await getStore().apply(resolveEntry(entries, entryId, resolution, newOutboxId()));
  });
  emit({ type: "changed" });
  if (resolution === "keep-mine") void flushOutbox();
  return resolved;
}

// --- Replay -----------------------------------------------------------------------------

let retryTimer: ReturnType<typeof setTimeout> | null = null;
let retryStep = 0;
let flushing: Promise<ReplaySummary | null> | null = null;

function scheduleRetry(): void {
  if (retryTimer !== null || typeof window === "undefined") return;
  const delay = RETRY_DELAYS_MS[Math.min(retryStep, RETRY_DELAYS_MS.length - 1)];
  retryStep += 1;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    void flushOutbox();
  }, delay);
}

/** Replay now (foreground). Coalesces concurrent calls; never throws. */
export function flushOutbox(): Promise<ReplaySummary | null> {
  if (flushing) return flushing;
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return Promise.resolve(null);
  }
  flushing = withLock(() => replayOutbox(getStore(), fetch.bind(globalThis)))
    .then((summary) => {
      if (summary.applied.length) emit({ type: "applied", applied: summary.applied });
      if (summary.sent || summary.conflicts || summary.rejected || summary.transient) emit({ type: "changed" });
      if (summary.transient) scheduleRetry();
      else retryStep = 0;
      return summary;
    })
    .catch(() => {
      scheduleRetry();
      return null;
    })
    .finally(() => {
      flushing = null;
    });
  return flushing;
}

/** Ask the browser to replay even if every tab is closed (Chromium); no-op elsewhere. */
export async function registerBackgroundSync(): Promise<void> {
  try {
    if (typeof navigator === "undefined" || !navigator.serviceWorker?.controller) return;
    const registration = (await navigator.serviceWorker.ready) as ServiceWorkerRegistration & {
      sync?: { register(tag: string): Promise<void> };
    };
    await registration.sync?.register(OUTBOX_SYNC_TAG);
  } catch {
    // Not supported or not permitted: the foreground triggers still replay.
  }
}

export async function outboxSummary(): Promise<{ entries: OutboxEntry[]; pending: number; conflicts: number; rejected: number }> {
  const entries = await listOutbox();
  return { entries, ...outboxCounts(entries) };
}
