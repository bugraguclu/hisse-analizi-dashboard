"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Search, X } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Breadcrumbs } from "@/components/shared/Breadcrumbs";
import { foldText, sectorStats } from "@/components/tarama/model";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { allCanonicalSectorKeys, FEATURED_SECTORS, sectorPageHref } from "@/lib/discovery";
import { EMPTY_VALUE, formatCompact, formatNumber, formatPercent } from "@/lib/format";
import type { Locale } from "@/lib/i18n";
import { useLocale } from "@/lib/locale-context";
import { STALE_TIME } from "@/lib/queryClient";
import { sectorLabel } from "@/lib/sectors";

const COPY: Record<
  Locale,
  {
    eyebrow: string;
    title: string;
    lead: string;
    searchPlaceholder: string;
    searchLabel: string;
    clear: string;
    featuredHeading: string;
    allHeading: string;
    stocks: (n: number) => string;
    pe: string;
    pb: string;
    roe: string;
    browseIndices: string;
    openAtlas: string;
    empty: string;
  }
> = {
  tr: {
    eyebrow: "Kalıcı Keşif Sayfaları · 48 KAP Sektörü",
    title: "KAP Sektörleri",
    lead: "Her KAP sektörünün sabit paylaşılabilir sayfası: şirket listeleri, en az 3 şirket kuralıyla hesaplanan medyan oranlar ve hazır tarama geçişleri.",
    searchPlaceholder: "Sektör ara… (banka, ulaştırma, perakende)",
    searchLabel: "Sektör ara",
    clear: "Temizle",
    featuredHeading: "Öne çıkan sektörler",
    allHeading: "Tüm KAP sektörleri",
    stocks: (n) => `${n} şirket`,
    pe: "F/K",
    pb: "PD/DD",
    roe: "ROE",
    browseIndices: "BIST Endeksleri",
    openAtlas: "Kavram Atlası",
    empty: "Aramanızla eşleşen sektör bulunamadı.",
  },
  en: {
    eyebrow: "Canonical Discovery · 48 KAP Sectors",
    title: "KAP Sectors",
    lead: "Permanent shareable discovery pages for every KAP sector: listed companies, 3-company-minimum median multiples and pre-filtered screener links.",
    searchPlaceholder: "Search sectors… (banks, transport, retail)",
    searchLabel: "Search sectors",
    clear: "Clear",
    featuredHeading: "Major sectors",
    allHeading: "All KAP sectors",
    stocks: (n) => `${n} stocks`,
    pe: "P/E",
    pb: "P/B",
    roe: "ROE",
    browseIndices: "BIST Indices",
    openAtlas: "Concept Atlas",
    empty: "No sectors match your search.",
  },
  fr: {
    eyebrow: "Découverte canonique · 48 secteurs KAP",
    title: "Secteurs KAP",
    lead: "Pages permanentes pour chaque secteur KAP : sociétés cotées, médianes (seuil de 3 sociétés) et accès direct au filtre.",
    searchPlaceholder: "Rechercher un secteur… (banques, transport)",
    searchLabel: "Rechercher un secteur",
    clear: "Effacer",
    featuredHeading: "Secteurs majeurs",
    allHeading: "Tous les secteurs KAP",
    stocks: (n) => `${n} actions`,
    pe: "PER",
    pb: "C/VC",
    roe: "ROE",
    browseIndices: "Indices BIST",
    openAtlas: "Atlas des concepts",
    empty: "Aucun secteur ne correspond.",
  },
};

export function SectorHubView() {
  const { locale, t } = useLocale();
  const copy = COPY[locale];
  const [query, setQuery] = useState("");

  const universeQ = useQuery({
    queryKey: ["screenerUniverse"],
    queryFn: ({ signal }) => api.screenerUniverse(signal),
    staleTime: STALE_TIME.market,
  });

  const rows = universeQ.data?.rows;

  const statsMap = useMemo(() => (rows ? sectorStats(rows) : new Map()), [rows]);

  const capBySector = useMemo(() => {
    const sums = new Map<string, number>();
    for (const row of rows ?? []) {
      if (!row.kap_sector || !row.market_cap || !Number.isFinite(row.market_cap)) continue;
      sums.set(row.kap_sector, (sums.get(row.kap_sector) ?? 0) + row.market_cap);
    }
    return sums;
  }, [rows]);

  const allKeys = useMemo(() => {
    const keys = allCanonicalSectorKeys();
    const needle = foldText(query.trim());
    const matching = needle
      ? keys.filter(
          (key) =>
            foldText(sectorLabel(key, locale)).includes(needle) ||
            foldText(sectorLabel(key, "tr")).includes(needle) ||
            key.includes(needle),
        )
      : keys;
    return [...matching].sort((a, b) => {
      const capDiff = (capBySector.get(b) ?? 0) - (capBySector.get(a) ?? 0);
      if (capDiff !== 0) return capDiff;
      return sectorLabel(a, locale).localeCompare(sectorLabel(b, locale), locale);
    });
  }, [capBySector, locale, query]);

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <div className="space-y-4">
        <Breadcrumbs
          items={[
            { label: t("nav.dashboard"), href: "/" },
            { label: t("nav.sectors"), href: "/sektor" },
          ]}
        />
        <PageHeader
          eyebrow={copy.eyebrow}
          title={copy.title}
          description={copy.lead}
          className="[&_h1]:font-display [&_h1]:font-normal"
          actions={
            <div className="flex flex-wrap gap-2">
              <Link
                href="/endeks"
                className="motion-press-subtle inline-flex items-center rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring pointer-coarse:min-h-11"
              >
                {copy.browseIndices}
              </Link>
              <Link
                href="/atlas/sektor-medyani"
                className="motion-press-subtle inline-flex items-center rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring pointer-coarse:min-h-11"
              >
                {copy.openAtlas}
              </Link>
            </div>
          }
        />
      </div>

      {/* Featured sector quick pills */}
      {!query.trim() && (
        <section className="space-y-2.5" aria-labelledby="featured-sectors-heading">
          <h2 id="featured-sectors-heading" className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {copy.featuredHeading}
          </h2>
          <ul className="flex flex-wrap gap-1.5">
            {FEATURED_SECTORS.map((key) => (
              <li key={key}>
                <Link
                  href={sectorPageHref(key)}
                  className="motion-press-subtle inline-flex items-center rounded-md border border-border bg-card px-3 py-1.5 text-xs text-foreground transition-colors hover:border-primary/50 hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring pointer-coarse:min-h-11"
                >
                  {sectorLabel(key, locale)}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Search + full sector grid */}
      <section className="space-y-4" aria-labelledby="all-sectors-heading">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
          <h2 id="all-sectors-heading" className="text-base font-semibold text-foreground">
            {copy.allHeading} ({allKeys.length})
          </h2>
          <div className="relative w-full sm:w-72">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
            />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={copy.searchPlaceholder}
              aria-label={copy.searchLabel}
              className="h-9 w-full rounded-md border border-input bg-card pl-8 pr-8 text-base text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-ring sm:text-[13px] pointer-coarse:h-11 pointer-coarse:pr-11"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                aria-label={copy.clear}
                className="motion-press-subtle absolute right-1.5 top-1/2 inline-flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring pointer-coarse:right-0 pointer-coarse:h-11 pointer-coarse:w-11"
              >
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            )}
          </div>
        </div>

        {allKeys.length === 0 ? (
          <div className="card-surface p-8 text-center text-sm text-muted-foreground">{copy.empty}</div>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {allKeys.map((key) => {
              const stat = statsMap.get(key);
              const cap = capBySector.get(key);
              return (
                <li key={key}>
                  <Link
                    href={sectorPageHref(key)}
                    className="group card-surface flex h-full flex-col justify-between gap-3 p-4 transition-colors hover:border-foreground/35 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                  >
                    <div className="space-y-1">
                      <div className="flex items-start justify-between gap-2">
                        <h3 className="text-[14px] font-semibold leading-snug text-foreground group-hover:text-primary">
                          {sectorLabel(key, locale)}
                        </h3>
                        <ArrowRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform motion-reduce:transform-none group-hover:translate-x-0.5 group-hover:text-primary" aria-hidden="true" />
                      </div>
                      <p className="font-mono tabular-nums text-[11px] text-muted-foreground">
                        {universeQ.isPending ? (
                          <Skeleton as="span" className="inline-block h-3 w-24" />
                        ) : stat ? (
                          <>
                            {copy.stocks(stat.size)}
                            {cap ? ` · ${formatCompact(cap)} ₺` : ""}
                          </>
                        ) : (
                          EMPTY_VALUE
                        )}
                      </p>
                    </div>

                    <dl className="grid grid-cols-3 gap-2 border-t border-border/70 pt-2.5 text-[11px]">
                      <div>
                        <dt className="text-muted-foreground">{copy.pe}</dt>
                        <dd className="font-mono font-medium tabular-nums text-foreground">
                          {formatNumber(stat?.medians.pe)}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">{copy.pb}</dt>
                        <dd className="font-mono font-medium tabular-nums text-foreground">
                          {formatNumber(stat?.medians.pb)}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">{copy.roe}</dt>
                        <dd className="font-mono font-medium tabular-nums text-foreground">
                          {formatPercent(stat?.medians.roe, 1)}
                        </dd>
                      </div>
                    </dl>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
