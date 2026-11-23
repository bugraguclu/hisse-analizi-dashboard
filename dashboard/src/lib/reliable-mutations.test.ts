import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createUndoReceipt, evaluateUndo } from "./reliable-mutations.ts";

describe("conflict-checked undo", () => {
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
