"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, BookOpen, Compass, Filter } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Breadcrumbs } from "@/components/shared/Breadcrumbs";
import { ErrorState } from "@/components/shared/ErrorState";
import { sectorIndexOf } from "@/components/charts/sector-index";
import { findQuote, useIndexQuotes } from "@/components/dashboard/queries";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { atlasHref, getAtlasConcept, type AtlasConcept } from "@/lib/atlas";
import {
  computeGroupMetrics,
  FEATURED_SECTORS,
  indexByCode,
  indexPageHref,
  isFinancialSector,
  sectorEditorialLead,
  sectorPageHref,
  sectorRelatedAtlasSlugs,
} from "@/lib/discovery";
import {
  EMPTY_VALUE,
  formatChangePercent,
  formatCompact,
  formatNumber,
  formatPercent,
  TREND_TEXT_CLASS,
  trendTone,
} from "@/lib/format";
import type { Locale } from "@/lib/i18n";
import { useLocale } from "@/lib/locale-context";
import { STALE_TIME } from "@/lib/queryClient";
import { sectorHref, sectorLabel } from "@/lib/sectors";
import { cn } from "@/lib/utils";
import { DiscoveryStockTable } from "./DiscoveryStockTable";

const COPY: Record<
  Locale,
  {
    eyebrow: string;
    openInScreener: string;
    peBelowSector: string;
    roeAboveSector: string;
    featuredSectors: string;
    allSectorsLink: string;
    summaryHeading: string;
    companies: string;
    totalCap: string;
    breadth: string;
    medianPe: string;
    medianPb: string;
    medianEvEbitda: string;
    medianRoe: string;
    medianYield: string;
    trackedIndex: string;
    companiesHeading: string;
    methodologyHeading: string;
    methodologyBody: string;
    relatedAtlas: string;
    noCompanies: string;
  }
> = {
  tr: {
    eyebrow: "KAP Sektör Keşfi",
    openInScreener: "Hisse Taramada Aç",
    peBelowSector: "F/K medyan altı",
    roeAboveSector: "ROE medyan üstü",
    featuredSectors: "Öne çıkan sektörler",
    allSectorsLink: "Tüm sektörler",
    summaryHeading: "Sektör özeti ve medyan oranlar",
    companies: "Şirket sayısı",
    totalCap: "Toplam piyasa değeri",
    breadth: "Yükselen / Düşen",
    medianPe: "Medyan F/K",
    medianPb: "Medyan PD/DD",
    medianEvEbitda: "Medyan FD/FAVÖK",
    medianRoe: "Medyan ROE",
    medianYield: "Medyan Temettü",
    trackedIndex: "İlgili BIST sektör endeksi",
    companiesHeading: "Sektör şirketleri",
    methodologyHeading: "Medyan hesaplama kuralı",
    methodologyBody:
      "Medyan değerler en az 3 geçerli şirkete sahip kalemlerde gösterilir. F/K, PD/DD ve FD/FAVÖK medyanlarında yalnızca pozitif değerler, temettü veriminde ise yalnızca temettü ödeyenler sayılır.",
    relatedAtlas: "İlgili kavramlar (Atlas)",
    noCompanies: "Bu sektörde şu an listelenen şirket verisi bulunamadı.",
  },
  en: {
    eyebrow: "KAP Sector Discovery",
    openInScreener: "Open in Screener",
    peBelowSector: "P/E below median",
    roeAboveSector: "ROE above median",
    featuredSectors: "Major sectors",
    allSectorsLink: "All sectors",
    summaryHeading: "Sector summary & median ratios",
    companies: "Companies",
    totalCap: "Total market cap",
    breadth: "Advancers / Decliners",
    medianPe: "Median P/E",
    medianPb: "Median P/B",
    medianEvEbitda: "Median EV/EBITDA",
    medianRoe: "Median ROE",
    medianYield: "Median Yield",
    trackedIndex: "Tracking BIST sector index",
    companiesHeading: "Listed companies in sector",
    methodologyHeading: "Median calculation rule",
    methodologyBody:
      "Medians require at least 3 valid companies. P/E, P/B and EV/EBITDA count positive multiples only; dividend yield counts payers only.",
    relatedAtlas: "Related concepts (Atlas)",
    noCompanies: "No listed companies are currently available for this sector.",
  },
  fr: {
    eyebrow: "Découverte secteur KAP",
    openInScreener: "Ouvrir dans le filtre",
    peBelowSector: "PER sous la médiane",
    roeAboveSector: "ROE au-dessus de la médiane",
    featuredSectors: "Secteurs majeurs",
    allSectorsLink: "Tous les secteurs",
    summaryHeading: "Synthèse et médianes sectorielles",
    companies: "Sociétés",
    totalCap: "Capitalisation totale",
    breadth: "Hausses / Baisses",
    medianPe: "PER médian",
    medianPb: "C/VC médian",
    medianEvEbitda: "VE/EBITDA médian",
    medianRoe: "ROE médian",
    medianYield: "Rendement médian",
    trackedIndex: "Indice sectoriel BIST associé",
    companiesHeading: "Sociétés cotées du secteur",
    methodologyHeading: "Règle de calcul des médianes",
    methodologyBody:
      "Chaque médiane exige au moins 3 sociétés valides. PER, C/VC et VE/EBITDA ne comptent que les valeurs positives ; le rendement uniquement les payeurs.",
    relatedAtlas: "Concepts associés (Atlas)",
    noCompanies: "Aucune société cotée n'est disponible pour ce secteur.",
  },
};

export function SectorDetailView({ sectorKey }: { sectorKey: string }) {
  const { locale, t } = useLocale();
  const copy = COPY[locale];
  const name = sectorLabel(sectorKey, locale);
  const lead = sectorEditorialLead(sectorKey, locale);
  const financial = isFinancialSector(sectorKey);

  const universeQ = useQuery({
    queryKey: ["screenerUniverse"],
    queryFn: ({ signal }) => api.screenerUniverse(signal),
    staleTime: STALE_TIME.market,
  });
  const quotesQ = useIndexQuotes();

  const companies = useMemo(
    () => (universeQ.data?.rows ?? []).filter((row) => row.kap_sector === sectorKey),
    [sectorKey, universeQ.data?.rows],
  );
  const metrics = useMemo(() => computeGroupMetrics(companies), [companies]);

  const linkedIndex = sectorIndexOf(sectorKey);
  const canonicalIndex = linkedIndex ? indexByCode(linkedIndex.symbol) : null;
  const linkedIndexQuote = linkedIndex ? findQuote(quotesQ.data?.quotes, linkedIndex.symbol) : null;

  const atlasItems = useMemo(
    () =>
      sectorRelatedAtlasSlugs(sectorKey)
        .map(getAtlasConcept)
        .filter((c): c is AtlasConcept => c !== null),
    [sectorKey],
  );

  const siblingKeys = useMemo(() => {
    if (FEATURED_SECTORS.includes(sectorKey)) return FEATURED_SECTORS;
    return [sectorKey, ...FEATURED_SECTORS.slice(0, 11)];
  }, [sectorKey]);

  const screenerUrl = sectorHref(sectorKey, "fundamentals");

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <div className="space-y-4">
        <Breadcrumbs
          items={[
            { label: t("nav.dashboard"), href: "/" },
            { label: t("nav.sectors"), href: "/sektor" },
            { label: name, href: sectorPageHref(sectorKey) },
          ]}
        />
        <PageHeader
          eyebrow={copy.eyebrow}
          title={name}
          description={lead}
          className="[&_h1]:font-display [&_h1]:font-normal"
          actions={
            <Link
              href={screenerUrl}
              className="motion-press inline-flex items-center gap-1.5 rounded-md bg-foreground px-3.5 py-2 text-xs font-medium text-background transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring pointer-coarse:min-h-11"
            >
              <Filter className="h-3.5 w-3.5" aria-hidden="true" />
              {copy.openInScreener}
            </Link>
          }
        />

        {/* Sibling featured sectors nav */}
        <nav aria-label={copy.featuredSectors}>
          <ul className="flex flex-wrap gap-1.5">
            {siblingKeys.map((key) => {
              const current = key === sectorKey;
              return (
                <li key={key}>
                  <Link
                    href={sectorPageHref(key)}
                    aria-current={current ? "page" : undefined}
                    className={cn(
                      "motion-press-subtle inline-flex items-center rounded-md border px-3 py-1 text-xs transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring pointer-coarse:min-h-11",
                      current
                        ? "border-foreground bg-foreground text-background"
                        : "border-border bg-card text-muted-foreground hover:border-foreground/35 hover:text-foreground",
                    )}
                  >
                    {sectorLabel(key, locale)}
                  </Link>
                </li>
              );
            })}
            <li>
              <Link
                href="/sektor"
                className="motion-press-subtle inline-flex items-center rounded-md border border-dashed border-border px-3 py-1 text-xs text-muted-foreground transition-colors hover:border-foreground/40 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring pointer-coarse:min-h-11"
              >
                {copy.allSectorsLink} →
              </Link>
            </li>
          </ul>
        </nav>
      </div>

      {/* Linked BIST sector index banner when available */}
      {linkedIndex && (
        <div className="card-surface flex flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="flex flex-wrap items-center gap-2.5 text-xs">
            <Compass className="h-4 w-4 text-primary" aria-hidden="true" />
            <span className="text-muted-foreground">{copy.trackedIndex}:</span>
            <span className="font-mono font-semibold text-foreground">{linkedIndex.symbol}</span>
            <span className="font-medium text-foreground">{linkedIndex.name}</span>
            {linkedIndexQuote && linkedIndexQuote.last !== null && linkedIndexQuote.last > 0 && (
              <span className="inline-flex items-baseline gap-1.5 font-mono tabular-nums">
                <span className="font-semibold text-foreground">{formatNumber(linkedIndexQuote.last)}</span>
                <span className={cn(TREND_TEXT_CLASS[trendTone(linkedIndexQuote.change_percent)])}>
                  {formatChangePercent(linkedIndexQuote.change_percent)}
                </span>
              </span>
            )}
          </div>
          {canonicalIndex && (
            <Link
              href={indexPageHref(canonicalIndex.slug)}
              className="motion-press-subtle inline-flex items-center gap-1 rounded-sm text-xs font-medium text-primary hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring pointer-coarse:min-h-11"
            >
              {canonicalIndex.name[locale]}
              <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </Link>
          )}
        </div>
      )}

      {/* Sector KPI / median strip */}
      <section className="space-y-3" aria-labelledby="sector-summary-heading">
        <h2 id="sector-summary-heading" className="text-base font-semibold text-foreground">
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
              <dt className="text-[11px] text-muted-foreground">
                {financial ? copy.medianPb : copy.medianEvEbitda}
              </dt>
              <dd className="mt-1 font-mono text-lg font-semibold tabular-nums text-foreground">
                {formatNumber(financial ? metrics.medians.pb : metrics.medians.ev_ebitda)}
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

        {/* Quick relative screener links scoped to this sector */}
        <div className="flex flex-wrap gap-2 pt-1">
          <Link
            href={`/tarama?sector=${encodeURIComponent(sectorKey)}&screen=pe_below_sector&view=fundamentals&sort=pe&dir=asc`}
            className="motion-press-subtle group inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:border-primary/50 hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring pointer-coarse:min-h-11"
          >
            {copy.peBelowSector}
            <ArrowRight className="h-3 w-3 text-muted-foreground group-hover:text-primary" aria-hidden="true" />
          </Link>
          <Link
            href={`/tarama?sector=${encodeURIComponent(sectorKey)}&screen=roe_above_sector&view=fundamentals&sort=roe&dir=desc`}
            className="motion-press-subtle group inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:border-primary/50 hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring pointer-coarse:min-h-11"
          >
            {copy.roeAboveSector}
            <ArrowRight className="h-3 w-3 text-muted-foreground group-hover:text-primary" aria-hidden="true" />
          </Link>
        </div>
      </section>

      {/* Listed companies table */}
      <section className="space-y-3" aria-labelledby="sector-companies-heading">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="sector-companies-heading" className="text-base font-semibold text-foreground">
            {copy.companiesHeading}
          </h2>
          <Link href={screenerUrl} className="motion-press-subtle inline-flex items-center gap-1 rounded-sm text-xs font-medium text-primary hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring pointer-coarse:min-h-11">
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
        ) : universeQ.isError ? (
          <ErrorState message={universeQ.error.message} onRetry={() => void universeQ.refetch()} />
        ) : companies.length === 0 ? (
          <div className="card-surface p-6 text-sm text-muted-foreground">{copy.noCompanies}</div>
        ) : (
          <DiscoveryStockTable
            headingId="sector-companies-heading"
            caption={name}
            rows={companies}
            metrics={metrics}
            hideEvEbitda={financial}
          />
        )}
      </section>

      {/* Methodology & related Atlas concepts */}
      <div className="grid gap-4 lg:grid-cols-3">
        <section className="card-surface space-y-2 p-5">
          <h2 className="text-sm font-semibold text-foreground">{copy.methodologyHeading}</h2>
          <p className="text-xs leading-relaxed text-muted-foreground">{copy.methodologyBody}</p>
        </section>

        <section className="card-surface space-y-3 p-5 lg:col-span-2">
          <h2 className="inline-flex items-center gap-1.5 text-sm font-semibold text-foreground">
            <BookOpen className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
            {copy.relatedAtlas}
          </h2>
          <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
            {atlasItems.map((concept) => (
              <Link
                key={concept.slug}
                href={atlasHref(concept.slug)}
                className="group rounded-md border border-border bg-surface/40 p-3 transition-colors hover:border-primary/50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
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
