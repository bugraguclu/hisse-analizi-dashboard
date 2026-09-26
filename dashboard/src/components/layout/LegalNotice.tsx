"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { useLocale } from "@/lib/locale-context";
import { useShell } from "./shell-context";

/** Bump the version when the text changes materially, so returning visitors see it once more. */
const STORAGE_KEY = "hisse.legalNotice.v1";

/** Keeps the notice closed for the rest of this page load when localStorage is blocked. */
let dismissedThisLoad = false;

function wasDismissed(): boolean {
  if (dismissedThisLoad) return true;
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function rememberDismissal() {
  dismissedThisLoad = true;
  try {
    window.localStorage.setItem(STORAGE_KEY, "1");
  } catch {
    // Private mode or blocked site data: the notice returns on the next full load.
  }
}

/**
 * The site's one "not investment advice" notice, in place of per-card disclaimers.
 * It opens by itself on a visitor's first page view; the footer link reopens it.
 * A native modal <dialog> brings the focus trap (showModal focuses the button),
 * Escape, focus return and the inert page for free; globals.css locks the scroll.
 */
export function LegalNotice() {
  const { t } = useLocale();
  const { legalNoticeRef } = useShell();

  useEffect(() => {
    const dialog = legalNoticeRef.current;
    if (dialog && !dialog.open && !wasDismissed()) dialog.showModal();
  }, [legalNoticeRef]);

  return (
    <dialog
      ref={legalNoticeRef}
      aria-labelledby="legal-notice-title"
      aria-describedby="legal-notice-body"
      // Fires for the button and for Escape alike.
      onClose={rememberDismissal}
      className="card-surface m-auto w-[calc(100%-2rem)] max-w-md p-5 text-foreground backdrop:bg-black/40 md:p-6"
    >
      <h2 id="legal-notice-title" className="font-display text-[22px] font-semibold leading-tight tracking-[-0.012em]">
        {t("legal.title")}
      </h2>
      <p id="legal-notice-body" className="mt-2 text-sm leading-relaxed text-muted-foreground">
        {t("legal.body")}
      </p>
      <div className="mt-5 flex justify-end">
        <Button size="lg" onClick={() => legalNoticeRef.current?.close()} className="w-full sm:w-auto">
          {t("legal.accept")}
        </Button>
      </div>
    </dialog>
  );
}

/** Footer link that reopens the notice. */
export function LegalNoticeLink() {
  const { t } = useLocale();
  const { legalNoticeRef } = useShell();
  return (
    <button
      type="button"
      aria-haspopup="dialog"
      onClick={() => {
        const dialog = legalNoticeRef.current;
        if (dialog && !dialog.open) dialog.showModal();
      }}
      className="rounded-sm underline underline-offset-2 hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
    >
      {t("legal.title")}
    </button>
  );
}
