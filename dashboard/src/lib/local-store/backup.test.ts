import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  BackupValidationError,
  KEEP_PRE_RESTORE,
  createLocalRestorePoint,
  exportWorkspaceBackup,
  importWorkspaceBackup,
  listRestorePoints,
  restoreFromArchive,
  validateWorkspaceBackup,
} from "./backup.ts";
import { createMemoryArchiveStore } from "./idb.ts";
import {
  CALENDAR_COUNTRIES_STORAGE_KEY,
  COST_STORAGE_PREFIX,
  DRAWINGS_STORAGE_PREFIX,
  HOME_LAYOUT_STORAGE_KEY,
  LOCAL_STORE_META_KEY,
  LOCALE_STORAGE_KEY,
  MARKET_STRIP_PAUSED_STORAGE_KEY,
  MAX_BACKUP_BYTES,
  THEME_STORAGE_KEY,
  WATCHLISTS_STORAGE_KEY,
  WORKSPACE_BACKUP_FORMAT,
  WORKSPACE_SCHEMA_VERSION,
  migrateLocalStorage,
  readWorkspaceData,
} from "./schema.ts";
import { createMemoryStorage, type StorageAdapter } from "./storage.ts";

function populatedStorage(): StorageAdapter {
  return createMemoryStorage({
    [WATCHLISTS_STORAGE_KEY]: JSON.stringify([
      { id: "favorites", name: "", items: [{ ticker: "THYAO" }, { ticker: "GARAN" }] },
      { id: "list-temettu", name: "Temettü", items: [{ ticker: "FROTO" }, { ticker: "TUPRS" }] },
    ]),
    [HOME_LAYOUT_STORAGE_KEY]: JSON.stringify({
      version: 1,
      items: [
        { id: "index", x: 0, y: 0, w: 4, h: 15 },
        { id: "watchlist", x: 4, y: 0, w: 2, h: 12 },
      ],
    }),
    "hisse.layout.macro": JSON.stringify({
      version: 1,
      items: [{ id: "kpi", x: 0, y: 0, w: 6, h: 4 }],
    }),
    "hisse.chart.overview.v2": JSON.stringify({
      type: "candles",
      volume: true,
      indicators: [{ id: "sma-20", kind: "sma", params: { length: 20 }, color: 0 }],
      scale: "log",
      unit: "USD",
    }),
    [`${DRAWINGS_STORAGE_PREFIX}THYAO`]: JSON.stringify({
      v: 1,
      items: [
        { id: "d1", kind: "hline", points: [{ time: 1700000000, price: 310.5 }], color: 1 },
        {
          id: "d2",
          kind: "trend",
          points: [
            { time: 1700000000, price: 290 },
            { time: 1700500000, price: 325 },
          ],
          color: 0,
          dashed: true,
        },
      ],
    }),
    [`${COST_STORAGE_PREFIX}THYAO`]: "285.4",
    [CALENDAR_COUNTRIES_STORAGE_KEY]: JSON.stringify(["TR", "US", "EU"]),
    [MARKET_STRIP_PAUSED_STORAGE_KEY]: "1",
    [LOCALE_STORAGE_KEY]: "tr",
    [THEME_STORAGE_KEY]: "dark",
    "hisse.legalNotice.v1": "1",
  });
}

describe("migrateLocalStorage", () => {
  test("promotes legacy v1 chart prefs without losing indicator choices and stamps meta", () => {
    const storage = createMemoryStorage({
      "hisse.chart.overview.v1": JSON.stringify({
        type: "candles",
        overlays: ["ma20", "bb"],
        panes: ["rsi"],
        currency: "USD",
      }),
      "hisse.layout.broken": "{corrupt json",
      [WATCHLISTS_STORAGE_KEY]: JSON.stringify([{ id: "favorites", name: "Favoriler", items: [{ ticker: "ASELS" }] }]),
    });

    const result = migrateLocalStorage(storage, new Date("2026-11-20T09:00:00Z"));
    assert.equal(result.migrated, true);
    assert.equal(result.fromVersion, 0);
    assert.deepEqual(result.upgradedChartKeys, ["hisse.chart.overview.v2"]);
    assert.deepEqual(result.repairedKeys, ["hisse.layout.broken"]);

    const migratedPrefs = JSON.parse(storage.getItem("hisse.chart.overview.v2") ?? "{}");
    assert.equal(migratedPrefs.type, "candles");
    assert.equal(migratedPrefs.unit, "USD");
    assert.equal(migratedPrefs.indicators.length, 3);

    // Valid watchlists remain intact; corrupt layout was cleaned without deleting valid entries
    const data = readWorkspaceData(storage);
    assert.equal(data.watchlists.length, 1);
    assert.deepEqual(data.watchlists[0].tickers, ["ASELS"]);
    assert.ok(storage.getItem(LOCAL_STORE_META_KEY));

    // Second run is a no-op
    const second = migrateLocalStorage(storage);
    assert.equal(second.migrated, false);
  });
});

describe("validateWorkspaceBackup", () => {
  test("enforces the size limit in UTF-8 bytes for multilingual files", () => {
    const raw = JSON.stringify({ ...exportWorkspaceBackup(populatedStorage()).snapshot, note: "ş".repeat(MAX_BACKUP_BYTES / 2) });
    assert.ok(raw.length < MAX_BACKUP_BYTES);
    assert.deepEqual(validateWorkspaceBackup(raw), { valid: false, reason: "too-large" });
  });
  test("accepts valid export and produces accurate preview counts", () => {
    const exported = exportWorkspaceBackup(populatedStorage(), { now: new Date("2026-11-20T09:30:00Z") });
    const validation = validateWorkspaceBackup(exported.json);
    assert.equal(validation.valid, true);
    if (!validation.valid) return;

    assert.equal(validation.preview.version, WORKSPACE_SCHEMA_VERSION);
    assert.equal(validation.preview.counts.watchlists, 2);
    assert.equal(validation.preview.counts.tickers, 4);
    assert.equal(validation.preview.counts.layouts, 2);
    assert.equal(validation.preview.counts.chartPrefs, 1);
    assert.equal(validation.preview.counts.drawingSymbols, 1);
    assert.equal(validation.preview.counts.drawings, 2);
    assert.equal(validation.preview.counts.costs, 1);
    assert.equal(validation.preview.counts.preferences, 4);
    assert.deepEqual(validation.preview.layoutPages, ["home", "macro"]);
  });

  test("rejects corrupted, empty, oversized, unknown-format and newer-version files", () => {
    assert.deepEqual(validateWorkspaceBackup(""), { valid: false, reason: "empty" });
    assert.deepEqual(validateWorkspaceBackup("   "), { valid: false, reason: "empty" });
    assert.deepEqual(validateWorkspaceBackup("{bad json"), { valid: false, reason: "invalid-json" });
    assert.deepEqual(validateWorkspaceBackup("[]"), { valid: false, reason: "not-an-object" });
    assert.deepEqual(validateWorkspaceBackup(JSON.stringify({ version: 1, data: {} })), {
      valid: false,
      reason: "unknown-format",
    });
    assert.deepEqual(
      validateWorkspaceBackup(JSON.stringify({ format: WORKSPACE_BACKUP_FORMAT, version: 0, data: {} })),
      { valid: false, reason: "invalid-version" },
    );
    assert.deepEqual(
      validateWorkspaceBackup(JSON.stringify({ format: WORKSPACE_BACKUP_FORMAT, version: 99, data: {} })),
      { valid: false, reason: "newer-version" },
    );
    assert.deepEqual(
      validateWorkspaceBackup(JSON.stringify({ format: WORKSPACE_BACKUP_FORMAT, version: 1, data: "nope" })),
      { valid: false, reason: "invalid-data" },
    );
    assert.deepEqual(
      validateWorkspaceBackup(
        JSON.stringify({ format: WORKSPACE_BACKUP_FORMAT, version: 1, data: { watchlists: "not-array" } }),
      ),
      { valid: false, reason: "invalid-watchlists" },
    );
    assert.deepEqual(
      validateWorkspaceBackup(
        JSON.stringify({
          format: WORKSPACE_BACKUP_FORMAT,
          version: 1,
          data: { layouts: { "hisse.dashboard.layout": { version: 1, items: [{ id: "index", x: 99, y: 0, w: 2, h: 5 }] } } },
        }),
      ),
      { valid: false, reason: "invalid-layouts" },
    );
    assert.deepEqual(
      validateWorkspaceBackup(
        JSON.stringify({
          format: WORKSPACE_BACKUP_FORMAT,
          version: 1,
          data: { costs: { THYAO: -10 } },
        }),
      ),
      { valid: false, reason: "invalid-costs" },
    );
    assert.deepEqual(validateWorkspaceBackup("x".repeat(MAX_BACKUP_BYTES + 1)), {
      valid: false,
      reason: "too-large",
    });
  });
});

describe("export / import / rollback", () => {
  test("keeps locale, theme and metadata unchanged when the final storage write fails", async () => {
    const storage = populatedStorage();
    storage.setItem(LOCAL_STORE_META_KEY, "original-meta");
    const incoming = populatedStorage();
    incoming.setItem(LOCALE_STORAGE_KEY, "en");
    incoming.setItem(THEME_STORAGE_KEY, "light");
    const applied: string[] = [];
    let failed = false;
    const result = await importWorkspaceBackup(exportWorkspaceBackup(incoming).json, {
      storage: {
        ...storage,
        setItem(key, value) {
          if (key === LOCAL_STORE_META_KEY && !failed) {
            failed = true;
            throw new Error("QuotaExceededError");
          }
          storage.setItem(key, value);
        },
      },
      archive: createMemoryArchiveStore(),
      onApplyLocale: (value) => applied.push(value),
      onApplyTheme: (value) => applied.push(value),
    });
    assert.equal(result.ok, false);
    assert.deepEqual(applied, []);
    assert.equal(storage.getItem(LOCALE_STORAGE_KEY), "tr");
    assert.equal(storage.getItem(THEME_STORAGE_KEY), "dark");
    assert.equal(storage.getItem(LOCAL_STORE_META_KEY), "original-meta");
  });
  test("restores a full workspace into a clean browser and preserves unrelated keys", async () => {
    const source = populatedStorage();
    const exported = exportWorkspaceBackup(source, { now: new Date("2026-11-20T10:00:00Z") });

    const target = createMemoryStorage({ "hisse.legalNotice.v1": "1" });
    const archive = createMemoryArchiveStore();
    let appliedLocale: string | null = null;
    let appliedTheme: string | null = null;

    const imported = await importWorkspaceBackup(exported.json, {
      storage: target,
      archive,
      now: () => new Date("2026-11-20T10:05:00Z"),
      onApplyLocale: (l) => {
        appliedLocale = l;
      },
      onApplyTheme: (th) => {
        appliedTheme = th;
      },
    });

    assert.equal(imported.ok, true);
    assert.ok(imported.preRestoreId);
    assert.equal(appliedLocale, "tr");
    assert.equal(appliedTheme, "dark");

    // Unrelated key untouched
    assert.equal(target.getItem("hisse.legalNotice.v1"), "1");

    // Target now matches source workspace data
    assert.deepEqual(readWorkspaceData(target), readWorkspaceData(source));
  });

  test("corrupted import rejects without modifying existing workspace or writing a pre-restore copy", async () => {
    const storage = populatedStorage();
    const before = readWorkspaceData(storage);
    const archive = createMemoryArchiveStore();

    await assert.rejects(
      () => importWorkspaceBackup("{broken", { storage, archive }),
      (err: unknown) => err instanceof BackupValidationError && err.reason === "invalid-json",
    );

    assert.deepEqual(readWorkspaceData(storage), before);
    assert.equal((await listRestorePoints(archive)).length, 0);
  });

  test("creates pre-restore rollback copy that restores the exact previous state and prunes old copies", async () => {
    const storage = populatedStorage();
    const original = readWorkspaceData(storage);
    const archive = createMemoryArchiveStore();

    const replacement = createMemoryStorage({
      [WATCHLISTS_STORAGE_KEY]: JSON.stringify([{ id: "favorites", name: "", items: [{ ticker: "KCHOL" }] }]),
    });
    const replacementJson = exportWorkspaceBackup(replacement).json;

    let tick = 1_700_000_000_000;
    const first = await importWorkspaceBackup(replacementJson, {
      storage,
      archive,
      now: () => new Date((tick += 1000)),
    });
    assert.equal(first.ok, true);
    assert.ok(first.preRestoreId);
    assert.deepEqual(readWorkspaceData(storage).watchlists[0].tickers, ["KCHOL"]);

    // Revert via pre-restore copy
    const reverted = await restoreFromArchive(first.preRestoreId!, {
      storage,
      archive,
      now: () => new Date((tick += 1000)),
    });
    assert.equal(reverted.ok, true);
    assert.deepEqual(readWorkspaceData(storage), original);

    // Trigger several more imports to verify pre-restore retention cap
    for (let i = 0; i < 4; i += 1) {
      await importWorkspaceBackup(replacementJson, {
        storage,
        archive,
        now: () => new Date((tick += 1000)),
      });
    }
    await createLocalRestorePoint({ storage, archive, now: () => new Date((tick += 1000)), name: "Manuel Yedek" });

    const all = await listRestorePoints(archive);
    const preRestores = all.filter((r) => r.kind === "prerestore");
    const manuals = all.filter((r) => r.kind === "manual");
    assert.equal(preRestores.length, KEEP_PRE_RESTORE);
    assert.equal(manuals.length, 1);
  });

  test("automatically rolls back when storage throws QuotaExceededError mid-import", async () => {
    const base = populatedStorage();
    const original = readWorkspaceData(base);
    let writes = 0;
    const failingStorage: StorageAdapter = {
      getItem: (k) => base.getItem(k),
      removeItem: (k) => base.removeItem(k),
      keys: () => base.keys(),
      setItem(k, v) {
        writes += 1;
        if (writes === 2) throw new Error("QuotaExceededError");
        base.setItem(k, v);
      },
    };

    const incoming = createMemoryStorage({
      [WATCHLISTS_STORAGE_KEY]: JSON.stringify([{ id: "favorites", name: "", items: [{ ticker: "BIMAS" }] }]),
      [HOME_LAYOUT_STORAGE_KEY]: JSON.stringify({ version: 1, items: [{ id: "index", x: 0, y: 0, w: 6, h: 12 }] }),
    });
    const archive = createMemoryArchiveStore();

    const result = await importWorkspaceBackup(exportWorkspaceBackup(incoming).json, {
      storage: failingStorage,
      archive,
    });
    assert.equal(result.ok, false);
    assert.equal(result.error, "QuotaExceededError");
    // Original state must be intact after automatic compensating rollback
    assert.deepEqual(readWorkspaceData(base), original);
  });
});
