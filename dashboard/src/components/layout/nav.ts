import { BarChart3, Columns2, Globe, LayoutDashboard, Newspaper, Search, type LucideIcon } from "lucide-react";
import type { TranslationKey } from "@/lib/i18n";

/** Ticker used by stock-level nav items when the URL has none. */
export const DEFAULT_TICKER = "THYAO";

/** Route sections whose pages take a ticker: /<section>/<TICKER>. */
export const TICKER_SECTIONS: ReadonlySet<string> = new Set(["hisse", "teknik", "temel", "analiz"]);

/** Label per first path segment. */
export const SECTION_LABELS: Readonly<Record<string, TranslationKey>> = {
  events: "nav.events",
  hisse: "nav.stockAnalysis",
  teknik: "nav.technicalAnalysis",
  temel: "nav.fundamentalAnalysis",
  analiz: "nav.combinedAnalysis",
  makro: "nav.macroEconomy",
  tarama: "nav.screening",
};

export interface NavItem {
  key: string;
  labelKey: TranslationKey;
  /** Compact label for the desktop top navigation. */
  shortLabelKey: TranslationKey;
  icon: LucideIcon;
  href: (ticker: string) => string;
  isActive: (pathname: string) => boolean;
}

export const NAV_ITEMS: readonly NavItem[] = [
  { key: "dashboard", labelKey: "nav.dashboard", shortLabelKey: "nav.short.markets", icon: LayoutDashboard, href: () => "/", isActive: (p) => p === "/" },
  { key: "events", labelKey: "nav.events", shortLabelKey: "nav.short.events", icon: Newspaper, href: () => "/events", isActive: (p) => p.startsWith("/events") },
  {
    key: "stock",
    labelKey: "nav.stockAnalysis",
    shortLabelKey: "nav.short.stock",
    icon: BarChart3,
    href: (ticker) => `/hisse/${ticker}`,
    // Technical/fundamental detail pages belong to the stock analysis section.
    isActive: (p) => /^\/(hisse|teknik|temel)(\/|$)/.test(p),
  },
  {
    key: "combined",
    labelKey: "nav.combinedAnalysis",
    shortLabelKey: "nav.short.combined",
    icon: Columns2,
    href: (ticker) => `/analiz/${ticker}`,
    isActive: (p) => p.startsWith("/analiz"),
  },
  { key: "macro", labelKey: "nav.macroEconomy", shortLabelKey: "nav.short.macro", icon: Globe, href: () => "/makro", isActive: (p) => p.startsWith("/makro") },
  { key: "screening", labelKey: "nav.screening", shortLabelKey: "nav.short.screening", icon: Search, href: () => "/tarama", isActive: (p) => p.startsWith("/tarama") },
];

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** The ticker in /hisse/GARAN-style URLs, else null. */
export function tickerFromPath(pathname: string): string | null {
  const [, section, ticker] = pathname.split("/");
  if (!section || !ticker || !TICKER_SECTIONS.has(section)) return null;
  const decoded = safeDecode(ticker).toUpperCase();
  return /^[A-Z0-9]{1,10}$/.test(decoded) ? decoded : null;
}

/** Where selecting `ticker` should go from `pathname` (stays inside ticker sections). */
export function tickerHref(pathname: string, ticker: string): string {
  const section = pathname.split("/")[1] ?? "";
  const target = TICKER_SECTIONS.has(section) ? section : "hisse";
  return `/${target}/${encodeURIComponent(ticker.trim().toUpperCase())}`;
}
