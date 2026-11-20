import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  IdempotentRequestTracker,
  MutationConflictError,
  createUndoReceipt,
  evaluateUndo,
} from "./reliable-mutations.ts";
import {
  MUTATION_OUTBOX_RETENTION_MS,
  MUTATION_OUTBOX_TTL_MS,
  PersonalMutationOutbox,
  isRetryableMutationError,
  type StorageLike,
} from "./mutation-outbox.ts";

class MemoryStorage implements StorageLike {
  private readonly map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
}

describe("reliable mutations: idempotency & conflict-checked undo", () => {
  it("deduplicates identical retries and rejects conflicting payloads on the same requestId", () => {
    const tracker = new IdempotentRequestTracker<{ id: string }>();
    let executions = 0;

    const first = tracker.run("req-alpha-01", { ticker: "THYAO", listId: "favorites" }, () => {
      executions += 1;
      return { id: `created-${executions}` };
    });
    assert.equal(first.replayed, false);
    assert.equal(first.result.id, "created-1");

    // Reordered keys, identical content -> replayed without executing mutator again.
    const second = tracker.run("req-alpha-01", { listId: "favorites", ticker: "THYAO" }, () => {
      executions += 1;
      return { id: `created-${executions}` };
    });
    assert.equal(second.replayed, true);
    assert.equal(second.result.id, "created-1");
    assert.equal(executions, 1);

    // Same requestId, different payload -> conflict error.
    assert.throws(
      () => tracker.run("req-alpha-01", { listId: "favorites", ticker: "GARAN" }, () => ({ id: "never" })),
      MutationConflictError,
    );
  });

  it("allows undo only when owner, window, revision and snapshot still match", () => {
    const t0 = 1_700_000_000_000;
    const receipt = createUndoReceipt({
      id: "undo-1",
      ownerId: "user-1",
      entityId: "favorites",
      beforeRevision: 1,
      afterRevision: 2,
      beforeSnapshot: { tickers: ["THYAO", "GARAN"] },
      afterSnapshot: { tickers: ["GARAN"] },
      now: t0,
      windowMs: 60_000,
    });

    // Safe undo
    const ok = evaluateUndo({
      receipt,
      activeOwnerId: "user-1",
      currentRevision: 2,
      currentSnapshot: { tickers: ["GARAN"] },
      now: t0 + 10_000,
    });
    assert.deepEqual(ok, { ok: true, restoreSnapshot: { tickers: ["THYAO", "GARAN"] } });

    // Newer revision from another device/tab -> conflict, never overwrites newer edit.
    const conflict = evaluateUndo({
      receipt,
      activeOwnerId: "user-1",
      currentRevision: 3,
      currentSnapshot: { tickers: ["GARAN", "SISE"] },
      now: t0 + 15_000,
    });
    assert.deepEqual(conflict, { ok: false, reason: "conflict" });

    // Owner switched -> owner_mismatch.
    const wrongOwner = evaluateUndo({
      receipt,
      activeOwnerId: "user-2",
      currentRevision: 2,
      currentSnapshot: { tickers: ["GARAN"] },
      now: t0 + 15_000,
    });
    assert.deepEqual(wrongOwner, { ok: false, reason: "owner_mismatch" });

    // Window elapsed -> expired.
    const expired = evaluateUndo({
      receipt,
      activeOwnerId: "user-1",
      currentRevision: 2,
      currentSnapshot: { tickers: ["GARAN"] },
      now: t0 + 61_000,
    });
    assert.deepEqual(expired, { ok: false, reason: "expired" });
  });
});

describe("PersonalMutationOutbox (bounded offline queue)", () => {
  it("keeps queued entries across network drops and applies once when online", async () => {
    let clock = 1_700_000_000_000;
    const storage = new MemoryStorage();
    const outbox = new PersonalMutationOutbox({ storage, now: () => clock });
    outbox.setOwner("user-a");

    const payload = {
      requestId: "mut-001",
      kind: "watchlist_add" as const,
      entityId: "favorites",
      baseRevision: 1,
      data: { ticker: "ASELS" },
    };
    const row = outbox.enqueue("user-a", payload);
    assert.equal(row.state, "queued");
    // Re-enqueuing identical requestId is idempotent.
    assert.equal(outbox.enqueue("user-a", payload).payload.requestId, "mut-001");
    assert.equal(outbox.read("user-a").length, 1);

    // Different payload with same requestId throws conflict.
    assert.throws(
      () => outbox.enqueue("user-a", { ...payload, data: { ticker: "EREGL" } }),
      MutationConflictError,
    );

    // First flush fails with 503 (retryable) -> stays queued with attempts = 1.
    let calls = 0;
    const failed = await outbox.flush("user-a", {
      verifyOwner: async () => "user-a",
      send: async () => {
        calls += 1;
        const err = new Error("Upstream down") as Error & { status: number };
        err.status = 503;
        throw err;
      },
    });
    assert.equal(failed.sent.length, 0);
    assert.equal(calls, 1);
    assert.equal(outbox.read("user-a")[0]?.state, "queued");
    assert.equal(outbox.read("user-a")[0]?.attempts, 1);

    // Second flush succeeds -> applied once and removed from outbox.
    const ok = await outbox.flush("user-a", {
      verifyOwner: async () => "user-a",
      send: async (entry) => {
        calls += 1;
        return { applied: entry.payload.requestId };
      },
    });
    assert.equal(ok.sent.length, 1);
    assert.equal(ok.sent[0]?.requestId, "mut-001");
    assert.equal(calls, 2);
    assert.equal(outbox.read("user-a").length, 0);

    // Advance clock to test TTL expiry (24h) and retention eviction (48h).
    outbox.enqueue("user-a", { ...payload, requestId: "mut-002" });
    clock += MUTATION_OUTBOX_TTL_MS + 1_000;
    assert.equal(outbox.read("user-a")[0]?.state, "expired");
    clock += MUTATION_OUTBOX_RETENTION_MS;
    assert.equal(outbox.read("user-a").length, 0);
  });

  it("refuses to send queued mutations when session owner changed in another tab", async () => {
    const storage = new MemoryStorage();
    const outbox = new PersonalMutationOutbox({ storage });
    outbox.setOwner("user-a");
    outbox.enqueue("user-a", {
      requestId: "mut-cross-account",
      kind: "alert_draft",
      entityId: "THYAO",
      data: { threshold: 350 },
    });

    let sentCount = 0;
    const result = await outbox.flush("user-a", {
      verifyOwner: async () => "user-b",
      send: async () => {
        sentCount += 1;
        return {};
      },
    });

    assert.equal(sentCount, 0);
    assert.equal(result.stopped, true);
    assert.equal(outbox.getOwner(), null);
  });

  it("classifies retryable vs permanent errors accurately", () => {
    assert.equal(isRetryableMutationError({ status: 503 }), true);
    assert.equal(isRetryableMutationError({ status: 408 }), true);
    assert.equal(isRetryableMutationError({ status: 429 }), true);
    assert.equal(isRetryableMutationError(new TypeError("Failed to fetch")), true);
    assert.equal(isRetryableMutationError({ status: 409 }), false);
    assert.equal(isRetryableMutationError({ status: 401 }), false);
    assert.equal(isRetryableMutationError({ name: "AbortError" }), false);
  });
});
