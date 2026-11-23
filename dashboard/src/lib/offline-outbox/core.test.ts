import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { outboxCounts, planEnqueue, replayOutbox, resolveEntry, type OutboxDraft, type OutboxEntry } from "./core.ts";
import { createMemoryOutboxStore, type OutboxStore } from "./store.ts";

const KEY = "k".repeat(43);
let counter = 0;

function draft(partial: Partial<OutboxDraft> & Pick<OutboxDraft, "entity" | "kind" | "target">): OutboxDraft {
  counter += 1;
  return { id: `id-${counter}`, seq: counter, payload: null, base: null, deviceKey: KEY, createdAt: counter, label: partial.target, ...partial };
}

async function enqueue(store: OutboxStore, d: OutboxDraft) {
  await store.apply(planEnqueue(await store.list(), d));
}

const note = (ticker: string, text: string, base: number | null = null) =>
  draft({ entity: `note:${ticker}`, kind: "note.put", target: ticker, payload: { text }, base });

/** In-memory model of the notes API: versions, idempotency receipts, conflicts. */
function fakeNotesServer() {
  const notes = new Map<string, { text: string; version: number }>();
  const receipts = new Map<string, { status: number; body: unknown }>();
  const log: Array<{ method: string; path: string; key: string | null; body: unknown }> = [];
  let down = false;
  let dropNextResponse = false;
  const json = (status: number, body: unknown) => new Response(status === 204 ? null : JSON.stringify(body), { status });
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (down) throw new TypeError("Failed to fetch");
    const url = new URL(String(input), "https://x.test");
    const headers = init?.headers as Record<string, string>;
    const key = headers["Idempotency-Key"] ?? null;
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    log.push({ method: init?.method ?? "GET", path: url.pathname + url.search, key, body });
    if (key && receipts.has(key)) {
      const receipt = receipts.get(key)!;
      return json(receipt.status, receipt.body);
    }
    const ticker = decodeURIComponent(url.pathname.split("/").pop()!);
    const current = notes.get(ticker) ?? null;
    const currentOut = current ? { ticker, ...current, updated_at: "2026-11-23T10:00:00Z" } : null;
    let status = 200;
    let out: unknown;
    if (init?.method === "PUT") {
      const base = body.base_version as number | null;
      if ((current === null && base !== null) || (current !== null && base !== current.version)) {
        status = 409;
        out = { detail: "conflict", code: "version_conflict", current: currentOut };
      } else {
        const next = { text: body.text as string, version: (current?.version ?? 0) + 1 };
        notes.set(ticker, next);
        out = { ticker, ...next, updated_at: "2026-11-23T10:00:00Z" };
      }
    } else {
      const base = url.searchParams.get("base_version");
      if (current && base !== null && Number(base) !== current.version) {
        status = 409;
        out = { detail: "conflict", code: "version_conflict", current: currentOut };
      } else {
        notes.delete(ticker);
        status = 204;
      }
    }
    if (status < 300 && key) receipts.set(key, { status, body: out });
    if (dropNextResponse) {
      dropNextResponse = false;
      throw new TypeError("connection reset after the server applied it");
    }
    return json(status, out);
  }) as typeof fetch;
  return {
    impl,
    notes,
    log,
    setDown(value: boolean) {
      down = value;
    },
    dropNext() {
      dropNextResponse = true;
    },
  };
}

describe("outbox replay", () => {
  test("offline edits sync in order, each chained on the previous version", async () => {
    const store = createMemoryOutboxStore();
    const server = fakeNotesServer();
    await enqueue(store, note("THYAO", "ilk"));
    // The first entry may already have been sent once (attempts > 0): the next edit chains on it.
    const [first] = await store.list();
    await store.put({ ...first, attempts: 1 });
    await enqueue(store, note("THYAO", "ikinci", 999));
    await enqueue(store, note("GARAN", "banka"));

    const summary = await replayOutbox(store, server.impl);
    assert.deepEqual({ sent: summary.sent, transient: summary.transient }, { sent: 3, transient: false });
    assert.deepEqual(server.notes.get("THYAO"), { text: "ikinci", version: 2 });
    assert.deepEqual(server.log.map((entry) => (entry.body as { base_version: number | null }).base_version), [null, 1, null]);
    assert.equal((await store.list()).length, 0);
  });

  test("unsent edits of one note are merged; create + delete before sending cancel out", async () => {
    const store = createMemoryOutboxStore();
    await enqueue(store, note("THYAO", "a"));
    await enqueue(store, note("THYAO", "ab"));
    let entries = await store.list();
    assert.equal(entries.length, 1);
    assert.deepEqual(entries[0].payload, { text: "ab" });
    await enqueue(store, draft({ entity: "note:THYAO", kind: "note.delete", target: "THYAO" }));
    entries = await store.list();
    assert.equal(entries.length, 0);
  });

  test("a lost response is replayed with the same Idempotency-Key and not applied twice", async () => {
    const store = createMemoryOutboxStore();
    const server = fakeNotesServer();
    await enqueue(store, note("THYAO", "tek"));
    server.dropNext();
    const first = await replayOutbox(store, server.impl);
    assert.equal(first.transient, true);
    assert.equal((await store.list()).length, 1, "kept for retry");
    const second = await replayOutbox(store, server.impl);
    assert.equal(second.sent, 1);
    assert.equal(server.notes.get("THYAO")?.version, 1, "applied once");
    assert.equal(server.log[0].key, server.log[1].key);
  });

  test("a network failure stops the queue so later changes keep their order", async () => {
    const store = createMemoryOutboxStore();
    const server = fakeNotesServer();
    await enqueue(store, note("THYAO", "1"));
    await enqueue(store, note("GARAN", "2"));
    server.setDown(true);
    const summary = await replayOutbox(store, server.impl);
    assert.equal(summary.transient, true);
    assert.equal(server.log.length, 0);
    const entries = await store.list();
    assert.deepEqual(entries.map((entry) => [entry.target, entry.attempts]), [["THYAO", 1], ["GARAN", 0]]);
    server.setDown(false);
    assert.equal((await replayOutbox(store, server.impl)).sent, 2);
  });

  test("a conflict is parked with the server copy and blocks only that note", async () => {
    const store = createMemoryOutboxStore();
    const server = fakeNotesServer();
    server.notes.set("THYAO", { text: "başka cihaz", version: 3 });
    await enqueue(store, note("THYAO", "benim", 2));
    const conflicted = (await store.list())[0];
    await store.put({ ...conflicted, attempts: 1 });
    await enqueue(store, note("THYAO", "benim 2"));
    await enqueue(store, note("GARAN", "bağımsız"));

    const summary = await replayOutbox(store, server.impl);
    assert.deepEqual([summary.sent, summary.conflicts], [1, 1]);
    const entries = await store.list();
    assert.deepEqual(outboxCounts(entries), { pending: 1, conflicts: 1, rejected: 0 });
    const parked = entries.find((entry) => entry.status === "conflict")!;
    assert.deepEqual(parked.current, { ticker: "THYAO", text: "başka cihaz", version: 3, updated_at: "2026-11-23T10:00:00Z" });

    // Keep mine: re-based on version 3 with a new key; the chained edit follows it.
    await store.apply(resolveEntry(entries, parked.id, "keep-mine", "fresh-key"));
    const after = await replayOutbox(store, server.impl);
    assert.equal(after.sent, 2);
    assert.deepEqual(server.notes.get("THYAO"), { text: "benim 2", version: 5 });
  });

  test("use the server's copy drops every queued change of that note", async () => {
    const entries: OutboxEntry[] = [
      { ...note("THYAO", "x", 1), baseFrom: "fixed", status: "conflict", attempts: 1, current: { text: "y", version: 2 } },
      { ...note("THYAO", "x2"), baseFrom: "previous", status: "pending", attempts: 0 },
      { ...note("GARAN", "z"), baseFrom: "fixed", status: "pending", attempts: 0 },
    ];
    const plan = resolveEntry(entries, entries[0].id, "use-server", "unused");
    assert.deepEqual(plan.remove.sort(), [entries[0].id, entries[1].id].sort());
  });

  test("same text on the server is not a conflict", async () => {
    const store = createMemoryOutboxStore();
    const server = fakeNotesServer();
    server.notes.set("THYAO", { text: "aynı", version: 4 });
    await enqueue(store, note("THYAO", "aynı", 1));
    const summary = await replayOutbox(store, server.impl);
    assert.deepEqual([summary.sent, summary.conflicts], [1, 0]);
    assert.equal(summary.applied[0].data?.version, 4);
  });

  test("validation errors are parked as rejected, not retried and not dropped", async () => {
    const store = createMemoryOutboxStore();
    await enqueue(store, note("THYAO", "x"));
    const reject = (async () => new Response(JSON.stringify({ detail: "Hisse bulunamadı." }), { status: 404 })) as typeof fetch;
    const summary = await replayOutbox(store, reject);
    assert.equal(summary.rejected, 1);
    const [entry] = await store.list();
    assert.equal(entry.status, "rejected");
    assert.equal(entry.error, "Hisse bulunamadı.");
    assert.equal((await replayOutbox(store, reject)).rejected, 0, "parked entries are not resent");
  });

  test("alert edits made offline after an offline create chain on the created rule", async () => {
    const store = createMemoryOutboxStore();
    const sent: Array<{ method: string; path: string; body: Record<string, unknown> | undefined }> = [];
    const api = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      sent.push({ method: init!.method!, path: String(input), body });
      if (init!.method === "POST") return new Response(JSON.stringify({ ...body, version: 1 }), { status: 201 });
      if (init!.method === "PUT") return new Response(JSON.stringify({ ...body, version: (body.version as number) + 1 }), { status: 200 });
      return new Response(null, { status: 204 });
    }) as typeof fetch;
    const rule = (kind: OutboxDraft["kind"], payload: Record<string, unknown> | null = null) =>
      draft({ entity: "alert:r1", kind, target: "r1", payload });
    await enqueue(store, rule("alert.create", { ticker: "THYAO", kind: "price_above", threshold: 300 }));
    const [created] = await store.list();
    await store.put({ ...created, attempts: 1 }); // pretend a first send was attempted
    await enqueue(store, rule("alert.update", { ticker: "THYAO", kind: "price_above", threshold: 310 }));
    await enqueue(store, rule("alert.delete"));
    await replayOutbox(store, api);
    assert.deepEqual(
      sent.map((request) => [request.method, request.path]),
      [["POST", "/api/me/alerts"], ["PUT", "/api/me/alerts/r1"], ["DELETE", "/api/me/alerts/r1?version=2"]],
    );
    assert.equal(sent[0].body?.id, "r1");
    assert.equal(sent[1].body?.version, 1);
  });
});
