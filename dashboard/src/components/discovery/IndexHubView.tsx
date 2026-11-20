"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Breadcrumbs } from "@/components/shared/Breadcrumbs";
import { findQuote, useIndexQuotes } from "@/components/dashboard/queries";
import { api } from "@/lib/api";
import { DISCOVERY_INDICES, INDEX_GROUP_LABELS, indexPageHref, type IndexGroup } from "@/lib/discovery";
import { EMPTY_VALUE, formatChangePercent, formatNumber, TREND_TEXT_CLASS, trendTone } from "@/lib/format";
import type { Locale } from "@/lib/i18n";
import { useLocale } from "@/lib/locale-context";
import { STALE_TIME } from "@/lib/queryClient";
import { cn } from "@/lib/utils";

const GROUPS: readonly IndexGroup[] = ["headline", "sector", "thematic"];

const COPY: Record<
  Locale,
  {
    eyebrow: string;
    title: string;
    lead: string;
    stocksCount: (n: number) => string;
    openIndex: string;
    browseSectors: string;
    openScreener: string;
  }
> = {
  tr: {
    eyebrow: "Kalıcı Keşif Sayfaları · Borsa İstanbul",
    title: "BIST Endeksleri",
    lead: "Her endeksin sabit paylaşılabilir sayfası: canlı grafik, bileşen şirketler, medyan değerleme çarpanları ve hazır tarama geçişleri.",
    stocksCount: (n) => `${n} şirket`,
    openIndex: "Sayfayı aç",
    browseSectors: "KAP Sektörleri",
    openScreener: "Hisse Tarama",
  },
  en: {
    eyebrow: "Canonical Discovery · Borsa Istanbul",
    title: "BIST Indices",
    lead: "Permanent shareable pages for each BIST index: live chart, constituent stocks, valuation medians and pre-filtered screener links.",
    stocksCount: (n) => `${n} stocks`,
    openIndex: "Open page",
    browseSectors: "KAP Sectors",
    openScreener: "Stock Screener",
  },
  fr: {
    eyebrow: "Découverte canonique · Borsa Istanbul",
    title: "Indices BIST",
    lead: "Pages permanentes partageables pour chaque indice BIST : graphique en direct, composants, médianes et liens vers le filtre.",
    stocksCount: (n) => `${n} actions`,
    openIndex: "Ouvrir",
    browseSectors: "Secteurs KAP",
    openScreener: "Filtrage",
  },
};

export function IndexHubView() {
  const { locale, t } = useLocale();
  const copy = COPY[locale];
  const quotesQ = useIndexQuotes();
  const universeQ = useQuery({
    queryKey: ["screener-universe"],
    queryFn: ({ signal }) => api.screenerUniverse(signal),
    staleTime: STALE_TIME.market,
  });

  const countByCode = new Map((universeQ.data?.indices ?? []).map((item) => [item.code, item.count]));

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <div className="space-y-4">
        <Breadcrumbs
          items={[
            { label: t("nav.dashboard"), href: "/" },
            { label: t("nav.indices"), href: "/endeks" },
          ]}
        />
        <PageHeader
          eyebrow={copy.eyebrow}
          title={copy.title}
          description={copy.lead}
          actions={
            <div className="flex flex-wrap gap-2">
              <Link
                href="/sektor"
                className="rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted"
              >
                {copy.browseSectors}
              </Link>
              <Link
                href="/tarama"
                className="rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted"
              >
                {copy.openScreener}
              </Link>
            </div>
          }
        />
      </div>

      {GROUPS.map((group) => {
        const items = DISCOVERY_INDICES.filter((item) => item.group === group);
        return (
          <section key={group} className="space-y-3" aria-labelledby={`index-group-${group}`}>
            <h2 id={`index-group-${group}`} className="border-b border-border pb-2 text-base font-semibold text-foreground">
              {INDEX_GROUP_LABELS[group][locale]}
            </h2>
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {items.map((item) => {
                const quote = findQuote(quotesQ.data?.quotes, item.code);
                const count = countByCode.get(item.code);
                return (
                  <li key={item.slug}>
                    <Link
                      href={indexPageHref(item.slug)}
                      className="group card-surface flex h-full flex-col justify-between gap-3 p-4 transition-colors hover:border-foreground/35 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                    >
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between gap-2">
                          <span className="rounded-sm bg-surface px-1.5 py-0.5 font-mono text-[11px] font-semibold text-foreground">
                            {item.code}
                          </span>
                          {quote && quote.last !== null && quote.last > 0 ? (
                            <span className="inline-flex items-baseline gap-1.5 font-mono text-xs tabular-nums">
                              <span className="font-medium text-foreground">{formatNumber(quote.last)}</span>
                              <span className={cn(TREND_TEXT_CLASS[trendTone(quote.change_percent)])}>
                                {formatChangePercent(quote.change_percent)}
                              </span>
                            </span>
                          ) : count !== undefined ? (
                            <span className="font-mono text-[11px] text-muted-foreground">{copy.stocksCount(count)}</span>
                          ) : (
                            <span className="font-mono text-[11px] text-muted-foreground">{EMPTY_VALUE}</span>
                          )}
                        </div>
                        <h3 className="text-[15px] font-semibold text-foreground group-hover:text-primary">
                          {item.name[locale]}
                        </h3>
                        <p className="text-xs leading-relaxed text-muted-foreground">{item.shortDesc[locale]}</p>
                      </div>
                      <div className="flex items-center justify-between border-t border-border/70 pt-2.5 text-xs">
                        <span className="font-mono text-[11px] text-muted-foreground">
                          {count !== undefined ? copy.stocksCount(count) : item.slug}
                        </span>
                        <span className="inline-flex items-center gap-1 font-medium text-primary">
                          {copy.openIndex}
                          <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
                        </span>
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
