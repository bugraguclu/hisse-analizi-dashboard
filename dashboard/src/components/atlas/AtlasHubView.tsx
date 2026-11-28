"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight, Compass, Layers, Search, X } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Breadcrumbs } from "@/components/shared/Breadcrumbs";
import {
  ATLAS_CATEGORIES,
  ATLAS_CATEGORY_LABELS,
  ATLAS_CONCEPTS,
  ATLAS_FAQS,
  atlasHref,
  searchAtlasConcepts,
  type AtlasCategory,
} from "@/lib/atlas";
import type { Locale } from "@/lib/i18n";
import { useLocale } from "@/lib/locale-context";
import { cn } from "@/lib/utils";

const COPY: Record<
  Locale,
  {
    eyebrow: string;
    title: string;
    lead: string;
    all: string;
    searchPlaceholder: string;
    searchLabel: string;
    clearSearch: string;
    readMore: string;
    actionCount: (n: number) => string;
    noMatches: string;
    faqHeading: string;
    exploreIndices: string;
    exploreIndicesDesc: string;
    exploreSectors: string;
    exploreSectorsDesc: string;
  }
> = {
  tr: {
    eyebrow: "Yatırım Rehberi · BIST Metodolojisi",
    title: "Yatırım Kavram Atlası",
    lead: "F/K, TTM, reel getiri, RSI ve sektör medyanı gibi temel kavramların kısa açıklamaları, Hisse Analizi hesaplama kuralları ve doğrudan ilgili grafik veya hazır taramaya geçiş bağlantıları.",
    all: "Tümü",
    searchPlaceholder: "Kavram ara… (F/K, TTM, reel getiri, RSI)",
    searchLabel: "Kavram atlasında ara",
    clearSearch: "Aramayı temizle",
    readMore: "İncele",
    actionCount: (n) => `${n} uygulama bağlantısı`,
    noMatches: "Aramanızla eşleşen kavram bulunamadı.",
    faqHeading: "Sık sorulan sorular",
    exploreIndices: "BIST Endeksleri",
    exploreIndicesDesc: "BIST 100, BIST 30, Banka, Sınai ve tematik endekslerin kalıcı keşif sayfaları.",
    exploreSectors: "KAP Sektörleri",
    exploreSectorsDesc: "48 KAP sektörünün medyan çarpanları ve emsal şirket listeleri.",
  },
  en: {
    eyebrow: "Investment Guide · BIST Methodology",
    title: "Investment Concept Atlas",
    lead: "Concise explanations of P/E, TTM, real returns, RSI and sector medians, paired with Hisse Analizi calculation rules and direct links to live charts and stock screens.",
    all: "All",
    searchPlaceholder: "Search concepts… (P/E, TTM, real return, RSI)",
    searchLabel: "Search concept atlas",
    clearSearch: "Clear search",
    readMore: "Open",
    actionCount: (n) => `${n} live links`,
    noMatches: "No concepts match your search.",
    faqHeading: "Frequently asked questions",
    exploreIndices: "BIST Indices",
    exploreIndicesDesc: "Canonical discovery pages for BIST 100, BIST 30, Banks, Industrials and thematic indices.",
    exploreSectors: "KAP Sectors",
    exploreSectorsDesc: "Live sector medians and listed peer tables across all 48 KAP sectors.",
  },
  fr: {
    eyebrow: "Guide d'investissement · Méthodologie BIST",
    title: "Atlas des concepts d'investissement",
    lead: "Explications claires du PER, du TTM, du rendement réel, du RSI et des médianes sectorielles, avec nos règles de calcul et un accès direct aux graphiques et filtres.",
    all: "Tous",
    searchPlaceholder: "Rechercher un concept… (PER, TTM, RSI)",
    searchLabel: "Rechercher dans l'atlas",
    clearSearch: "Effacer la recherche",
    readMore: "Consulter",
    actionCount: (n) => `${n} liens directs`,
    noMatches: "Aucun concept ne correspond à votre recherche.",
    faqHeading: "Questions fréquentes",
    exploreIndices: "Indices BIST",
    exploreIndicesDesc: "Pages canoniques du BIST 100, BIST 30, Banques, Industrie et indices thématiques.",
    exploreSectors: "Secteurs KAP",
    exploreSectorsDesc: "Médianes en direct et listes de sociétés pour les 48 secteurs KAP.",
  },
};

export function AtlasHubView() {
  const { locale, t } = useLocale();
  const copy = COPY[locale];
  const [category, setCategory] = useState<AtlasCategory | "all">("all");
  const [query, setQuery] = useState("");

  const concepts = useMemo(() => {
    const trimmed = query.trim();
    const base = trimmed ? searchAtlasConcepts(trimmed, locale, ATLAS_CONCEPTS.length) : ATLAS_CONCEPTS;
    if (category === "all") return base;
    return base.filter((item) => item.category === category);
  }, [category, locale, query]);

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <div className="space-y-4">
        <Breadcrumbs
          items={[
            { label: t("nav.dashboard"), href: "/" },
            { label: t("nav.atlas"), href: "/atlas" },
          ]}
        />
        <PageHeader
          eyebrow={copy.eyebrow}
          title={copy.title}
          description={copy.lead}
          className="[&_h1]:font-display [&_h1]:font-normal"
        />
      </div>

      {/* Category chips + quick filter */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-wrap gap-1.5" role="group" aria-label={copy.eyebrow}>
          <button
            type="button"
            onClick={() => setCategory("all")}
            aria-pressed={category === "all"}
            className={cn(
              "motion-press-subtle rounded-md border px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring pointer-coarse:min-h-11",
              category === "all"
                ? "border-foreground bg-foreground text-background"
                : "border-border bg-card text-muted-foreground hover:border-foreground/35 hover:text-foreground",
            )}
          >
            {copy.all} ({ATLAS_CONCEPTS.length})
          </button>
          {ATLAS_CATEGORIES.map((cat) => {
            const count = ATLAS_CONCEPTS.filter((item) => item.category === cat).length;
            const active = category === cat;
            return (
              <button
                key={cat}
                type="button"
                onClick={() => setCategory(cat)}
                aria-pressed={active}
                className={cn(
                  "motion-press-subtle rounded-md border px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring pointer-coarse:min-h-11",
                  active
                    ? "border-foreground bg-foreground text-background"
                    : "border-border bg-card text-muted-foreground hover:border-foreground/35 hover:text-foreground",
                )}
              >
                {ATLAS_CATEGORY_LABELS[cat][locale]} ({count})
              </button>
            );
          })}
        </div>

        <div className="relative w-full shrink-0 sm:w-64">
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
              aria-label={copy.clearSearch}
              className="motion-press-subtle absolute right-1.5 top-1/2 inline-flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring pointer-coarse:right-0 pointer-coarse:h-11 pointer-coarse:w-11"
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          )}
        </div>
      </div>

      {/* Numbered editorial concept list (Belif atlas pattern) */}
      {concepts.length === 0 ? (
        <div className="card-surface p-8 text-center text-sm text-muted-foreground">{copy.noMatches}</div>
      ) : (
        <ol className="space-y-3">
          {concepts.map((concept, index) => (
            <li key={concept.slug}>
              <Link
                href={atlasHref(concept.slug)}
                className="group card-surface flex items-start gap-4 p-4 transition-colors hover:border-foreground/35 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring sm:items-center sm:gap-6 sm:p-5"
              >
                <span className="w-8 shrink-0 pt-0.5 text-center font-mono text-lg font-medium tabular-nums text-muted-foreground/75 sm:w-10 sm:pt-0 sm:text-xl">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-sm bg-surface px-1.5 py-0.5 font-mono text-[11px] font-semibold text-foreground">
                      {concept.badge}
                    </span>
                    <span className="text-[11px] text-muted-foreground">
                      {ATLAS_CATEGORY_LABELS[concept.category][locale]}
                    </span>
                  </div>
                  <h2 className="text-base font-medium leading-snug text-foreground sm:text-[17px]">
                    {concept.title[locale]}
                  </h2>
                  <p className="text-[13px] leading-relaxed text-muted-foreground">{concept.cardDesc[locale]}</p>
                  <p className="pt-0.5 font-mono text-[11px] text-muted-foreground/85">
                    {copy.actionCount(concept.actions.length)}
                  </p>
                </div>
                <span className="hidden shrink-0 items-center gap-1 text-xs font-medium text-muted-foreground transition-colors group-hover:text-foreground sm:inline-flex">
                  {copy.readMore}
                  <ArrowRight className="h-3.5 w-3.5 transition-transform motion-reduce:transform-none group-hover:translate-x-0.5" aria-hidden="true" />
                </span>
              </Link>
            </li>
          ))}
        </ol>
      )}

      {/* Cross-links to canonical index & sector hubs */}
      <div className="grid gap-3 sm:grid-cols-2">
        <Link
          href="/endeks"
          className="group card-surface flex items-start justify-between gap-4 p-5 transition-colors hover:border-foreground/35 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <div className="space-y-1">
            <span className="inline-flex items-center gap-1.5 font-mono text-[11px] font-medium text-muted-foreground">
              <Compass className="h-3.5 w-3.5" aria-hidden="true" />
              /endeks
            </span>
            <h2 className="text-[15px] font-semibold text-foreground">{copy.exploreIndices}</h2>
            <p className="text-xs leading-relaxed text-muted-foreground">{copy.exploreIndicesDesc}</p>
          </div>
          <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground transition-transform motion-reduce:transform-none group-hover:translate-x-0.5 group-hover:text-foreground" aria-hidden="true" />
        </Link>

        <Link
          href="/sektor"
          className="group card-surface flex items-start justify-between gap-4 p-5 transition-colors hover:border-foreground/35 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <div className="space-y-1">
            <span className="inline-flex items-center gap-1.5 font-mono text-[11px] font-medium text-muted-foreground">
              <Layers className="h-3.5 w-3.5" aria-hidden="true" />
              /sektor
            </span>
            <h2 className="text-[15px] font-semibold text-foreground">{copy.exploreSectors}</h2>
            <p className="text-xs leading-relaxed text-muted-foreground">{copy.exploreSectorsDesc}</p>
          </div>
          <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground transition-transform motion-reduce:transform-none group-hover:translate-x-0.5 group-hover:text-foreground" aria-hidden="true" />
        </Link>
      </div>

      {/* Native <details> FAQ accordion (no headings inside <summary> per a11y guidance) */}
      <section className="atlas-accordion space-y-3 pt-2" aria-labelledby="atlas-faq-heading">
        <h2 id="atlas-faq-heading" className="text-lg font-semibold text-foreground">
          {copy.faqHeading}
        </h2>
        <div className="divide-y divide-border card-surface">
          {ATLAS_FAQS.map((faq, idx) => (
            <details key={idx} className="group">
              <summary className="flex items-center gap-2.5 px-5 py-4 text-sm font-medium text-foreground transition-colors hover:bg-surface/70 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring">
                <span>{faq.question[locale]}</span>
              </summary>
              <div className="px-5 pb-4 pl-9 text-[13px] leading-relaxed text-muted-foreground">
                {faq.answer[locale]}
              </div>
            </details>
          ))}
        </div>
      </section>
    </div>
  );
}
