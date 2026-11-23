/**
 * Local copy of the device's stock notes (localStorage), so notes open and can
 * be edited offline. The server copy (`/me/notes`) is authoritative once a note
 * has no queued changes; `version` is the last server version this copy is based
 * on (null = never confirmed by the server, e.g. restored from a backup).
 *
 * Pure module (no React/Next) for Node tests and the workspace backup.
 */

import type { StorageAdapter } from "../local-store/storage.ts";

export const NOTES_STORAGE_KEY = "hisse.notes.v1";
export const NOTES_CHANGED_EVENT = "hisse-notes-changed";
export const MAX_NOTE_LENGTH = 5000;
export const MAX_NOTES = 500;
const TICKER_RE = /^[A-Z0-9]{2,10}$/;

export interface LocalNote {
  text: string;
  version: number | null;
  updatedAt: string;
}

export type NotesMap = Record<string, LocalNote>;

export interface ServerNote {
  ticker: string;
  text: string;
  version: number;
  updated_at: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Valid notes only; null when the container itself is not an object. */
export function sanitizeNotes(raw: unknown): { items: NotesMap; dropped: number } | null {
  if (!isRecord(raw)) return null;
  const items: NotesMap = {};
  let dropped = 0;
  for (const [ticker, value] of Object.entries(raw)) {
    if (Object.keys(items).length >= MAX_NOTES || !TICKER_RE.test(ticker) || !isRecord(value)) {
      dropped += 1;
      continue;
    }
    const text = typeof value.text === "string" ? value.text : "";
    if (!text.trim() || text.length > MAX_NOTE_LENGTH) {
      dropped += 1;
      continue;
    }
    const version = typeof value.version === "number" && Number.isInteger(value.version) && value.version > 0 ? value.version : null;
    const updatedAt = typeof value.updatedAt === "string" && !Number.isNaN(Date.parse(value.updatedAt)) ? value.updatedAt : new Date(0).toISOString();
    items[ticker] = { text, version, updatedAt };
  }
  return { items, dropped };
}

export function readNotes(storage: StorageAdapter | null): NotesMap {
  const raw = storage?.getItem(NOTES_STORAGE_KEY) ?? null;
  if (!raw) return {};
  try {
    return sanitizeNotes(JSON.parse(raw))?.items ?? {};
  } catch {
    return {};
  }
}

export function writeNotes(storage: StorageAdapter, notes: NotesMap): void {
  if (Object.keys(notes).length === 0) storage.removeItem(NOTES_STORAGE_KEY);
  else storage.setItem(NOTES_STORAGE_KEY, JSON.stringify(notes));
}

export interface Reconciled {
  notes: NotesMap;
  /** Local-only notes the server has never seen (restored backup): send them as new. */
  recreate: string[];
}

/**
 * Merge the server list into the local copy. Notes with queued changes keep the
 * local text (the queue will sync them); everything else follows the server.
 */
export function reconcileNotes(local: NotesMap, server: readonly ServerNote[], pendingTickers: ReadonlySet<string>): Reconciled {
  const notes: NotesMap = {};
  const recreate: string[] = [];
  const onServer = new Map(server.map((note) => [note.ticker, note]));
  for (const [ticker, note] of Object.entries(local)) {
    if (pendingTickers.has(ticker)) {
      notes[ticker] = note;
      continue;
    }
    const remote = onServer.get(ticker);
    if (remote) continue; // adopted below
    if (note.version === null) {
      notes[ticker] = note;
      recreate.push(ticker);
    }
    // version !== null and missing on the server: deleted elsewhere.
  }
  for (const remote of server) {
    const mine = local[remote.ticker];
    if (pendingTickers.has(remote.ticker) && mine) continue;
    // A list fetched before our own write landed must not roll the note back.
    if (mine && mine.version !== null && remote.version < mine.version) {
      notes[remote.ticker] = mine;
      continue;
    }
    notes[remote.ticker] = { text: remote.text, version: remote.version, updatedAt: remote.updated_at };
  }
  return { notes, recreate: recreate.sort() };
}

/** A queued change reached the server: record the version (and text, if nothing newer is queued). */
export function applySyncedNote(local: NotesMap, ticker: string, data: ServerNote | null, laterPending: boolean): NotesMap {
  const next = { ...local };
  if (data === null) {
    if (!laterPending) delete next[ticker];
    return next;
  }
  const current = next[ticker];
  next[ticker] = laterPending && current ? { ...current, version: data.version } : { text: data.text, version: data.version, updatedAt: data.updated_at };
  return next;
}
