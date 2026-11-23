/**
 * Browser glue for stock notes: the local copy (instant, offline) plus queued
 * server writes through the offline outbox.
 */

import { ensureDeviceKey } from "@/hooks/use-device-key";
import { createBrowserStorage, subscribeWorkspaceStorage } from "@/lib/local-store/storage";
import type { AppliedResult, OutboxEntry } from "@/lib/offline-outbox/core";
import { enqueueMutation } from "@/lib/offline-outbox/runtime";
import {
  applySyncedNote,
  NOTES_CHANGED_EVENT,
  NOTES_STORAGE_KEY,
  readNotes,
  reconcileNotes,
  writeNotes,
  type NotesMap,
  type ServerNote,
} from "./notes-cache";

let cachedRaw: string | null | undefined;
let cachedNotes: NotesMap = {};

export function getNotesSnapshot(): NotesMap {
  const storage = createBrowserStorage();
  const raw = storage?.getItem(NOTES_STORAGE_KEY) ?? null;
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cachedNotes = readNotes(storage);
  }
  return cachedNotes;
}

export function subscribeNotes(listener: () => void): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key === NOTES_STORAGE_KEY || event.key === null) listener();
  };
  window.addEventListener("storage", onStorage);
  window.addEventListener(NOTES_CHANGED_EVENT, listener);
  const unsubscribeWorkspace = subscribeWorkspaceStorage(listener);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(NOTES_CHANGED_EVENT, listener);
    unsubscribeWorkspace();
  };
}

function updateNotes(update: (notes: NotesMap) => NotesMap): void {
  const storage = createBrowserStorage();
  if (!storage) throw new Error("storage-unavailable");
  writeNotes(storage, update(readNotes(storage)));
  window.dispatchEvent(new Event(NOTES_CHANGED_EVENT));
}

export async function saveNote(ticker: string, text: string): Promise<void> {
  const deviceKey = ensureDeviceKey();
  if (!deviceKey) throw new Error("storage-unavailable");
  const base = getNotesSnapshot()[ticker]?.version ?? null;
  updateNotes((notes) => ({ ...notes, [ticker]: { text, version: base, updatedAt: new Date().toISOString() } }));
  await enqueueMutation({ entity: `note:${ticker}`, kind: "note.put", target: ticker, payload: { text }, base, deviceKey, label: ticker });
}

export async function deleteNote(ticker: string): Promise<void> {
  const deviceKey = ensureDeviceKey();
  if (!deviceKey) throw new Error("storage-unavailable");
  const base = getNotesSnapshot()[ticker]?.version ?? null;
  updateNotes((notes) => {
    const next = { ...notes };
    delete next[ticker];
    return next;
  });
  await enqueueMutation({ entity: `note:${ticker}`, kind: "note.delete", target: ticker, payload: null, base, deviceKey, label: ticker });
}

/**
 * After "use the server's copy" (current given; null = deleted there) or "discard"
 * (current undefined): make the local copy follow the server again.
 */
export function adoptServerNote(ticker: string, current: Record<string, unknown> | null | undefined): void {
  updateNotes((notes) => {
    const next = { ...notes };
    if (current && typeof current.text === "string" && typeof current.version === "number") {
      next[ticker] = {
        text: current.text,
        version: current.version,
        updatedAt: typeof current.updated_at === "string" ? current.updated_at : new Date().toISOString(),
      };
    } else if (current === null || next[ticker]?.version == null) {
      // Gone on the server, or never accepted by it: nothing left to keep.
      delete next[ticker];
    }
    return next;
  });
}

let lastAppliedAt = 0;

/** When a queued note change last reached the server (a server list older than this is stale). */
export function notesLastAppliedAt(): number {
  return lastAppliedAt;
}

/** Results of a replay (this tab or the service worker): record server versions locally. */
export function applyNoteResults(applied: readonly AppliedResult[], remaining: readonly OutboxEntry[]): void {
  const notes = applied.filter((result) => result.entry.entity.startsWith("note:"));
  if (!notes.length) return;
  lastAppliedAt = Date.now();
  updateNotes((current) =>
    notes.reduce((map, { entry, data }) => {
      const laterPending = remaining.some((other) => other.entity === entry.entity);
      return applySyncedNote(map, entry.target, entry.kind === "note.delete" ? null : (data as unknown as ServerNote | null), laterPending);
    }, current),
  );
}

/** Adopt the server list; local-only notes (restored backup) are queued for creation. */
export async function reconcileWithServer(server: readonly ServerNote[], entries: readonly OutboxEntry[]): Promise<void> {
  const pending = new Set(entries.filter((entry) => entry.entity.startsWith("note:")).map((entry) => entry.target));
  const { notes, recreate } = reconcileNotes(getNotesSnapshot(), server, pending);
  updateNotes(() => notes);
  const deviceKey = ensureDeviceKey();
  if (!deviceKey) return;
  for (const ticker of recreate) {
    await enqueueMutation({
      entity: `note:${ticker}`,
      kind: "note.put",
      target: ticker,
      payload: { text: notes[ticker].text },
      base: null,
      deviceKey,
      label: ticker,
    });
  }
}
