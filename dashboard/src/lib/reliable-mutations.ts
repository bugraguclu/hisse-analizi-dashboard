/**
 * Client-side reliable mutation helpers:
 * - Idempotent request ledger (prevents duplicate records when a response drops or retries fire).
 * - Revision- and snapshot-checked undo (prevents an old undo toast from clobbering edits made
 *   later in the same session, another tab, or another device).
 */

export const DEFAULT_UNDO_WINDOW_MS = 15 * 60 * 1000;

export class MutationConflictError extends Error {
  readonly code: "request_conflict" | "undo_conflict";

  constructor(message: string, code: "request_conflict" | "undo_conflict" = "request_conflict") {
    super(message);
    this.name = "MutationConflictError";
    this.code = code;
  }
}

export interface UndoReceipt<TSnapshot> {
  readonly id: string;
  readonly ownerId: string;
  readonly entityId: string;
  readonly beforeRevision: number;
  readonly afterRevision: number;
  readonly beforeSnapshot: TSnapshot;
  readonly afterSnapshot: TSnapshot;
  readonly createdAt: number;
  readonly expiresAt: number;
}

export type UndoDecision<TSnapshot> =
  | { readonly ok: true; readonly restoreSnapshot: TSnapshot }
  | { readonly ok: false; readonly reason: "owner_mismatch" | "expired" | "conflict" };

/**
 * Deterministic structural equality via sorted-key JSON serialization.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
}

export function createUndoReceipt<TSnapshot>(input: {
  id: string;
  ownerId: string;
  entityId: string;
  beforeRevision: number;
  afterRevision: number;
  beforeSnapshot: TSnapshot;
  afterSnapshot: TSnapshot;
  now?: number;
  windowMs?: number;
}): UndoReceipt<TSnapshot> {
  const createdAt = input.now ?? Date.now();
  return {
    id: input.id,
    ownerId: input.ownerId,
    entityId: input.entityId,
    beforeRevision: input.beforeRevision,
    afterRevision: input.afterRevision,
    beforeSnapshot: input.beforeSnapshot,
    afterSnapshot: input.afterSnapshot,
    createdAt,
    expiresAt: createdAt + (input.windowMs ?? DEFAULT_UNDO_WINDOW_MS),
  };
}

/**
 * Evaluates whether an undo action is still safe to apply:
 * 1. Owner must still match (account switch never writes into another account).
 * 2. Undo window must not have expired.
 * 3. Current entity revision & snapshot must still match the state left by the original change.
 */
export function evaluateUndo<TSnapshot>(input: {
  receipt: UndoReceipt<TSnapshot>;
  activeOwnerId: string;
  currentRevision: number | null;
  currentSnapshot: TSnapshot | null;
  equals?: (current: TSnapshot | null, expected: TSnapshot) => boolean;
  now?: number;
}): UndoDecision<TSnapshot> {
  const now = input.now ?? Date.now();
  if (input.receipt.ownerId !== input.activeOwnerId) {
    return { ok: false, reason: "owner_mismatch" };
  }
  if (now > input.receipt.expiresAt) {
    return { ok: false, reason: "expired" };
  }
  if (input.currentRevision !== input.receipt.afterRevision) {
    return { ok: false, reason: "conflict" };
  }
  const same = input.equals
    ? input.equals(input.currentSnapshot, input.receipt.afterSnapshot)
    : canonicalJson(input.currentSnapshot) === canonicalJson(input.receipt.afterSnapshot);
  if (!same) {
    return { ok: false, reason: "conflict" };
  }
  return { ok: true, restoreSnapshot: input.receipt.beforeSnapshot };
}

interface CompletedEntry<TResult> {
  readonly payloadKey: string;
  readonly result: TResult;
  readonly recordedAt: number;
}

/**
 * Deduplicates retried client mutations by `requestId`.
 * Re-submitting the same `requestId` with the identical payload returns the
 * original result without executing the mutator again; reusing the same
 * `requestId` with a different payload throws `MutationConflictError`.
 */
export class IdempotentRequestTracker<TResult> {
  private readonly maxEntries: number;
  private readonly ttlMs: number;
  private readonly entries = new Map<string, CompletedEntry<TResult>>();

  constructor(options?: { maxEntries?: number; ttlMs?: number }) {
    this.maxEntries = options?.maxEntries ?? 200;
    this.ttlMs = options?.ttlMs ?? 24 * 60 * 60 * 1000;
  }

  private prune(now: number): void {
    for (const [key, entry] of this.entries) {
      if (now - entry.recordedAt >= this.ttlMs) this.entries.delete(key);
    }
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }

  run(requestId: string | undefined, payload: unknown, execute: () => TResult, now = Date.now()): { result: TResult; replayed: boolean } {
    if (!requestId) return { result: execute(), replayed: false };
    this.prune(now);
    const payloadKey = canonicalJson(payload);
    const existing = this.entries.get(requestId);
    if (existing) {
      if (existing.payloadKey !== payloadKey) {
        throw new MutationConflictError("İstek kimliği farklı bir içerikle zaten kullanıldı.", "request_conflict");
      }
      return { result: existing.result, replayed: true };
    }
    const result = execute();
    this.entries.set(requestId, { payloadKey, result, recordedAt: now });
    return { result, replayed: false };
  }

  clear(): void {
    this.entries.clear();
  }
}
