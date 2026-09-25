"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { useLocale } from "@/lib/locale-context";
import { cn } from "@/lib/utils";
import { LocaleToggle } from "@/components/ui/locale-toggle";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { DataStatus } from "./DataStatus";
import { DEFAULT_TICKER, NAV_ITEMS, tickerFromPath } from "./nav";
import { useShell } from "./shell-context";
import { Wordmark } from "./SiteHeader";

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Off-canvas navigation below the lg breakpoint (the top bar shows the links above it). */
export function MobileNav() {
  const { mobileNavOpen, closeMobileNav, mobileNavTriggerRef } = useShell();
  const pathname = usePathname();
  const { t } = useLocale();
  const panelRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const ticker = tickerFromPath(pathname) ?? DEFAULT_TICKER;

  useEffect(() => {
    if (!mobileNavOpen) return;
    const trigger = mobileNavTriggerRef.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
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
    // The drawer is lg:hidden: widening the viewport (e.g. rotating a tablet) would
    // hide it while the page stays scroll-locked, so close it instead.
    const desktop = window.matchMedia("(min-width: 64rem)");
    function handleViewportChange() {
      if (desktop.matches) closeMobileNav();
    }
    desktop.addEventListener("change", handleViewportChange);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      desktop.removeEventListener("change", handleViewportChange);
      document.body.style.overflow = previousOverflow;
      trigger?.focus();
    };
  }, [mobileNavOpen, closeMobileNav, mobileNavTriggerRef]);

  return (
    <AnimatePresence>
      {mobileNavOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <motion.div
            className="absolute inset-0 bg-black/40"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            onClick={closeMobileNav}
            aria-hidden="true"
          />
          <motion.div
            ref={panelRef}
            id="mobile-navigation"
            role="dialog"
            aria-modal="true"
            aria-label={t("shell.mainNav")}
            className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col overflow-y-auto border-r border-border bg-background"
            initial={{ x: "-100%" }}
            animate={{ x: 0 }}
            exit={{ x: "-100%" }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
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
                className="-mr-1.5 inline-flex h-8 w-8 items-center justify-center rounded-md text-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
              >
                <X className="h-5 w-5" aria-hidden="true" />
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
                          "relative flex items-center rounded-md px-3 py-2.5 text-[15px] transition-colors",
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
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs text-muted-foreground">{t("shell.language")}</span>
                <LocaleToggle />
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs text-muted-foreground">{t("shell.theme")}</span>
                <ThemeToggle />
              </div>
              <DataStatus variant="panel" />
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
