"use client";

import { isFeatureEnabled } from "@/lib/demo";
import { useEffect, useRef, type ReactNode } from "react";
import Link from "next/link";
import { TickerSearch } from "@/components/shared/TickerSearch";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useStockIdentity } from "./hooks";
import { StockIdentityContext, useShellIdentity } from "./identity-context";
import { useStockI18n, type StockKey } from "./i18n";
import { StockHeader } from "./StockHeader";
import { StockNote } from "./StockNote";

export type StockView = "overview" | "technical" | "fundamental" | "combined";

/** Fundamentals before technicals: the order an investor weighs them (as on the overview and /analiz). */
const TABS: Array<{ view: StockView; href: (ticker: string) => string; label: StockKey }> = [
  { view: "overview", href: (t) => `/hisse/${t}`, label: "tabs.overview" },
  { view: "fundamental", href: (t) => `/temel/${t}`, label: "tabs.fundamental" },
  { view: "technical", href: (t) => `/teknik/${t}`, label: "tabs.technical" },
  { view: "combined", href: (t) => `/analiz/${t}`, label: "tabs.combined" },
];

export { useShellIdentity };

/**
 * Section tabs under the stock header. Plain links (the active one has
 * aria-current="page" and an ink underline). On phones the row starts at the
 * viewport edge and scrolls sideways when the tabs overflow.
 */
function StockTabs({ ticker, active }: { ticker: string; active: StockView }) {
  const { t } = useStockI18n();
  const listRef = useRef<HTMLUListElement>(null);

  // Keep the current tab in view when the row overflows (e.g. "Kombine" on a
  // narrow phone). Only the row scrolls — never the page.
  useEffect(() => {
    const list = listRef.current;
    const current = list?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!list || !current || list.scrollWidth <= list.clientWidth) return;
    const listBox = list.getBoundingClientRect();
    const tabBox = current.getBoundingClientRect();
    const edge = 24;
    if (tabBox.right > listBox.right - edge) list.scrollLeft += tabBox.right - listBox.right + edge;
    else if (tabBox.left < listBox.left + edge) list.scrollLeft -= listBox.left + edge - tabBox.left;
  }, [active]);

  return (
    <nav aria-label={t("tabs.label")} className="relative min-w-0">
      <ul
        ref={listRef}
        className="relative -mx-1.5 flex overflow-x-auto scrollbar-none fb-fade-x sm:-mx-2.5"
      >
        {TABS.map((tab) => {
          const current = tab.view === active;
          return (
            <li key={tab.view} className="shrink-0">
              <Link
                href={tab.href(ticker)}
                aria-current={current ? "page" : undefined}
                className={cn(
                  "relative flex h-10 items-center whitespace-nowrap rounded-sm px-1.5 text-[11.5px] font-medium transition-colors sm:px-2.5 sm:text-[13px]",
                  "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring",
                  current ? "text-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {t(tab.label)}
                {current ? <span aria-hidden className="absolute inset-x-1.5 -bottom-px h-0.5 bg-foreground sm:inset-x-2.5" /> : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** Shown for a symbol that is not listed on Borsa İstanbul (valid format, unknown ticker). */
export function StockNotFound({ ticker }: { ticker: string | null }) {
  const { t } = useStockI18n();
  const shown = ticker ? ticker.slice(0, 24) : null;
  return (
    <section className="mx-auto max-w-7xl py-10 md:py-16" aria-labelledby="stock-not-found-title">
      <div className="max-w-lg">
        <p className="font-mono text-xs text-muted-foreground">404</p>
        <h1 id="stock-not-found-title" className="mt-2 break-words text-[32px] font-semibold leading-tight text-foreground">
          {shown ? t("notFound.titleWithTicker", { ticker: shown }) : t("notFound.title")}
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{t("notFound.body")}</p>
        <div className="mt-6 max-w-sm">
          <TickerSearch />
        </div>
        <div className="mt-6 flex flex-wrap gap-2">
          <Link href="/tarama" className={buttonVariants({ variant: "default" })}>
            {t("notFound.browse")}
          </Link>
          <Link href="/" className={buttonVariants({ variant: "outline" })}>
            {t("notFound.home")}
          </Link>
        </div>
      </div>
    </section>
  );
}

/**
 * Shared frame for /hisse, /teknik, /temel and /analiz: header with the daily
 * quote, section tabs and the not-found state.
 */
export function StockShell({
  ticker,
  view,
  actions,
  children,
}: {
  ticker: string;
  view: StockView;
  /** Page controls at the end of the tab row ("Customize"). */
  actions?: ReactNode;
  children: ReactNode;
}) {
  const identity = useStockIdentity(ticker);
  if (identity.status === "notFound") return <StockNotFound ticker={ticker} />;
  return (
    <div className="mx-auto max-w-7xl">
      <StockHeader ticker={ticker} identity={identity} />
      {isFeatureEnabled("mutations") ? <StockNote ticker={ticker} /> : null}
      <div className="mt-5 flex items-end gap-3 border-b border-border">
        <div className="min-w-0 grow">
          <StockTabs ticker={ticker} active={view} />
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-2 pb-1.5">{actions}</div> : null}
      </div>
      <StockIdentityContext.Provider value={identity}>
        <div className="mt-6">{children}</div>
      </StockIdentityContext.Provider>
    </div>
  );
}
