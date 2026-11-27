"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, BookOpen, Filter } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Breadcrumbs } from "@/components/shared/Breadcrumbs";
import { ErrorState } from "@/components/shared/ErrorState";
import { presetHref } from "@/components/tarama/model";
import { useTaramaI18n, type TaramaKey } from "@/components/tarama/i18n";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { atlasHref, getAtlasConcept, type AtlasConcept } from "@/lib/atlas";
import {
  computeGroupMetrics,
  DISCOVERY_INDICES,
  INDEX_GROUP_LABELS,
  indexPageHref,
  type DiscoveryIndex,
} from "@/lib/discovery";
import { EMPTY_VALUE, formatCompact, formatNumber, formatPercent } from "@/lib/format";
import type { Locale } from "@/lib/i18n";
import { useLocale } from "@/lib/locale-context";
import { STALE_TIME } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import { DiscoveryIndexChart } from "./DiscoveryIndexChart";
import { DiscoveryStockTable } from "./DiscoveryStockTable";

const COPY: Record<
  Locale,
  {
    openInScreener: string;
    otherIndices: string;
    summaryHeading: string;
    companies: string;
    totalCap: string;
    breadth: string;
    medianPe: string;
    medianPb: string;
    medianRoe: string;
    medianYield: string;
    quickScreens: string;
    constituentsHeading: string;
    methodologyHeading: string;
    relatedAtlas: string;
    noConstituents: string;
  }
> = {
  tr: {
    openInScreener: "Hisse Taramada Aç",
    otherIndices: "Diğer BIST endeksleri",
    summaryHeading: "Bileşen özeti ve medyan oranlar",
    companies: "Bileşen sayısı",
    totalCap: "Toplam piyasa değeri",
    breadth: "Yükselen / Düşen",
    medianPe: "Medyan F/K",
    medianPb: "Medyan PD/DD",
    medianRoe: "Medyan ROE",
    medianYield: "Medyan Temettü",
    quickScreens: "Bu endekste hazır taramalar",
    constituentsHeading: "Endeks bileşenleri",
    methodologyHeading: "Metodoloji notu",
    relatedAtlas: "İlgili kavramlar (Atlas)",
    noConstituents: "Bu endeks için bileşen listesi şu an alınamadı.",
  },
  en: {
    openInScreener: "Open in Screener",
    otherIndices: "Other BIST indices",
    summaryHeading: "Constituent summary & median ratios",
    companies: "Constituents",
    totalCap: "Total market cap",
    breadth: "Advancers / Decliners",
    medianPe: "Median P/E",
    medianPb: "Median P/B",
    medianRoe: "Median ROE",
    medianYield: "Median Yield",
    quickScreens: "Quick screens in this index",
    constituentsHeading: "Index constituents",
    methodologyHeading: "Methodology note",
    relatedAtlas: "Related concepts (Atlas)",
    noConstituents: "Constituent list is currently unavailable for this index.",
  },
  fr: {
    openInScreener: "Ouvrir dans le filtre",
    otherIndices: "Autres indices BIST",
    summaryHeading: "Synthèse et médianes des composants",
    companies: "Composants",
    totalCap: "Capitalisation totale",
    breadth: "Hausses / Baisses",
    medianPe: "PER médian",
    medianPb: "C/VC médian",
    medianRoe: "ROE médian",
    medianYield: "Rendement médian",
    quickScreens: "Filtres rapides sur cet indice",
    constituentsHeading: "Valeurs composant l'indice",
    methodologyHeading: "Note méthodologique",
    relatedAtlas: "Concepts associés (Atlas)",
    noConstituents: "La liste des composants est temporairement indisponible.",
  },
};

export function IndexDetailView({ entry }: { entry: DiscoveryIndex }) {
  const { locale, t } = useLocale();
  const { t: tt } = useTaramaI18n();
  const copy = COPY[locale];

  const universeQ = useQuery({
    queryKey: ["screener-universe"],
    queryFn: ({ signal }) => api.screenerUniverse(signal),
    staleTime: STALE_TIME.market,
  });

  const constituents = useMemo(
    () => (universeQ.data?.rows ?? []).filter((row) => row.indices?.includes(entry.code)),
    [entry.code, universeQ.data?.rows],
  );
  const metrics = useMemo(() => computeGroupMetrics(constituents), [constituents]);
  const atlasItems = useMemo(
    () => entry.relatedAtlasSlugs.map(getAtlasConcept).filter((c): c is AtlasConcept => c !== null),
    [entry.relatedAtlasSlugs],
  );

  const screenerUrl = `/tarama?idx=${encodeURIComponent(entry.code)}`;
  const isBankIndex = entry.code === "XBANK" || entry.code === "XUMAL";

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <div className="space-y-4">
        <Breadcrumbs
          items={[
            { label: t("nav.dashboard"), href: "/" },
            { label: t("nav.indices"), href: "/endeks" },
            { label: entry.name[locale], href: indexPageHref(entry.slug) },
          ]}
        />
        <PageHeader
          eyebrow={`${INDEX_GROUP_LABELS[entry.group][locale]} · ${entry.code}`}
          title={entry.name[locale]}
          description={entry.lead[locale]}
          actions={
            <Link
              href={screenerUrl}
              className="motion-press inline-flex items-center gap-1.5 rounded-md bg-foreground px-3.5 py-2 text-xs font-medium text-background transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              <Filter className="h-3.5 w-3.5" aria-hidden="true" />
              {copy.openInScreener}
            </Link>
          }
        />

        {/* Sibling index navigation (Belif category chips pattern) */}
        <nav aria-label={copy.otherIndices}>
          <ul className="flex flex-wrap gap-1.5">
            {DISCOVERY_INDICES.map((item) => {
              const current = item.slug === entry.slug;
              return (
                <li key={item.slug}>
                  <Link
                    href={indexPageHref(item.slug)}
                    aria-current={current ? "page" : undefined}
                    className={cn(
                      "inline-flex h-7 items-center rounded-md border px-2.5 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                      current
                        ? "border-foreground bg-foreground text-background"
                        : "border-border bg-card text-muted-foreground hover:border-foreground/35 hover:text-foreground",
                    )}
                  >
                    {item.name[locale]}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      </div>

      {/* Live interactive index chart */}
      <DiscoveryIndexChart symbol={entry.code} title={entry.name[locale]} />

      {/* Summary KPI strip */}
      <section className="space-y-3" aria-labelledby="index-summary-heading">
        <h2 id="index-summary-heading" className="text-base font-semibold text-foreground">
          {copy.summaryHeading}
        </h2>
        {universeQ.isPending ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="card-surface p-4">
                <Skeleton className="h-3 w-20" />
                <Skeleton className="mt-2 h-6 w-16" />
              </div>
            ))}
          </div>
        ) : universeQ.isError ? (
          <ErrorState message={universeQ.error.message} onRetry={() => void universeQ.refetch()} />
        ) : (
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <div className="card-surface p-4">
              <dt className="text-[11px] text-muted-foreground">{copy.companies}</dt>
              <dd className="mt-1 font-mono text-lg font-semibold tabular-nums text-foreground">{metrics.count}</dd>
            </div>
            <div className="card-surface p-4">
              <dt className="text-[11px] text-muted-foreground">{copy.totalCap}</dt>
              <dd className="mt-1 font-mono text-lg font-semibold tabular-nums text-foreground">
                {metrics.totalMarketCap ? `${formatCompact(metrics.totalMarketCap)} ₺` : EMPTY_VALUE}
              </dd>
            </div>
            <div className="card-surface p-4">
              <dt className="text-[11px] text-muted-foreground">{copy.breadth}</dt>
              <dd className="mt-1 font-mono text-lg font-semibold tabular-nums">
                <span className="text-up">{metrics.breadth.up}</span>
                <span className="mx-1 text-muted-foreground">/</span>
                <span className="text-down">{metrics.breadth.down}</span>
              </dd>
            </div>
            <div className="card-surface p-4">
              <dt className="text-[11px] text-muted-foreground">{copy.medianPe}</dt>
              <dd className="mt-1 font-mono text-lg font-semibold tabular-nums text-foreground">
                {formatNumber(metrics.medians.pe)}
              </dd>
            </div>
            <div className="card-surface p-4">
              <dt className="text-[11px] text-muted-foreground">{copy.medianPb}</dt>
              <dd className="mt-1 font-mono text-lg font-semibold tabular-nums text-foreground">
                {formatNumber(metrics.medians.pb)}
              </dd>
            </div>
            <div className="card-surface p-4">
              <dt className="text-[11px] text-muted-foreground">{copy.medianRoe}</dt>
              <dd className="mt-1 font-mono text-lg font-semibold tabular-nums text-foreground">
                {formatPercent(metrics.medians.roe, 1)}
              </dd>
            </div>
          </dl>
        )}
      </section>

      {/* Preset screener shortcuts inside this index */}
      <section className="space-y-2.5" aria-labelledby="index-presets-heading">
        <h2 id="index-presets-heading" className="text-sm font-semibold text-foreground">
          {copy.quickScreens}
        </h2>
        <div className="flex flex-wrap gap-2">
          {entry.presetIds.map((presetId) => (
            <Link
              key={presetId}
              href={presetHref(presetId, entry.code)}
              className="group inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:border-primary/50 hover:text-primary focus-visible:outline-2 focus-visible:outline-ring"
            >
              {tt(`preset.${presetId}` as TaramaKey)}
              <ArrowRight className="h-3 w-3 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary" aria-hidden="true" />
            </Link>
          ))}
        </div>
      </section>

      {/* Constituent table */}
      <section className="space-y-3" aria-labelledby="index-constituents-heading">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="index-constituents-heading" className="text-base font-semibold text-foreground">
            {copy.constituentsHeading}
          </h2>
          <Link href={screenerUrl} className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
            {copy.openInScreener}
            <ArrowRight className="h-3 w-3" aria-hidden="true" />
          </Link>
        </div>

        {universeQ.isPending ? (
          <div className="card-surface space-y-2 p-5">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </div>
        ) : constituents.length === 0 ? (
          <div className="card-surface p-6 text-sm text-muted-foreground">{copy.noConstituents}</div>
        ) : (
          <DiscoveryStockTable
            headingId="index-constituents-heading"
            caption={`${entry.name[locale]} (${entry.code})`}
            rows={constituents}
            metrics={metrics}
            hideEvEbitda={isBankIndex}
          />
        )}
      </section>

      {/* Methodology & related Atlas concepts */}
      <div className="grid gap-4 lg:grid-cols-3">
        <section className="card-surface space-y-2 p-5">
          <h2 className="text-sm font-semibold text-foreground">{copy.methodologyHeading}</h2>
          <p className="text-xs leading-relaxed text-muted-foreground">{entry.methodology[locale]}</p>
        </section>

        <section className="card-surface space-y-3 p-5 lg:col-span-2">
          <h2 className="inline-flex items-center gap-1.5 text-sm font-semibold text-foreground">
            <BookOpen className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
            {copy.relatedAtlas}
          </h2>
          <div className="grid gap-2.5 sm:grid-cols-3">
            {atlasItems.map((concept) => (
              <Link
                key={concept.slug}
                href={atlasHref(concept.slug)}
                className="group rounded-lg border border-border bg-surface/40 p-3 transition-colors hover:border-primary/50"
              >
                <span className="font-mono text-[10px] font-semibold text-primary">{concept.badge}</span>
                <p className="mt-1 text-xs font-semibold text-foreground group-hover:text-primary">
                  {concept.title[locale]}
                </p>
              </Link>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
