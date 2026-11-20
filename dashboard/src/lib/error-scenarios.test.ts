import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { readDataMeta, sourceName } from "./data-meta.ts";
import { getMarketStatus } from "./market-hours.ts";
import { PersonalMutationOutbox, isRetryableMutationError, type StorageLike } from "./mutation-outbox.ts";
import { createUndoReceipt, evaluateUndo } from "./reliable-mutations.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = path.resolve(__dirname, "../../../tests/fixtures/market_error_scenarios.json");
const FIXTURE = JSON.parse(fs.readFileSync(FIXTURE_PATH, "utf8")) as {
  schemaVersion: number;
  scenarios: Record<string, Record<string, unknown>>;
};

class MemoryStorage implements StorageLike {
  private readonly store = new Map<string, string>();
  getItem(key: string): string | null {
    return this.store.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
}

describe("shared market & error scenarios fixture (web verification)", () => {
  it("computes open, after-close and weekend session phases deterministically", () => {
    const open = FIXTURE.scenarios.session_open_fresh as {
      clock: string;
      expectedPhase: string;
      expectedIsOpen: boolean;
      snapshot: { snapshot: { THYAO: { updated_at: string } }; meta: unknown };
    };
    const openStatus = getMarketStatus(new Date(open.clock), new Date(open.snapshot.snapshot.THYAO.updated_at));
    assert.equal(openStatus.phase, open.expectedPhase);
    assert.equal(openStatus.isOpen, open.expectedIsOpen);

    const closed = FIXTURE.scenarios.session_closed_last_close as {
      afterCloseClock: string;
      expectedAfterClosePhase: string;
      weekendClock: string;
      expectedWeekendPhase: string;
    };
    assert.equal(getMarketStatus(new Date(closed.afterCloseClock)).phase, closed.expectedAfterClosePhase);
    assert.equal(getMarketStatus(new Date(closed.weekendClock)).phase, closed.expectedWeekendPhase);
  });

  it("interprets stale price fallback metadata identically to backend", () => {
    const stale = FIXTURE.scenarios.stale_price_provider_down as { snapshot: unknown };
    const meta = readDataMeta(stale.snapshot);
    assert.ok(meta);
    assert.equal(meta.stale, true);
    assert.equal(meta.servedFrom, "stale");
    assert.equal(meta.asOf, "2026-11-18");
    assert.equal(sourceName(meta.source), "TradingView");
    assert.equal(meta.notes[0], "Sağlayıcıya ulaşılamadı; son kayıtlı veri");
  });

  it("handles missing balance sheet and empty watchlist without throwing", () => {
    const missing = FIXTURE.scenarios.missing_balance_sheet as {
      balanceSheet: { statements: unknown[]; meta: unknown };
    };
    assert.equal(missing.balanceSheet.statements.length, 0);
    const meta = readDataMeta(missing.balanceSheet);
    assert.ok(meta);
    assert.equal(meta.stale, false);
    assert.equal(meta.asOf, null);
    assert.equal(sourceName(meta.source), "KAP + İş Yatırım");

    const emptyList = FIXTURE.scenarios.empty_watchlist as { tickers: string[]; expectedSnapshotRequests: number };
    assert.equal(emptyList.tickers.length, 0);
    assert.equal(emptyList.expectedSnapshotRequests, 0);
  });

  it("classifies provider disconnect errors consistently for retry policy", () => {
    const disconnect = FIXTURE.scenarios.provider_disconnected as {
      errors: Array<{ kind: string; status: number | null; code: string; retryable: boolean }>;
    };
    for (const err of disconnect.errors) {
      assert.equal(
        isRetryableMutationError({ status: err.status }),
        err.retryable,
        `mismatch for disconnect error ${err.kind}`,
      );
    }
  });

  it("replays a dropped-response retry once and rejects dual-device stale undo", async () => {
    const conflict = FIXTURE.scenarios.dual_device_conflict_and_retry as {
      ownerId: string;
      otherOwnerId: string;
      entityId: string;
      requestId: string;
      initialRevision: number;
      deviceADeleteRevision: number;
      deviceBEditRevision: number;
      initialTickers: string[];
      afterDeviceARemoveTickers: string[];
      afterDeviceBAddTickers: string[];
    };

    const outbox = new PersonalMutationOutbox({ storage: new MemoryStorage() });
    outbox.setOwner(conflict.ownerId);
    outbox.enqueue(conflict.ownerId, {
      requestId: conflict.requestId,
      kind: "watchlist_remove",
      entityId: conflict.entityId,
      baseRevision: conflict.initialRevision,
      data: { tickers: conflict.afterDeviceARemoveTickers },
    });

    // Dropped response on attempt 1, then idempotent replay on attempt 2 -> single server write.
    const serverApplied = new Map<string, number>();
    let attempt = 0;
    const first = await outbox.flush(conflict.ownerId, {
      verifyOwner: async () => conflict.ownerId,
      send: async (entry) => {
        attempt += 1;
        serverApplied.set(entry.payload.requestId, (serverApplied.get(entry.payload.requestId) ?? 0) + 1);
        if (attempt === 1) throw new TypeError("Failed to fetch");
        return { revision: conflict.deviceADeleteRevision };
      },
    });
    assert.equal(first.sent.length, 0);
    assert.equal(outbox.read(conflict.ownerId).length, 1);

    const second = await outbox.flush(conflict.ownerId, {
      verifyOwner: async () => conflict.ownerId,
      send: async (entry) => {
        // Server deduplicates by requestId (does not increment distinct records).
        if (!serverApplied.has(entry.payload.requestId)) {
          serverApplied.set(entry.payload.requestId, 1);
        }
        return { revision: conflict.deviceADeleteRevision, replayed: true };
      },
    });
    assert.equal(second.sent.length, 1);
    assert.equal(serverApplied.size, 1);
    assert.equal(outbox.read(conflict.ownerId).length, 0);

    // Device B edits the list to revision 3 -> Device A's undo receipt for revision 2 conflicts!
    const receipt = createUndoReceipt({
      id: "undo-device-a",
      ownerId: conflict.ownerId,
      entityId: conflict.entityId,
      beforeRevision: conflict.initialRevision,
      afterRevision: conflict.deviceADeleteRevision,
      beforeSnapshot: { tickers: conflict.initialTickers },
      afterSnapshot: { tickers: conflict.afterDeviceARemoveTickers },
    });
    const decision = evaluateUndo({
      receipt,
      activeOwnerId: conflict.ownerId,
      currentRevision: conflict.deviceBEditRevision,
      currentSnapshot: { tickers: conflict.afterDeviceBAddTickers },
    });
    assert.deepEqual(decision, { ok: false, reason: "conflict" });

    // Switching account also blocks undo.
    const otherOwnerDecision = evaluateUndo({
      receipt,
      activeOwnerId: conflict.otherOwnerId,
      currentRevision: conflict.deviceADeleteRevision,
      currentSnapshot: { tickers: conflict.afterDeviceARemoveTickers },
    });
    assert.deepEqual(otherOwnerDecision, { ok: false, reason: "owner_mismatch" });
  });
});
