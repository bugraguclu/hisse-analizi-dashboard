import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { applySyncedNote, readNotes, reconcileNotes, sanitizeNotes, writeNotes, NOTES_STORAGE_KEY, type NotesMap } from "./notes-cache.ts";
import { overlayAlerts } from "../alerts/overlay.ts";
import type { AlertRule } from "../alerts/model.ts";
import type { OutboxEntry } from "../offline-outbox/core.ts";
import { createMemoryStorage } from "../local-store/storage.ts";
import { exportWorkspaceBackup, importWorkspaceBackup } from "../local-store/backup.ts";
import { createMemoryArchiveStore } from "../local-store/idb.ts";

const T = "2026-11-23T10:00:00.000Z";

describe("notes cache", () => {
  test("sanitizes stored and imported notes", () => {
    assert.equal(sanitizeNotes([]), null);
    const clean = sanitizeNotes({ THYAO: { text: "a", version: 2, updatedAt: T }, bad: { text: "x" }, GARAN: { text: "  " }, ASELS: { text: "b", version: -1 } });
    assert.deepEqual(clean?.items, { THYAO: { text: "a", version: 2, updatedAt: T }, ASELS: { text: "b", version: null, updatedAt: new Date(0).toISOString() } });
    assert.equal(clean?.dropped, 2);
  });

  test("reconcile: server wins without queued changes, queued notes stay, restored notes are re-created", () => {
    const local: NotesMap = {
      THYAO: { text: "yerel, kuyrukta", version: 1, updatedAt: T },
      GARAN: { text: "eski", version: 1, updatedAt: T },
      ASELS: { text: "silindi başka yerde", version: 2, updatedAt: T },
      SISE: { text: "yedekten", version: null, updatedAt: T },
    };
    const server = [
      { ticker: "THYAO", text: "sunucu", version: 2, updated_at: T },
      { ticker: "GARAN", text: "yeni", version: 3, updated_at: T },
      { ticker: "KCHOL", text: "başka cihazdan", version: 1, updated_at: T },
    ];
    const { notes, recreate } = reconcileNotes(local, server, new Set(["THYAO"]));
    assert.equal(notes.THYAO.text, "yerel, kuyrukta");
    assert.deepEqual(notes.GARAN, { text: "yeni", version: 3, updatedAt: T });
    assert.equal(notes.ASELS, undefined);
    assert.deepEqual(recreate, ["SISE"]);
    assert.equal(notes.KCHOL.text, "başka cihazdan");

    // A list fetched just before our own write landed does not roll the note back.
    const stale = reconcileNotes({ THYAO: { text: "v3", version: 3, updatedAt: T } }, [{ ticker: "THYAO", text: "v2", version: 2, updated_at: T }], new Set());
    assert.equal(stale.notes.THYAO.text, "v3");
  });

  test("a synced change records the server version without overwriting newer local text", () => {
    const local: NotesMap = { THYAO: { text: "daha yeni", version: 1, updatedAt: T } };
    assert.deepEqual(applySyncedNote(local, "THYAO", { ticker: "THYAO", text: "gönderilen", version: 2, updated_at: T }, true).THYAO, {
      text: "daha yeni",
      version: 2,
      updatedAt: T,
    });
    assert.equal(applySyncedNote(local, "THYAO", { ticker: "THYAO", text: "gönderilen", version: 2, updated_at: T }, false).THYAO.text, "gönderilen");
    assert.equal(applySyncedNote(local, "THYAO", null, false).THYAO, undefined);
  });

  test("notes travel in the workspace backup and come back unconfirmed", async () => {
    const source = createMemoryStorage();
    writeNotes(source, { THYAO: { text: "not", version: 4, updatedAt: T } });
    const exported = exportWorkspaceBackup(source);
    assert.deepEqual(exported.snapshot.data.notes, { THYAO: { text: "not", updatedAt: T } });
    assert.equal(exported.preview.counts.notes, 1);
    const target = createMemoryStorage({ [NOTES_STORAGE_KEY]: JSON.stringify({ GARAN: { text: "eski", version: 1, updatedAt: T } }) });
    await importWorkspaceBackup(exported.json, { storage: target, archive: createMemoryArchiveStore() });
    assert.deepEqual(readNotes(target), { THYAO: { text: "not", version: null, updatedAt: T } });
  });
});

describe("alert overlay", () => {
  const rule = (id: string, version = 1): AlertRule => ({
    id, ticker: "THYAO", kind: "price_above", threshold: 300, direction: null, repeat: "once", hysteresis_pct: 1, min_severity: null,
    enabled: true, state: "armed", trigger_count: 0, last_triggered_at: null, version, created_at: `${T}-${id}`, updated_at: T,
  });
  const entry = (seq: number, kind: OutboxEntry["kind"], target: string, status: OutboxEntry["status"] = "pending", payload: Record<string, unknown> | null = null): OutboxEntry => ({
    id: `e${seq}`, seq, entity: `alert:${target}`, kind, target, payload, base: 1, baseFrom: "fixed", deviceKey: "k", status, attempts: 0, createdAt: seq, label: "THYAO",
  });
  const input = { ticker: "GARAN", kind: "kap", threshold: null, direction: null, repeat: "rearm", hysteresis_pct: 1, min_severity: "HIGH", enabled: true };

  test("queued creates, edits and deletes show up with their sync state", () => {
    const shown = overlayAlerts(
      [rule("a"), rule("b"), rule("c")],
      [entry(1, "alert.create", "n", "pending", input), entry(2, "alert.update", "a", "conflict", { ...input, ticker: "THYAO" }), entry(3, "alert.delete", "b"), entry(4, "alert.delete", "c", "rejected")],
      T,
    );
    const byId = Object.fromEntries(shown.map((r) => [r.id, r]));
    assert.equal(byId.n.sync, "pending");
    assert.equal(byId.n.ticker, "GARAN");
    assert.equal(byId.a.sync, "conflict");
    assert.equal(byId.a.kind, "kap");
    assert.equal(byId.b, undefined, "pending delete hides the rule");
    assert.equal(byId.c.sync, "rejected", "a delete that failed keeps the rule visible");
  });
});
