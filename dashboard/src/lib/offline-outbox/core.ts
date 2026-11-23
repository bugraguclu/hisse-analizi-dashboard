/**
 * Offline outbox for server mutations (stock notes, alert rules).
 *
 * Changes made offline — or whose request failed without a response — are kept
 * in IndexedDB and replayed strictly in order when the connection returns
 * (foreground triggers, and Background Sync where the browser has it).
 *
 * - Every entry carries its own Idempotency-Key (`id`): a replay after a lost
 *   response gets the original answer instead of applying twice.
 * - Edits are conflict-checked: each entry names the server version it was based
 *   on (`base`). A chain of offline edits to one item uses `baseFrom: "previous"`:
 *   the version returned by the previous entry becomes the next one's base.
 * - A `409 version_conflict` (or any other rejection) parks the entry, keeps the
 *   server's current copy, and blocks later entries of the same item until the
 *   user decides (keep mine / use the server's / discard). Nothing is dropped
 *   silently.
 *
 * `replayOutbox` is self-contained (no imports, no module-level references): the
 * service worker embeds its source (`replayOutbox.toString()`) for Background
 * Sync, so pages and the worker run the same implementation.
 */

export type OutboxKind = "note.put" | "note.delete" | "alert.create" | "alert.update" | "alert.delete";
export type OutboxStatus = "pending" | "conflict" | "rejected";

export interface OutboxEntry {
  /** Unique id, also sent as Idempotency-Key. */
  id: string;
  /** Global order (enqueue time based, strictly increasing). */
  seq: number;
  /** "note:THYAO" | "alert:<uuid>" — conflicts and chains are per entity. */
  entity: string;
  kind: OutboxKind;
  /** Ticker (notes) or rule id (alerts). */
  target: string;
  /** Note text, or the alert rule fields. */
  payload: Record<string, unknown> | null;
  /** Server version this change is based on (null = the item must not exist yet / unknown for deletes). */
  base: number | null;
  baseFrom: "fixed" | "previous";
  deviceKey: string;
  status: OutboxStatus;
  attempts: number;
  createdAt: number;
  lastAttemptAt?: number | null;
  error?: string | null;
  /** Server copy returned with a conflict (null = deleted on the server). */
  current?: Record<string, unknown> | null;
  /** Short human label for the pending/conflict list, e.g. "THYAO". */
  label: string;
}

export interface OutboxStoreLike {
  list(): Promise<OutboxEntry[]>;
  put(entry: OutboxEntry): Promise<void>;
  remove(id: string): Promise<void>;
}

export interface AppliedResult {
  entry: OutboxEntry;
  /** Response JSON (null for 204 deletes). */
  data: Record<string, unknown> | null;
}

export interface ReplaySummary {
  sent: number;
  conflicts: number;
  rejected: number;
  /** A request failed without a usable answer: stop and retry later. */
  transient: boolean;
  applied: AppliedResult[];
}

/**
 * Replay pending entries in order. Self-contained on purpose (see module doc).
 * Callers serialize runs (Web Locks) so a page and the service worker never
 * replay at the same time.
 */
export async function replayOutbox(
  store: OutboxStoreLike,
  fetchImpl: typeof fetch,
  options: { apiBase?: string; now?: () => number } = {},
): Promise<ReplaySummary> {
  const apiBase = options.apiBase ?? "/api";
  const now = options.now ?? (() => Date.now());
  const summary: ReplaySummary = { sent: 0, conflicts: 0, rejected: 0, transient: false, applied: [] };

  const build = (entry: OutboxEntry): { method: string; path: string; body: unknown } => {
    const target = encodeURIComponent(entry.target);
    const payload = entry.payload ?? {};
    const query = (name: string) => (entry.base === null ? "" : "?" + name + "=" + entry.base);
    switch (entry.kind) {
      case "note.put":
        return { method: "PUT", path: "/me/notes/" + target, body: { text: payload.text, base_version: entry.base } };
      case "note.delete":
        return { method: "DELETE", path: "/me/notes/" + target + query("base_version"), body: undefined };
      case "alert.create":
        return { method: "POST", path: "/me/alerts", body: Object.assign({}, payload, { id: entry.target }) };
      case "alert.update":
        return { method: "PUT", path: "/me/alerts/" + target, body: Object.assign({}, payload, { version: entry.base }) };
      default:
        return { method: "DELETE", path: "/me/alerts/" + target + query("version"), body: undefined };
    }
  };

  const resultVersion = (entry: OutboxEntry, data: Record<string, unknown> | null): number | null => {
    if (entry.kind === "note.delete" || entry.kind === "alert.delete") return null;
    return data && typeof data.version === "number" ? data.version : null;
  };

  const entries = (await store.list()).slice().sort((a, b) => a.seq - b.seq);
  const blocked: Record<string, true> = {};

  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    if (entry.status !== "pending") {
      blocked[entry.entity] = true;
      continue;
    }
    if (blocked[entry.entity]) continue;

    const request = build(entry);
    entry.attempts += 1;
    entry.lastAttemptAt = now();
    await store.put(entry);

    let response: Response;
    try {
      const headers: Record<string, string> = {
        accept: "application/json",
        "X-Device-Key": entry.deviceKey,
        "Idempotency-Key": entry.id,
      };
      if (request.body !== undefined) headers["content-type"] = "application/json";
      response = await fetchImpl(apiBase + request.path, {
        method: request.method,
        headers,
        body: request.body === undefined ? undefined : JSON.stringify(request.body),
        cache: "no-store",
        credentials: "same-origin",
      });
    } catch (error) {
      entry.error = error instanceof Error ? error.message : "network error";
      await store.put(entry);
      summary.transient = true;
      break;
    }

    if (response.status >= 500 || response.status === 429 || response.status === 408) {
      entry.error = "HTTP " + response.status;
      await store.put(entry);
      summary.transient = true;
      break;
    }

    let data: Record<string, unknown> | null = null;
    if (response.status !== 204) {
      try {
        const parsed: unknown = await response.json();
        data = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
      } catch {
        data = null;
      }
    }

    if (response.ok) {
      await store.remove(entry.id);
      summary.sent += 1;
      summary.applied.push({ entry, data });
      const version = resultVersion(entry, data);
      for (let next = index + 1; next < entries.length; next += 1) {
        const later = entries[next];
        if (later.entity !== entry.entity) continue;
        if (later.baseFrom === "previous") {
          later.base = version;
          later.baseFrom = "fixed";
          await store.put(later);
        }
        break;
      }
      continue;
    }

    const code = data && typeof data.code === "string" ? data.code : null;
    const detail = data && typeof data.detail === "string" ? data.detail : "HTTP " + response.status;
    if (response.status === 409 && code === "version_conflict") {
      const current = data && data.current && typeof data.current === "object" ? (data.current as Record<string, unknown>) : null;
      // The server already holds exactly this text: nothing to decide.
      if (entry.kind === "note.put" && current && entry.payload && current.text === entry.payload.text) {
        await store.remove(entry.id);
        summary.sent += 1;
        summary.applied.push({ entry, data: current });
        continue;
      }
      entry.status = "conflict";
      entry.current = current;
      entry.error = detail;
      await store.put(entry);
      blocked[entry.entity] = true;
      summary.conflicts += 1;
      continue;
    }

    entry.status = "rejected";
    entry.error = detail;
    await store.put(entry);
    blocked[entry.entity] = true;
    summary.rejected += 1;
  }
  return summary;
}

// --- Enqueue planning (pure) -----------------------------------------------------------

export interface OutboxDraft {
  id: string;
  seq: number;
  entity: string;
  kind: OutboxKind;
  target: string;
  payload: Record<string, unknown> | null;
  base: number | null;
  deviceKey: string;
  createdAt: number;
  label: string;
}

export interface OutboxPlan {
  put: OutboxEntry[];
  remove: string[];
}

const neverSent = (entry: OutboxEntry) => entry.status === "pending" && entry.attempts === 0;

/**
 * Where a new change goes. Unsent edits of the same item are merged (the server
 * only needs the latest text); creating and deleting an item that never reached
 * the server cancels out. Anything that may already have reached the server is
 * kept and the new change chains on its result.
 */
export function planEnqueue(existing: readonly OutboxEntry[], draft: OutboxDraft): OutboxPlan {
  const same = existing.filter((entry) => entry.entity === draft.entity).sort((a, b) => a.seq - b.seq);
  const last = same.at(-1);

  if (last && neverSent(last)) {
    if (draft.kind === "note.put" && last.kind === "note.put") {
      return { put: [{ ...last, payload: draft.payload, label: draft.label }], remove: [] };
    }
    if (draft.kind === "alert.update" && (last.kind === "alert.update" || last.kind === "alert.create")) {
      return { put: [{ ...last, payload: { ...(last.payload ?? {}), ...(draft.payload ?? {}) }, label: draft.label }], remove: [] };
    }
    const createdHere = same.length > 0 && same.every(neverSent) && (same[0].kind === "alert.create" || (same[0].kind === "note.put" && same[0].base === null));
    if (createdHere && (draft.kind === "alert.delete" || draft.kind === "note.delete")) {
      return { put: [], remove: same.map((entry) => entry.id) };
    }
  }

  const entry: OutboxEntry = {
    ...draft,
    baseFrom: same.length > 0 ? "previous" : "fixed",
    status: "pending",
    attempts: 0,
    error: null,
  };
  return { put: [entry], remove: [] };
}

// --- Conflict resolution (pure) ----------------------------------------------------------

export type Resolution = "keep-mine" | "use-server" | "discard";

/**
 * - keep-mine: re-send this change on top of the server's current version (a
 *   fresh Idempotency-Key, since the request changes). An edit of something deleted
 *   on the server re-creates it; a delete of something already gone is dropped.
 * - use-server / discard: drop every queued change of this item; the caller then
 *   adopts the server copy (`entry.current`, or a refetch).
 */
export function resolveEntry(entries: readonly OutboxEntry[], entryId: string, resolution: Resolution, newId: string): OutboxPlan {
  const entry = entries.find((candidate) => candidate.id === entryId);
  if (!entry) return { put: [], remove: [] };
  const sameEntity = entries.filter((candidate) => candidate.entity === entry.entity);
  if (resolution !== "keep-mine") return { put: [], remove: sameEntity.map((candidate) => candidate.id) };

  const current = entry.current ?? null;
  const currentVersion = current && typeof current.version === "number" ? current.version : null;
  if ((entry.kind === "note.delete" || entry.kind === "alert.delete") && current === null) {
    return { put: [], remove: [entry.id] };
  }
  let kind = entry.kind;
  let payload = entry.payload;
  if (entry.kind === "alert.update" && current === null) kind = "alert.create";
  // A rejected change (validation, limits) cannot simply be retried.
  if (entry.status === "rejected") return { put: [], remove: [] };
  if (kind === "alert.create") payload = { ...(payload ?? {}) };
  const revived: OutboxEntry = {
    ...entry,
    id: newId,
    kind,
    payload,
    base: kind === "alert.create" ? null : currentVersion,
    baseFrom: "fixed",
    status: "pending",
    attempts: 0,
    error: null,
    current: undefined,
  };
  return { put: [revived], remove: [entry.id] };
}

export function outboxCounts(entries: readonly OutboxEntry[]): { pending: number; conflicts: number; rejected: number } {
  let pending = 0;
  let conflicts = 0;
  let rejected = 0;
  for (const entry of entries) {
    if (entry.status === "pending") pending += 1;
    else if (entry.status === "conflict") conflicts += 1;
    else rejected += 1;
  }
  return { pending, conflicts, rejected };
}
