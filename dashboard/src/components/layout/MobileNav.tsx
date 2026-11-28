"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { usePresence } from "@/hooks/use-presence";
import { exitDuration, motionDuration } from "@/lib/motion";
import { Archive, X } from "lucide-react";
import { useLocale } from "@/lib/locale-context";
import { cn } from "@/lib/utils";
import { LocaleToggle } from "@/components/ui/locale-toggle";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { DataStatus } from "./DataStatus";
import { DEFAULT_TICKER, NAV_ITEMS, tickerFromPath } from "./nav";
import { shouldKeepScrollbar } from "./scroll-lock";
import { useShell } from "./shell-context";
import { Wordmark } from "./SiteHeader";

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Off-canvas navigation below the lg breakpoint (the top bar shows the links above it). */
export function MobileNav() {
  const { mobileNavOpen, closeMobileNav, mobileNavTriggerRef, openWorkspaceManager } = useShell();
  const { present, finishExit } = usePresence(mobileNavOpen, exitDuration(motionDuration.panel));
  const pathname = usePathname();
  const { t } = useLocale();
  const panelRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const ticker = tickerFromPath(pathname) ?? DEFAULT_TICKER;

  useEffect(() => {
    if (!mobileNavOpen) return;
    const trigger = mobileNavTriggerRef.current;
    const keepScrollbar = shouldKeepScrollbar();
    const previousOverflow = document.body.style.overflow;
    if (!keepScrollbar) {
      document.body.style.overflow = "hidden";
    } else {
      document.documentElement.setAttribute("data-keep-scrollbar", "");
    }
    closeButtonRef.current?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        closeMobileNav();
        return;
      }
      if (event.key !== "Tab" || !panelRef.current) return;
      // Keep focus inside the dialog.
      const focusable = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    // The drawer is xl:hidden: widening the viewport past 1280px closes it cleanly.
    const desktop = window.matchMedia("(min-width: 80rem)");
    function handleViewportChange() {
      if (desktop.matches) closeMobileNav();
    }
    desktop.addEventListener("change", handleViewportChange);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      desktop.removeEventListener("change", handleViewportChange);
      if (!keepScrollbar) {
        document.body.style.overflow = previousOverflow;
      } else {
        document.documentElement.removeAttribute("data-keep-scrollbar");
      }
      trigger?.focus();
    };
  }, [mobileNavOpen, closeMobileNav, mobileNavTriggerRef]);

  if (!present) return null;
  const ending = mobileNavOpen ? undefined : "";
  return (
    <div className={cn("fixed inset-0 z-50 xl:hidden", !mobileNavOpen && "pointer-events-none")} inert={!mobileNavOpen} aria-hidden={!mobileNavOpen || undefined}>
      <div
        className="motion-panel absolute inset-0 overscroll-contain bg-black/40"
        data-presence=""
        data-ending-style={ending}
        onClick={closeMobileNav}
        aria-hidden="true"
      />
      <div
        ref={panelRef}
        id="mobile-navigation"
        role="dialog"
        aria-modal="true"
        aria-label={t("shell.mainNav")}
        className="motion-panel motion-panel-slide motion-panel-horizontal absolute inset-y-0 left-0 flex h-svh max-h-svh w-72 max-w-[85vw] flex-col overflow-y-auto overscroll-contain border-r border-border bg-background"
        data-presence=""
        data-ending-style={ending}
        onTransitionEnd={finishExit}
      >
        <div className="flex h-14 shrink-0 items-center justify-between border-b border-border px-4">
          <Link href="/" onClick={closeMobileNav} aria-label={t("shell.home")} className="rounded-sm">
            <Wordmark />
          </Link>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={closeMobileNav}
            aria-label={t("shell.closeMenu")}
            className="close-icon-btn -mr-1.5 text-foreground"
          >
            <X className="h-5 w-5" aria-hidden="true" strokeWidth={1.75} />
          </button>
        </div>

        <nav aria-label={t("shell.mainNav")} className="px-2 py-3">
          <ul className="flex flex-col">
            {NAV_ITEMS.map((item) => {
              const active = item.isActive(pathname);
              return (
                <li key={item.key}>
                  <Link
                    href={item.href(ticker)}
                    onClick={closeMobileNav}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "relative flex min-h-11 items-center rounded-md px-3 py-2.5 text-[15px] transition-colors",
                      "focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring",
                      active ? "bg-muted font-semibold text-foreground" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                    )}
                  >
                    {t(item.shortLabelKey)}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="mt-auto space-y-3 border-t border-border px-4 py-4">
          <div className="space-y-3 md:hidden">
            <button
              type="button"
              aria-haspopup="dialog"
              onClick={() => {
                closeMobileNav();
                openWorkspaceManager("backup");
              }}
              className="flex min-h-11 w-full items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-xs font-medium text-foreground motion-press-subtle hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
            >
              <Archive className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
              {t("workspace.openManager")}
            </button>
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs text-muted-foreground">{t("shell.language")}</span>
              <LocaleToggle />
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs text-muted-foreground">{t("shell.theme")}</span>
              <ThemeToggle />
            </div>
          </div>
          <DataStatus variant="panel" />
        </div>
      </div>
    </div>
  );
}
