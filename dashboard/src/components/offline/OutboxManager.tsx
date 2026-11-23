"use client";

import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { flushOutbox, listOutbox, registerBackgroundSync, subscribeOutbox } from "@/lib/offline-outbox/runtime";
import { applyNoteResults } from "@/lib/notes/notes-store";

/**
 * Foreground replay of the offline outbox: on start, when the connection comes
 * back and when the tab becomes visible (Background Sync covers closed tabs where
 * the browser supports it). Applies synced results to the local caches.
 */
export function OutboxManager() {
  const queryClient = useQueryClient();

  useEffect(() => {
    const unsubscribe = subscribeOutbox((message) => {
      if (message.type !== "applied") return;
      void listOutbox().then((remaining) => {
        applyNoteResults(message.applied, remaining);
        if (message.applied.some((result) => result.entry.entity.startsWith("alert:"))) {
          void queryClient.invalidateQueries({ queryKey: ["me", "alerts"] });
          void queryClient.invalidateQueries({ queryKey: ["me", "deliveries"] });
        }
      });
    });
    const flush = () => void flushOutbox();
    const onVisible = () => {
      if (document.visibilityState === "visible") flush();
    };
    const onOffline = () => void registerBackgroundSync();

    flush();
    window.addEventListener("online", flush);
    window.addEventListener("offline", onOffline);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      unsubscribe();
      window.removeEventListener("online", flush);
      window.removeEventListener("offline", onOffline);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [queryClient]);

  return null;
}
