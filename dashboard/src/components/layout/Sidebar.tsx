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

/**
 * Desktop: a 64 px icon rail that expands over the content (no layout shift)
 * on hover or keyboard focus — labels are either fully shown or fully hidden.
 * Mobile: an off-canvas drawer opened from the TopBar.
 */
export function AppSidebar() {
  return (
    <>
      <DesktopRail />
      <MobileDrawer />
    </>
  );
}

// Label visibility follows the rail's expanded state (hover or focus-visible inside).
const RAIL_LABEL =
  "pointer-events-none opacity-0 transition-opacity duration-150 group-hover/rail:pointer-events-auto group-hover/rail:opacity-100 group-has-[:focus-visible]/rail:pointer-events-auto group-has-[:focus-visible]/rail:opacity-100";

function BrandMark({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-primary to-primary/70 text-[11px] font-black text-primary-foreground shadow-sm shadow-primary/20",
        className,
      )}
    >
      HA
    </span>
  );
}

function NavLinks({ variant, onNavigate }: { variant: "rail" | "drawer"; onNavigate?: () => void }) {
  const pathname = usePathname();
  const { t } = useLocale();
  const ticker = tickerFromPath(pathname) ?? DEFAULT_TICKER;

  return (
    <ul className="flex flex-col gap-0.5">
      {NAV_ITEMS.map((item) => {
        const Icon = item.icon;
        const active = item.isActive(pathname);
        const label = t(item.labelKey);
        return (
          <li key={item.key}>
            <Link
              href={item.href(ticker)}
              onClick={onNavigate}
              aria-current={active ? "page" : undefined}
              // The rail hides labels visually; keep the accessible name explicit.
              aria-label={variant === "rail" ? label : undefined}
              className={cn(
                "relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors",
                "focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-sidebar-ring",
                active
                  ? "bg-sidebar-primary/10 font-medium text-sidebar-primary"
                  : "text-sidebar-foreground hover:bg-sidebar-accent/70 hover:text-sidebar-accent-foreground",
              )}
            >
              {active && <span aria-hidden="true" className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-sidebar-primary" />}
              <Icon aria-hidden="true" className={cn("h-[18px] w-[18px] shrink-0", active ? "text-sidebar-primary" : "text-sidebar-foreground/70")} />
              <span className={cn("truncate whitespace-nowrap", variant === "rail" && RAIL_LABEL)}>{label}</span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function DesktopRail() {
  const { t } = useLocale();
  return (
    // Placeholder keeps the content offset at the collapsed width.
    <div className="hidden w-16 shrink-0 md:block">
      <nav
        aria-label={t("shell.mainNav")}
        className={cn(
          "group/rail fixed inset-y-0 left-0 z-40 flex w-16 flex-col overflow-hidden border-r border-sidebar-border/60 bg-sidebar px-2 py-4",
          "transition-[width,box-shadow] delay-150 duration-200 ease-out",
          "hover:w-60 hover:shadow-2xl hover:shadow-black/20 hover:delay-0",
          "has-[:focus-visible]:w-60 has-[:focus-visible]:shadow-2xl has-[:focus-visible]:delay-0",
        )}
      >
        <Link
          href="/"
          aria-label={t("shell.home")}
          className="mb-6 flex items-center gap-3 rounded-lg px-2 py-1 focus-visible:outline-2 focus-visible:outline-sidebar-ring"
        >
          <BrandMark />
          <span className={cn("flex min-w-0 flex-col", RAIL_LABEL)}>
            <span className="truncate text-sm font-bold leading-tight text-foreground">Hisse Analizi</span>
            <span className="truncate text-[10px] leading-tight text-muted-foreground">{t("shell.tagline")}</span>
          </span>
        </Link>

        <div className="flex-1 overflow-y-auto overflow-x-hidden">
          <NavLinks variant="rail" />
        </div>

        <div className="mt-4 border-t border-sidebar-border/40 pt-3">
          <DataStatus variant="rail" labelClassName={RAIL_LABEL} />
        </div>
      </nav>
    </div>
  );
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';

function MobileDrawer() {
  const { mobileNavOpen, closeMobileNav, mobileNavTriggerRef } = useShell();
  const { t } = useLocale();
  const panelRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

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
    // The drawer is md:hidden: widening the viewport (e.g. rotating a phone) would
    // hide it while the page stays scroll-locked, so close it instead.
    const desktop = window.matchMedia("(min-width: 48rem)");
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
        <div className="fixed inset-0 z-50 md:hidden">
          <motion.div
            className="absolute inset-0 bg-black/50 backdrop-blur-[2px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={closeMobileNav}
            aria-hidden="true"
          />
          <motion.div
            ref={panelRef}
            id="mobile-navigation"
            role="dialog"
            aria-modal="true"
            aria-label={t("shell.mainNav")}
            className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col gap-5 overflow-y-auto border-r border-sidebar-border bg-sidebar p-4 shadow-2xl"
            initial={{ x: "-100%" }}
            animate={{ x: 0 }}
            exit={{ x: "-100%" }}
            transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
          >
            <div className="flex items-center justify-between">
              <Link href="/" onClick={closeMobileNav} aria-label={t("shell.home")} className="flex items-center gap-2.5 rounded-lg">
                <BrandMark />
                <span className="flex flex-col">
                  <span className="text-sm font-bold leading-tight text-foreground">Hisse Analizi</span>
                  <span className="text-[10px] leading-tight text-muted-foreground">{t("shell.tagline")}</span>
                </span>
              </Link>
              <button
                ref={closeButtonRef}
                type="button"
                onClick={closeMobileNav}
                aria-label={t("shell.closeMenu")}
                className="rounded-lg p-2 text-sidebar-foreground hover:bg-sidebar-accent focus-visible:outline-2 focus-visible:outline-sidebar-ring"
              >
                <X className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>

            <nav aria-label={t("shell.mainNav")}>
              <NavLinks variant="drawer" onNavigate={closeMobileNav} />
            </nav>

            <div className="mt-auto space-y-3 border-t border-sidebar-border/50 pt-4">
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs font-medium text-muted-foreground">{t("shell.language")}</span>
                <LocaleToggle />
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs font-medium text-muted-foreground">{t("shell.theme")}</span>
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
