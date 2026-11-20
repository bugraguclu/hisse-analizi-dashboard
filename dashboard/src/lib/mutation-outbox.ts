import { MutationConflictError, canonicalJson } from "./reliable-mutations.ts";

/**
 * Bounded, owner-isolated offline outbox for explicit personal JSON mutations
 * (watchlist additions/removals, stock notes and alert drafts).
 *
 * Adapted from Yemek Takibi's `mealOutbox.js`:
 * - Client retries only within `MUTATION_OUTBOX_TTL_MS` (24h); entries are
 *   retained as `expired` until `MUTATION_OUTBOX_RETENTION_MS` (48h) so the
 *   user can see what did not sync while the backend still holds idempotency keys.
 * - Strict owner isolation: switching accounts aborts any active flush, and
 *   every send verifies the live session owner first so another tab's login can
 *   never receive the previous account's queued changes.
 */

export const MUTATION_OUTBOX_TTL_MS = 24 * 60 * 60 * 1000;
export const MUTATION_OUTBOX_RETENTION_MS = 48 * 60 * 60 * 1000;
export const MUTATION_OUTBOX_MAX_ATTEMPTS = 5;
export const MUTATION_OUTBOX_MAX_ITEMS = 50;
export const MUTATION_OUTBOX_EVENT = "hisse-mutation-outbox-change";
export const MUTATION_OUTBOX_SENT_EVENT = "hisse-mutation-outbox-sent";

const STORAGE_PREFIX = "hisse.mutation-outbox:v1:";

export type PersonalMutationKind =
  | "watchlist_add"
  | "watchlist_remove"
  | "watchlist_create"
  | "watchlist_delete"
  | "note_upsert"
  | "alert_draft";

export type OutboxEntryState = "queued" | "sending" | "sent" | "failed" | "expired";

export interface PersonalMutationPayload {
  readonly requestId: string;
  readonly kind: PersonalMutationKind;
  readonly entityId: string;
  readonly baseRevision?: number;
  readonly data: Readonly<Record<string, unknown>>;
}

export interface OutboxEntry {
  readonly ownerId: string;
  readonly payload: PersonalMutationPayload;
  readonly createdAt: number;
  readonly attempts: number;
  readonly state: OutboxEntryState;
  readonly error?: string;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface OutboxFlushTransport<TResult = unknown> {
  /** Confirm the active session still belongs to `ownerId` before every write. */
  verifyOwner?: (signal: AbortSignal) => Promise<string | null>;
  /** Deliver one idempotent mutation (carrying `entry.payload.requestId`). */
  send: (entry: OutboxEntry, signal: AbortSignal) => Promise<TResult>;
}

export interface OutboxFlushResult<TResult = unknown> {
  readonly sent: Array<{ readonly requestId: string; readonly result: TResult }>;
  readonly stopped: boolean;
}

export function isRetryableMutationError(error: unknown): boolean {
  if (!error || typeof error !== "object") return true;
  const err = error as { name?: unknown; status?: unknown };
  if (err.name === "AbortError") return false;
  const status = typeof err.status === "number" ? err.status : null;
  return status === null || status === 408 || status === 429 || status >= 500;
}

function normalizeOwner(ownerId: string | null | undefined): string | null {
  if (ownerId == null) return null;
  const trimmed = String(ownerId).trim();
  return trimmed.length > 0 ? trimmed : null;
}

function defaultStorage(): StorageLike | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

export class PersonalMutationOutbox {
  private readonly storage: StorageLike | null;
  private readonly maxAttempts: number;
  private readonly maxItems: number;
  private readonly ttlMs: number;
  private readonly retentionMs: number;
  private readonly clock: () => number;
  private activeOwner: string | null = null;
  private controller: AbortController | null = null;
  private running: Promise<OutboxFlushResult<unknown>> | null = null;
  private runningOwner: string | null = null;

  constructor(options?: {
    storage?: StorageLike | null;
    maxAttempts?: number;
    maxItems?: number;
    ttlMs?: number;
    retentionMs?: number;
    now?: () => number;
  }) {
    this.storage = options?.storage === undefined ? defaultStorage() : options.storage;
    this.maxAttempts = options?.maxAttempts ?? MUTATION_OUTBOX_MAX_ATTEMPTS;
    this.maxItems = options?.maxItems ?? MUTATION_OUTBOX_MAX_ITEMS;
    this.ttlMs = options?.ttlMs ?? MUTATION_OUTBOX_TTL_MS;
    this.retentionMs = options?.retentionMs ?? MUTATION_OUTBOX_RETENTION_MS;
    this.clock = options?.now ?? (() => Date.now());
  }

  private storageKey(owner: string): string {
    return STORAGE_PREFIX + encodeURIComponent(owner);
  }

  private announce(): void {
    if (typeof window !== "undefined") {
      window.dispatchEvent(new Event(MUTATION_OUTBOX_EVENT));
    }
  }

  getOwner(): string | null {
    return this.activeOwner;
  }

  setOwner(ownerId: string | null | undefined): void {
    const next = normalizeOwner(ownerId);
    if (next !== this.activeOwner) {
      this.controller?.abort();
      this.activeOwner = next;
    }
  }

  read(ownerId: string | null | undefined, now = this.clock()): OutboxEntry[] {
    const owner = normalizeOwner(ownerId);
    if (!owner || owner !== this.activeOwner || !this.storage) return [];
    try {
      const raw = this.storage.getItem(this.storageKey(owner)) || "[]";
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];

      const retained: OutboxEntry[] = [];
      for (const item of parsed) {
        if (!item || typeof item !== "object") continue;
        const row = item as Partial<OutboxEntry>;
        if (
          row.ownerId !== owner ||
          !row.payload?.requestId ||
          !row.payload?.kind ||
          !row.payload?.entityId ||
          !Number.isFinite(row.createdAt)
        ) {
          continue;
        }
        const age = now - (row.createdAt as number);
        if (age >= this.retentionMs) continue;
        const expired = age >= this.ttlMs && (row.state === "queued" || row.state === "sending");
        retained.push({
          ownerId: owner,
          payload: row.payload as PersonalMutationPayload,
          createdAt: row.createdAt as number,
          attempts: Number.isFinite(row.attempts) ? (row.attempts as number) : 0,
          state: expired ? "expired" : (row.state ?? "queued"),
          ...(row.error ? { error: row.error } : {}),
        });
      }

      const serialized = JSON.stringify(retained);
      if (serialized !== raw) {
        this.storage.setItem(this.storageKey(owner), serialized);
        if (typeof window !== "undefined") queueMicrotask(() => this.announce());
      }
      return retained;
    } catch {
      return [];
    }
  }

  private write(owner: string, rows: readonly OutboxEntry[]): void {
    if (!this.storage) return;
    this.storage.setItem(this.storageKey(owner), JSON.stringify(rows));
    this.announce();
  }

  enqueue(ownerId: string | null | undefined, payload: PersonalMutationPayload, now = this.clock()): OutboxEntry {
    const owner = normalizeOwner(ownerId);
    if (!owner || owner !== this.activeOwner) {
      throw new Error("Bu hesap için çevrimdışı değişiklik kuyruğu kullanılamıyor.");
    }
    if (!payload.requestId.trim() || !payload.entityId.trim()) {
      throw new Error("Geçersiz değişiklik kaydı.");
    }

    const rows = this.read(owner, now);
    const existing = rows.find((row) => row.payload.requestId === payload.requestId);
    if (existing) {
      if (canonicalJson(existing.payload) !== canonicalJson(payload)) {
        throw new MutationConflictError("Aynı istek kimliğiyle farklı bir değişiklik kuyruğa eklenemez.", "request_conflict");
      }
      return existing;
    }

    const activeCount = rows.filter((row) => row.state === "queued" || row.state === "sending").length;
    if (activeCount >= this.maxItems) {
      throw new Error("Çevrimdışı değişiklik kuyruğu dolu; lütfen bağlantı kurulunca senkronize edin.");
    }

    const entry: OutboxEntry = {
      ownerId: owner,
      payload: JSON.parse(JSON.stringify(payload)) as PersonalMutationPayload,
      createdAt: now,
      attempts: 0,
      state: "queued",
    };
    this.write(owner, [...rows, entry]);
    return entry;
  }

  clear(ownerId: string | null | undefined): void {
    const owner = normalizeOwner(ownerId);
    if (!owner || !this.storage) return;
    if (owner === this.activeOwner) this.controller?.abort();
    this.storage.removeItem(this.storageKey(owner));
    this.announce();
  }

  async flush<TResult = unknown>(
    ownerId: string | null | undefined,
    transport: OutboxFlushTransport<TResult>,
  ): Promise<OutboxFlushResult<TResult>> {
    const owner = normalizeOwner(ownerId);
    if (!owner || owner !== this.activeOwner) return { sent: [], stopped: true };
    if (this.running) {
      if (this.runningOwner === owner) return this.running as Promise<OutboxFlushResult<TResult>>;
      await this.running;
      return this.flush(ownerId, transport);
    }

    const taskController = new AbortController();
    this.controller = taskController;
    const isCurrent = () => owner === this.activeOwner && !taskController.signal.aborted;

    const task = (async (): Promise<OutboxFlushResult<TResult>> => {
      const sent: Array<{ requestId: string; result: TResult }> = [];
      for (const row of this.read(owner)) {
        if (!isCurrent()) break;
        if (row.state !== "queued" || row.attempts >= this.maxAttempts) continue;

        try {
          if (transport.verifyOwner) {
            const verified = normalizeOwner(await transport.verifyOwner(taskController.signal));
            if (!isCurrent()) break;
            if (verified !== owner) {
              this.setOwner(null);
              break;
            }
          }

          this.write(
            owner,
            this.read(owner).map((entry) =>
              entry.payload.requestId === row.payload.requestId ? { ...entry, state: "sending" } : entry,
            ),
          );

          const result = await transport.send(row, taskController.signal);
          if (!isCurrent()) break;

          this.write(
            owner,
            this.read(owner).filter((entry) => entry.payload.requestId !== row.payload.requestId),
          );
          sent.push({ requestId: row.payload.requestId, result });
          if (typeof window !== "undefined") {
            window.dispatchEvent(
              new CustomEvent(MUTATION_OUTBOX_SENT_EVENT, {
                detail: { ownerId: owner, requestId: row.payload.requestId, result },
              }),
            );
          }
        } catch (error) {
          if (!isCurrent() || (error instanceof Error && error.name === "AbortError")) break;
          const attempts = row.attempts + 1;
          const retry = isRetryableMutationError(error) && attempts < this.maxAttempts;
          const message = error instanceof Error ? error.message : String(error);
          const status = typeof (error as { status?: unknown })?.status === "number"
            ? (error as { status: number }).status
            : null;
          this.write(
            owner,
            this.read(owner).map((entry) =>
              entry.payload.requestId === row.payload.requestId
                ? { ...entry, attempts, state: retry ? "queued" : "failed", error: message }
                : entry,
            ),
          );
          if (retry || status === 401 || status === 403) break;
        }
      }
      return { sent, stopped: !isCurrent() };
    })();

    this.running = task as Promise<OutboxFlushResult<unknown>>;
    this.runningOwner = owner;
    try {
      return await task;
    } finally {
      if (this.running === task) {
        this.running = null;
        this.runningOwner = null;
      }
      if (this.controller === taskController) this.controller = null;
    }
  }
}

export const personalMutationOutbox = new PersonalMutationOutbox();
