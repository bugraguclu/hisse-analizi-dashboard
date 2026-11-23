"use client";

import { useState } from "react";
import { CloudUpload, TriangleAlert } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useOnlineStatus } from "@/hooks/use-network-status";
import { useOutbox } from "@/hooks/use-outbox";
import { useLocale } from "@/lib/locale-context";
import { adoptServerNote } from "@/lib/notes/notes-store";
import type { OutboxEntry, Resolution } from "@/lib/offline-outbox/core";
import { flushOutbox, resolveOutboxEntry } from "@/lib/offline-outbox/runtime";

const LINK_BUTTON =
  "rounded-sm text-xs font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50";

/**
 * "2 değişiklik gönderilmeyi bekliyor" while queued changes wait for the
 * connection, and every conflict or rejected change with the user's choices.
 * Nothing in the queue disappears without the user seeing it.
 */
export function OutboxStatus() {
  const { t } = useLocale();
  const online = useOnlineStatus();
  const { entries, pending, conflicts, rejected } = useOutbox();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);

  if (pending + conflicts + rejected === 0) return null;
  const problems = entries.filter((entry) => entry.status !== "pending");

  const describe = (entry: OutboxEntry) => {
    const what = entry.entity.startsWith("note:") ? t("outbox.what.note", { label: entry.label }) : t("outbox.what.alert", { label: entry.label });
    return entry.status === "conflict" ? t("outbox.conflict", { what }) : t("outbox.rejected", { what, reason: entry.error ?? "—" });
  };

  const resolve = async (entry: OutboxEntry, resolution: Resolution) => {
    setBusy(true);
    try {
      await resolveOutboxEntry(entry.id, resolution);
      if (resolution !== "keep-mine") {
        if (entry.entity.startsWith("note:")) adoptServerNote(entry.target, resolution === "use-server" ? entry.current ?? null : undefined);
        void queryClient.invalidateQueries({ queryKey: ["me"] });
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="border-b border-border bg-muted/40 px-4 py-2 text-xs md:px-6">
      <div className="mx-auto max-w-7xl space-y-1.5">
        {pending > 0 ? (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p role="status" className="flex items-center gap-2 text-foreground">
              <CloudUpload className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
              {pending === 1 ? t("outbox.pendingOne") : t("outbox.pendingMany", { count: pending })}
              {!online ? <span className="text-muted-foreground">· {t("outbox.whenOnline")}</span> : null}
            </p>
            {online ? (
              <button type="button" className={LINK_BUTTON} onClick={() => void flushOutbox()}>
                {t("outbox.sendNow")}
              </button>
            ) : null}
          </div>
        ) : null}
        {problems.length > 0 ? (
          <ul aria-label={t("outbox.problemsLabel")} className="space-y-1.5">
            {problems.map((entry) => (
              <li key={entry.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                <p role="alert" className="flex min-w-0 items-start gap-2 text-foreground">
                  <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warn" aria-hidden="true" />
                  <span className="min-w-0 text-pretty">{describe(entry)}</span>
                </p>
                <div className="flex shrink-0 gap-3">
                  {entry.status === "conflict" ? (
                    <>
                      <button type="button" disabled={busy} className={LINK_BUTTON} onClick={() => void resolve(entry, "keep-mine")}>
                        {t("outbox.keepMine")}
                      </button>
                      <button type="button" disabled={busy} className={LINK_BUTTON} onClick={() => void resolve(entry, "use-server")}>
                        {t("outbox.useServer")}
                      </button>
                    </>
                  ) : (
                    <button type="button" disabled={busy} className={LINK_BUTTON} onClick={() => void resolve(entry, "discard")}>
                      {t("outbox.discard")}
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}
