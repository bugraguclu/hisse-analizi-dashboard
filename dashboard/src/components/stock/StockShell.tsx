"use client";

import { createContext, useContext, type ReactNode } from "react";
import Link from "next/link";
import { Activity, Building2, Columns2, LayoutGrid, SearchX } from "lucide-react";
import { cn } from "@/lib/utils";
import { useStockIdentity, type IdentityState } from "./hooks";
import { useStockI18n, type StockKey } from "./i18n";
import { StockHeader } from "./StockHeader";

export type StockView = "overview" | "technical" | "fundamental" | "combined";

const TABS: Array<{ view: StockView; href: (ticker: string) => string; label: StockKey; icon: ReactNode }> = [
  { view: "overview", href: (t) => `/hisse/${t}`, label: "tabs.overview", icon: <LayoutGrid aria-hidden className="h-3.5 w-3.5" /> },
  { view: "technical", href: (t) => `/teknik/${t}`, label: "tabs.technical", icon: <Activity aria-hidden className="h-3.5 w-3.5" /> },
  { view: "fundamental", href: (t) => `/temel/${t}`, label: "tabs.fundamental", icon: <Building2 aria-hidden className="h-3.5 w-3.5" /> },
  { view: "combined", href: (t) => `/analiz/${t}`, label: "tabs.combined", icon: <Columns2 aria-hidden className="h-3.5 w-3.5" /> },
];

const StockIdentityContext = createContext<IdentityState>({ status: "loading", identity: null });

/** Identity of the stock rendered by the surrounding StockShell. */
export function useShellIdentity(): IdentityState {
  return useContext(StockIdentityContext);
}

function StockTabs({ ticker, active }: { ticker: string; active: StockView }) {
  const { t } = useStockI18n();
  return (
    <nav aria-label={t("tabs.label")} className="-mx-4 overflow-x-auto px-4 md:mx-0 md:px-0">
      <ul className="flex min-w-max gap-1 border-b border-border/60">
        {TABS.map((tab) => {
          const current = tab.view === active;
          return (
            <li key={tab.view}>
              <Link
                href={tab.href(ticker)}
                aria-current={current ? "page" : undefined}
                className={cn(
                  "-mb-px inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
                  current ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                {tab.icon}
                {t(tab.label)}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export function StockNotFound({ ticker }: { ticker: string | null }) {
  const { t } = useStockI18n();
  const shown = ticker ? ticker.slice(0, 24) : null;
  return (
    <section className="flex min-h-[55vh] items-center justify-center">
      <div className="w-full max-w-md rounded-2xl border border-border/60 bg-card p-8 text-center shadow-sm">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-muted">
          <SearchX aria-hidden className="h-6 w-6 text-muted-foreground" />
        </div>
        <h1 className="text-lg font-bold text-foreground">
          {shown ? t("notFound.titleWithTicker", { ticker: shown }) : t("notFound.title")}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">{t("notFound.body")}</p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <Link
            href="/tarama"
            className="inline-flex items-center rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
          >
            {t("notFound.browse")}
          </Link>
          <Link
            href="/"
            className="inline-flex items-center rounded-lg border border-border/60 px-4 py-2 text-sm font-semibold text-foreground hover:bg-muted/50"
          >
            {t("notFound.home")}
          </Link>
        </div>
      </div>
    </section>
  );
}

/**
 * Shared frame for /hisse, /teknik, /temel and /analiz: header with the daily
 * quote, section tabs and a friendly not-found state. Sections mount right
 * away (they show their own skeletons) — nothing waits for slow endpoints.
 */
export function StockShell({ ticker, view, children }: { ticker: string; view: StockView; children: ReactNode }) {
  const identity = useStockIdentity(ticker);
  if (identity.status === "notFound") return <StockNotFound ticker={ticker} />;
  return (
    <div className="mx-auto max-w-7xl space-y-5">
      <StockHeader ticker={ticker} identity={identity} />
      <StockTabs ticker={ticker} active={view} />
      <StockIdentityContext.Provider value={identity}>
        <div className="space-y-4">{children}</div>
      </StockIdentityContext.Provider>
    </div>
  );
}
