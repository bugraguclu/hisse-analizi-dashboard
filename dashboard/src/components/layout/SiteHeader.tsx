"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, Search } from "lucide-react";
import { TickerSearch, type TickerSearchHandle } from "@/components/shared/TickerSearch";
import { SearchOverlay } from "@/components/shared/search/SearchOverlay";
import { useSearchHotkey } from "@/components/shared/search/use-search-hotkey";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { LocaleToggle } from "@/components/ui/locale-toggle";
import { useLocale } from "@/lib/locale-context";
import type { TranslationKey } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { DEFAULT_TICKER, NAV_ITEMS, SECTION_LABELS, tickerFromPath } from "./nav";
import { useShell } from "./shell-context";
import { useScrollLinkedBar } from "./use-scroll-linked-bar";

const APP_NAME = "Hisse Analizi";

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** Client-rendered pages cannot export metadata; keep the tab title in sync with the route. */
function useDocumentTitle(pathname: string) {
  const { t } = useLocale();
  const segments = pathname.split("/").filter(Boolean);
  const knownSection = segments.length === 0 || segments[0] in SECTION_LABELS;
  const labels = knownSection
    ? segments.map((segment, index) => {
        const labelKey: TranslationKey | undefined = index === 0 ? SECTION_LABELS[segment] : undefined;
        return labelKey ? t(labelKey) : safeDecode(segment).toUpperCase();
      })
    : [t("notFound.title")];
  const current = labels.at(-1);
  const section = labels.length > 1 ? labels[0] : null;
  const parts = current ? [current, section, APP_NAME] : [t("dashboard.marketOverview"), APP_NAME];
  const title = parts.filter((part, i, all): part is string => !!part && all.indexOf(part) === i).join(" · ");
  useEffect(() => {
    document.title = title;
  }, [title]);
}

/** Serif wordmark — the brand is typographic, no logo tile. */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("font-display text-[19px] font-semibold leading-none tracking-[-0.015em] text-foreground", className)}>
      Hisse Analizi
    </span>
  );
}

function DesktopNav() {
  const pathname = usePathname();
  const { t } = useLocale();
  const ticker = tickerFromPath(pathname) ?? DEFAULT_TICKER;
  return (
    <nav aria-label={t("shell.mainNav")} className="hidden h-full lg:block">
      <ul className="flex h-full items-stretch gap-6">
        {NAV_ITEMS.map((item) => {
          const active = item.isActive(pathname);
          return (
            <li key={item.key} className="flex">
              <Link
                href={item.href(ticker)}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative flex items-center whitespace-nowrap text-[13px] font-medium transition-colors",
                  "focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring",
                  active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {t(item.shortLabelKey)}
                {active && <span aria-hidden="true" className="absolute inset-x-0 -bottom-px h-0.5 bg-foreground" />}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

const ICON_BUTTON =
  "inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring";

/**
 * Top navigation: wordmark, section links (lg+), stock search, language and theme.
 * Below lg the links move into the MobileNav drawer.
 */
export function SiteHeader() {
  const pathname = usePathname();
  const { t } = useLocale();
  const { openMobileNav, mobileNavOpen, mobileNavTriggerRef } = useShell();
  useDocumentTitle(pathname);
  // Small-screen search sheet, scoped to the page it was opened on (closes on navigation).
  const [searchOpenOn, setSearchOpenOn] = useState<string | null>(null);
  const mobileSearchOpen = searchOpenOn === pathname;
  const searchOverlayId = useId();
  const searchButtonRef = useRef<HTMLButtonElement>(null);
  const searchOpenerRef = useRef<HTMLElement | null>(null);
  const desktopSearchRef = useRef<TickerSearchHandle>(null);
  const mobileSearchRef = useRef<TickerSearchHandle>(null);
  const barRef = useRef<HTMLElement>(null);
  useScrollLinkedBar(barRef);

  const openSearch = useCallback(() => {
    searchOpenerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setSearchOpenOn(pathname);
  }, [pathname]);

  // Non-modal, so nothing restores focus for us: when it was inside the sheet, send it
  // back to where the search was opened from, or to the magnifier.
  const closeSearch = useCallback(() => {
    const inside = document.getElementById(searchOverlayId)?.contains(document.activeElement) ?? false;
    setSearchOpenOn(null);
    if (!inside) return;
    const opener = searchOpenerRef.current;
    const target = opener && opener.isConnected && opener !== document.body ? opener : searchButtonRef.current;
    target?.focus();
  }, [searchOverlayId]);

  // ⌘K / Ctrl+K, and "/" where the page has no search of its own.
  useSearchHotkey(() => {
    if (desktopSearchRef.current?.activate() || mobileSearchRef.current?.activate()) return;
    openSearch();
  });

  return (
    // Scroll-linked, as on the belif site: the slot keeps the bar's place in the page
    // (h-14 row + 1px rule), the track is how far the sticky bar may travel. The rules,
    // and when the bar is pinned instead (entry, keyboard focus, the search sheet), are in
    // use-scroll-linked-bar.ts. data-pin is rendered so the bar shows before hydration;
    // the hook owns it from then on.
    <div className="relative h-[calc(3.5rem+1px)]">
      <div className="pointer-events-none absolute inset-x-0 top-0 z-40 h-full">
        <header
          ref={barRef}
          data-pin=""
          data-search={mobileSearchOpen ? "" : undefined}
          className={cn(
            "pointer-events-auto sticky inset-x-0 top-0 border-b border-border bg-background px-4 md:px-6",
            "transition-transform duration-320 ease-[cubic-bezier(0.4,0,0.6,1)]",
            "data-pin:fixed data-search:fixed has-[input:focus]:fixed data-kbd:has-[:focus-visible]:fixed",
          )}
        >
          <div className="mx-auto flex h-14 max-w-7xl items-center gap-3 lg:gap-8">
            <button
              ref={mobileNavTriggerRef}
              type="button"
              onClick={openMobileNav}
              aria-label={t("shell.openMenu")}
              aria-expanded={mobileNavOpen}
              aria-controls="mobile-navigation"
              className={cn(ICON_BUTTON, "-ml-1.5 text-foreground lg:hidden")}
            >
              <Menu className="h-5 w-5" aria-hidden="true" />
            </button>

            <Link
              href="/"
              aria-label={t("shell.home")}
              className="shrink-0 rounded-sm focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
            >
              <Wordmark />
            </Link>

            <DesktopNav />

            <div className="ml-auto flex shrink-0 items-center gap-1.5">
              <div className="hidden w-52 md:block xl:w-64">
                <TickerSearch ref={desktopSearchRef} shortcutHint />
              </div>
              {/* A toggle: a second press closes. It stays a magnifier — the sheet's own ✕ is
                  the visible way out, and two ✕ a thumb apart would ask which one to press.
                  The ::after ring takes the hit area to 44 px without changing the look. */}
              <button
                ref={searchButtonRef}
                type="button"
                onClick={() => (mobileSearchOpen ? closeSearch() : openSearch())}
                aria-label={t("shell.openSearch")}
                aria-haspopup="dialog"
                aria-expanded={mobileSearchOpen}
                aria-controls={mobileSearchOpen ? searchOverlayId : undefined}
                className={cn(
                  ICON_BUTTON,
                  "relative text-foreground after:absolute after:-inset-1.5 after:content-[''] md:hidden",
                  mobileSearchOpen && "bg-muted",
                )}
              >
                <Search className="h-5 w-5" aria-hidden="true" />
              </button>
              <LocaleToggle className="ml-1.5 hidden md:inline-flex" />
              <ThemeToggle className="hidden md:inline-flex" />
            </div>
          </div>

          {mobileSearchOpen && (
            <SearchOverlay id={searchOverlayId} onClose={closeSearch} triggerRef={searchButtonRef} searchRef={mobileSearchRef} />
          )}
        </header>
      </div>
    </div>
  );
}
