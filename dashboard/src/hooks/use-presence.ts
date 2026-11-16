"use client";

import { useEffect, useState, type TransitionEvent } from "react";

/** Keep a closing surface mounted; its own transition can finish before the fallback. */
export function usePresence(open: boolean, exitMs: number) {
  const [present, setPresent] = useState(open);

  if (open && !present) setPresent(true);

  useEffect(() => {
    if (open || !present) return;
    // Account for the browser committing closing styles on the next paint.
    let timeout: number | undefined;
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => {
        timeout = window.setTimeout(() => setPresent(false), exitMs);
      });
    });
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(timeout);
    };
  }, [open, present, exitMs]);

  function finishExit(event: TransitionEvent<HTMLElement>) {
    if (!open && event.target === event.currentTarget && event.propertyName === "opacity") setPresent(false);
  }

  return { present, finishExit };
}
