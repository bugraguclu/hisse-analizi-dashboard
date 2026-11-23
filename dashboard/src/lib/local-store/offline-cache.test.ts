import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  buildOfflineWatchlistSnapshot,
  clearOfflineSummary,
  evaluateOfflineFreshness,
  latestExpectedBistSessionDateKey,
  mergeOfflineSummary,
  parseOfflineSummary,
  readOfflineSummary,
} from "./offline-cache.ts";
import { WATCHLISTS_STORAGE_KEY } from "./schema.ts";
import { createMemoryStorage } from "./storage.ts";

describe("offline market summary cache", () => {
  test("ignores corrupt cached rows that would crash market cards on reload", () => {
    const cached = parseOfflineSummary(JSON.stringify({
      version: 1, updatedAt: 1,
      watchlistQuotes: { THYAO: { quote: { last_price: "invalid" }, savedAt: 1 } },
      indices: { quotes: [null, { symbol: "XU100", last: 10000, change_percent: 1 }], savedAt: 1 },
      latestEvents: { items: [null, { id: "event-1" }], savedAt: 1 },
      macroMarkets: { instruments: [null], savedAt: 1 },
      breadth: { data: {}, savedAt: 1 },
    }));
    assert.deepEqual(cached?.watchlistQuotes, {});
    assert.equal(cached?.indices?.quotes.length, 1);
    assert.equal(cached?.latestEvents?.items.length, 1);
    assert.deepEqual(cached?.macroMarkets?.instruments, []);
    assert.equal(cached?.breadth, undefined);
  });
  test("persists and merges per-ticker quotes across watchlists, indices, events and breadth", () => {
    const storage = createMemoryStorage({
      [WATCHLISTS_STORAGE_KEY]: JSON.stringify([{ id: "favorites", name: "", items: [{ ticker: "THYAO" }] }]),
    });

    const t1 = Date.parse("2026-11-20T15:05:00Z"); // Friday 18:05 Istanbul
    mergeOfflineSummary(
      {
        indices: {
          source: "borsapy",
          quotes: [
            {
              symbol: "XU100",
              last: 10250.4,
              change: 112.5,
              change_percent: 1.11,
              open: 10140,
              high: 10280,
              low: 10120,
              prev_close: 10137.9,
              volume: 120_000_000,
              timestamp: Math.floor(t1 / 1000),
            },
          ],
        },
        snapshot: {
          symbols: ["THYAO", "GARAN"],
          snapshot: {
            THYAO: {
              last_price: 312.5,
              open: 308,
              day_high: 315,
              day_low: 307,
              previous_close: 309,
              change_percent: 1.13,
              volume: 5_000_000,
              market_cap: 430_000_000_000,
            },
            GARAN: {
              last_price: 122.4,
              open: 120,
              day_high: 123,
              day_low: 119.5,
              previous_close: 120.2,
              change_percent: 1.83,
              volume: 4_000_000,
              market_cap: 514_000_000_000,
            },
          },
        },
      },
      { storage, nowMs: t1, mirrorToIdb: false },
    );

    // Second watchlist fetched later merges without wiping THYAO/GARAN
    const t2 = Date.parse("2026-11-20T15:10:00Z");
    mergeOfflineSummary(
      {
        snapshot: {
          symbols: ["ASELS"],
          snapshot: {
            ASELS: {
              last_price: 88.2,
              open: 86,
              day_high: 89,
              day_low: 85.5,
              previous_close: 86.5,
              change_percent: 1.97,
              volume: 3_000_000,
              market_cap: 400_000_000_000,
            },
          },
        },
        latestEvents: [
          {
            id: "ev-1",
            event_type: "KAP_DISCLOSURE",
            title: "Temettü Kararı",
            source_code: "kap",
            severity: "HIGH",
            is_notifiable: true,
            ticker: "THYAO",
            created_at: "2026-11-20T14:55:00Z",
          },
        ],
      },
      { storage, nowMs: t2, mirrorToIdb: false },
    );

    // Simulate cold reopen by reading directly from storage
    const restored = readOfflineSummary(storage);
    assert.ok(restored);
    assert.equal(restored.updatedAt, t2);
    assert.equal(restored.indices?.quotes[0].symbol, "XU100");
    assert.equal(restored.latestEvents?.items.length, 1);

    const listA = buildOfflineWatchlistSnapshot(restored, ["THYAO", "ASELS"]);
    assert.ok(listA);
    assert.equal(listA.coveredCount, 2);
    assert.equal(listA.snapshot.snapshot.THYAO?.last_price, 312.5);
    assert.equal(listA.snapshot.snapshot.ASELS?.last_price, 88.2);
    assert.equal(listA.oldestSavedAt, t1);
    assert.equal(listA.newestSavedAt, t2);

    // Clearing offline cache never removes personal watchlists
    clearOfflineSummary(storage);
    assert.equal(readOfflineSummary(storage), null);
    assert.ok(storage.getItem(WATCHLISTS_STORAGE_KEY));
  });
});

describe("BIST session-aware freshness rules", () => {
  test("Friday 18:10 close viewed offline on Sunday stays same-session and not stale", () => {
    const storage = createMemoryStorage();
    const fridayClose = Date.parse("2026-11-20T15:10:00Z"); // 18:10 Istanbul, Friday
    const summary = mergeOfflineSummary(
      {
        indices: {
          quotes: [
            {
              symbol: "XU100",
              last: 10250,
              change: 50,
              change_percent: 0.49,
              open: 10200,
              high: 10270,
              low: 10180,
              prev_close: 10200,
              volume: 100_000,
              timestamp: Math.floor(fridayClose / 1000),
            },
          ],
        },
      },
      { storage, nowMs: fridayClose, mirrorToIdb: false },
    );

    const sundayAfternoon = Date.parse("2026-11-22T12:00:00Z"); // Sunday 15:00 Istanbul
    assert.equal(latestExpectedBistSessionDateKey(sundayAfternoon), "2026-11-20");

    const freshness = evaluateOfflineFreshness(summary, sundayAfternoon, false);
    assert.equal(freshness.state, "cached-offline");
    assert.equal(freshness.sameSession, true);
    assert.equal(freshness.staleDuringSession, false);
    assert.equal(freshness.marketPhase, "weekend");
  });

  test("Monday mid-session treats Friday close or >20m old intraday cache as stale", () => {
    const storage = createMemoryStorage();
    const fridayClose = Date.parse("2026-11-20T15:10:00Z");
    const fridaySummary = mergeOfflineSummary(
      {
        indices: {
          quotes: [
            {
              symbol: "XU100",
              last: 10250,
              change: 50,
              change_percent: 0.49,
              open: 10200,
              high: 10270,
              low: 10180,
              prev_close: 10200,
              volume: 100_000,
              timestamp: Math.floor(fridayClose / 1000),
            },
          ],
        },
      },
      { storage, nowMs: fridayClose, mirrorToIdb: false },
    );

    // Monday 10:15 Istanbul (07:15 UTC) — inside open grace period, session is open
    const mondayMorning = Date.parse("2026-11-23T07:15:00Z");
    const fromFriday = evaluateOfflineFreshness(fridaySummary, mondayMorning, false);
    assert.equal(fromFriday.sameSession, false);
    assert.equal(fromFriday.staleDuringSession, true);
    assert.equal(fromFriday.state, "cached-stale");

    // Monday 11:00 Istanbul (08:00 UTC) snapshot viewed 5 min later vs 35 min later
    const mondayQuote = Date.parse("2026-11-23T08:00:00Z");
    const mondaySummary = mergeOfflineSummary(
      {
        indices: {
          quotes: [
            {
              symbol: "XU100",
              last: 10310,
              change: 60,
              change_percent: 0.58,
              open: 10260,
              high: 10320,
              low: 10240,
              prev_close: 10250,
              volume: 100_000,
              timestamp: Math.floor(mondayQuote / 1000),
            },
          ],
        },
      },
      { storage, nowMs: mondayQuote, mirrorToIdb: false },
    );

    const fiveMinLater = evaluateOfflineFreshness(mondaySummary, mondayQuote + 5 * 60_000, false);
    assert.equal(fiveMinLater.sameSession, true);
    assert.equal(fiveMinLater.staleDuringSession, false);
    assert.equal(fiveMinLater.state, "cached-offline");

    const thirtyFiveMinLater = evaluateOfflineFreshness(mondaySummary, mondayQuote + 35 * 60_000, false);
    assert.equal(thirtyFiveMinLater.sameSession, true);
    assert.equal(thirtyFiveMinLater.staleDuringSession, true);
    assert.equal(thirtyFiveMinLater.state, "cached-stale");
  });

  test("offline with no cached summary returns empty-offline", () => {
    const freshness = evaluateOfflineFreshness(null, Date.parse("2026-11-20T12:00:00Z"), false);
    assert.equal(freshness.state, "empty-offline");
    assert.equal(freshness.hasData, false);
  });
});
