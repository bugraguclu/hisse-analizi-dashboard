"use client";

import { useEffect, useId, useState, useSyncExternalStore } from "react";
import { NotebookPen } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useDeviceKey } from "@/hooks/use-device-key";
import { useOutbox } from "@/hooks/use-outbox";
import { deviceRequest } from "@/lib/device/device-api";
import { formatMarketDate } from "@/lib/format";
import { useLocale } from "@/lib/locale-context";
import { MAX_NOTE_LENGTH, type NotesMap, type ServerNote } from "@/lib/notes/notes-cache";
import { deleteNote, getNotesSnapshot, notesLastAppliedAt, reconcileWithServer, saveNote, subscribeNotes } from "@/lib/notes/notes-store";

const EMPTY_NOTES: NotesMap = {};

/** Server list → local copy, once per fetch that is newer than our last synced write. */
function useNotesServerSync() {
  const deviceKey = useDeviceKey();
  const { entries, loaded } = useOutbox();
  const query = useQuery({
    queryKey: ["me", "notes", deviceKey],
    queryFn: ({ signal }) => deviceRequest<ServerNote[]>("/me/notes", { deviceKey, signal }),
    enabled: deviceKey !== null,
    staleTime: 60_000,
  });
  const { data, dataUpdatedAt } = query;
  useEffect(() => {
    if (!data || !loaded || dataUpdatedAt <= notesLastAppliedAt()) return;
    void reconcileWithServer(data, entries);
    // Entries are read at reconcile time; re-running on every queue change is not needed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, dataUpdatedAt, loaded]);
}

/**
 * Private note on a stock (this device's key). Edits are saved locally at once and
 * sent through the offline outbox, so they work without a connection.
 */
export function StockNote({ ticker }: { ticker: string }) {
  const { t } = useLocale();
  const id = useId();
  const notes = useSyncExternalStore(subscribeNotes, getNotesSnapshot, () => EMPTY_NOTES);
  const note = notes[ticker] ?? null;
  const { entries } = useOutbox();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  useNotesServerSync();

  const queued = entries.filter((entry) => entry.entity === `note:${ticker}`);
  const syncLabel = queued.some((entry) => entry.status === "conflict")
    ? t("notes.syncConflict")
    : queued.some((entry) => entry.status === "rejected")
      ? t("notes.syncRejected")
      : queued.length > 0
        ? t("notes.syncPending")
        : note?.version
          ? t("notes.syncSaved", { time: formatMarketDate(note.updatedAt, "dayMonthTime") })
          : null;

  const start = () => {
    setDraft(note?.text ?? "");
    setEditing(true);
  };

  const save = async () => {
    const text = draft.trim() ? draft : "";
    try {
      if (!text) await deleteNote(ticker);
      else await saveNote(ticker, text.slice(0, MAX_NOTE_LENGTH));
      setEditing(false);
    } catch {
      toast.error(t("notes.saveFailed"));
    }
  };

  const remove = async () => {
    if (!window.confirm(t("notes.deleteConfirm", { ticker }))) return;
    try {
      await deleteNote(ticker);
      setEditing(false);
    } catch {
      toast.error(t("notes.saveFailed"));
    }
  };

  if (editing) {
    return (
      <div className="mt-4 space-y-2">
        <label htmlFor={`${id}-note`} className="text-xs font-medium text-foreground">
          {t("notes.label", { ticker })}
        </label>
        <textarea
          id={`${id}-note`}
          value={draft}
          maxLength={MAX_NOTE_LENGTH}
          rows={4}
          onChange={(event) => setDraft(event.target.value)}
          aria-describedby={`${id}-hint`}
          className="block w-full resize-y rounded-md border border-input bg-card px-2.5 py-2 text-base leading-relaxed outline-none focus-visible:border-foreground/40 focus-visible:ring-2 focus-visible:ring-ring/25 md:text-[13px]"
        />
        <p id={`${id}-hint`} className="text-[11px] text-muted-foreground">
          {t("notes.hint")} · {draft.length}/{MAX_NOTE_LENGTH}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" onClick={() => void save()}>
            {t("notes.save")}
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={() => setEditing(false)}>
            {t("alerts.cancel")}
          </Button>
          {note ? (
            <Button type="button" size="sm" variant="ghost" onClick={() => void remove()}>
              {t("notes.delete")}
            </Button>
          ) : null}
        </div>
      </div>
    );
  }

  if (!note) {
    return (
      <div className="mt-3">
        <Button type="button" size="sm" variant="ghost" onClick={start} className="-ml-2.5">
          <NotebookPen aria-hidden="true" /> {t("notes.add")}
        </Button>
      </div>
    );
  }

  return (
    <section aria-label={t("notes.label", { ticker })} className="mt-4 rounded-md border border-border bg-card px-3 py-2.5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="min-w-0 whitespace-pre-wrap break-words text-[13px] leading-relaxed text-foreground">{note.text}</p>
        <Button type="button" size="sm" variant="ghost" onClick={start} aria-label={t("notes.editLabel", { ticker })}>
          {t("alerts.edit")}
        </Button>
      </div>
      {syncLabel ? (
        <p role="status" className="mt-1 text-[11px] text-muted-foreground">
          {syncLabel}
        </p>
      ) : null}
    </section>
  );
}
