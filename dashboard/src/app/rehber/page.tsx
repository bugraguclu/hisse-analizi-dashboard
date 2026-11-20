"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowUpRight } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { DEFAULT_TICKER } from "@/components/layout/nav";
import { GUIDE_ENTRIES, type GuideCategory, type LocalizedText } from "@/components/shared/search/catalog";
import { useLocale } from "@/lib/locale-context";
import { cn } from "@/lib/utils";

const CATEGORIES: ReadonlyArray<{ id: "all" | GuideCategory; label: LocalizedText }> = [
  { id: "all", label: { tr: "Tümü", en: "All", fr: "Tous" } },
  { id: "valuation", label: { tr: "Değerleme", en: "Valuation", fr: "Valorisation" } },
  { id: "technical", label: { tr: "Teknik", en: "Technical", fr: "Technique" } },
  { id: "macro", label: { tr: "Makro", en: "Macro", fr: "Macro" } },
  { id: "usage", label: { tr: "Kullanım", en: "Usage", fr: "Utilisation" } },
];

const COPY = {
  eyebrow: { tr: "Yardım & Kavramlar", en: "Help & Concepts", fr: "Aide & Notions" },
  title: { tr: "Kavram Rehberi", en: "Concept Guide", fr: "Guide des notions" },
  subtitle: {
    tr: "Temel oranlar, teknik göstergeler, makro kavramlar ve veri kuralları için kısa açıklamalar ve ilgili ekran bağlantıları.",
    en: "Concise explanations for valuation ratios, technical indicators, macro concepts and data rules with direct links.",
    fr: "Explications concises des ratios, indicateurs techniques, notions macro et règles de données avec liens directs.",
  },
  formula: { tr: "Formül", en: "Formula", fr: "Formule" },
  filterLabel: { tr: "Kategori filtresi", en: "Category filter", fr: "Filtre de catégorie" },
} as const;

function GuideContent() {
  const { locale } = useLocale();
  const searchParams = useSearchParams();
  const focusedId = searchParams.get("konu")?.trim() ?? "";
  const [category, setCategory] = useState<"all" | GuideCategory>("all");

  const entries = useMemo(() => {
    if (category === "all") return GUIDE_ENTRIES;
    return GUIDE_ENTRIES.filter((entry) => entry.category === category);
  }, [category]);

  useEffect(() => {
    if (!focusedId) return;
    const node = document.getElementById(`guide-${focusedId}`);
    if (node) node.scrollIntoView({ behavior: "auto", block: "center" });
  }, [focusedId]);

  return (
    <div className="mx-auto max-w-5xl space-y-6 pb-8">
      <PageHeader
        eyebrow={COPY.eyebrow[locale]}
        title={COPY.title[locale]}
        description={COPY.subtitle[locale]}
      />

      <div role="group" aria-label={COPY.filterLabel[locale]} className="flex flex-wrap gap-1.5">
        {CATEGORIES.map((item) => {
          const active = category === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setCategory(item.id)}
              aria-pressed={active}
              className={cn(
                "rounded-md border px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-ring",
                active
                  ? "border-foreground bg-foreground text-background"
                  : "border-border bg-card text-muted-foreground hover:text-foreground",
              )}
            >
              {item.label[locale]}
            </button>
          );
        })}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {entries.map((entry) => {
          const highlighted = focusedId === entry.id;
          return (
            <article
              key={entry.id}
              id={`guide-${entry.id}`}
              className={cn(
                "card-surface flex flex-col justify-between gap-4 p-5 transition-colors",
                highlighted && "border-ring ring-1 ring-ring/40",
              )}
            >
              <div className="space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="inline-flex items-center rounded-sm border border-border bg-muted/60 px-2 py-0.5 font-mono text-[11px] font-semibold text-foreground">
                    {entry.code}
                  </span>
                  <span className="text-[11px] text-muted-foreground">
                    {CATEGORIES.find((c) => c.id === entry.category)?.label[locale]}
                  </span>
                </div>
                <h2 className="text-base font-semibold tracking-tight text-foreground">{entry.title[locale]}</h2>
                <p className="text-xs leading-relaxed text-muted-foreground">{entry.explanation[locale]}</p>
                {entry.formula && (
                  <p className="rounded-sm bg-muted/50 px-2.5 py-1.5 font-mono text-[11px] text-foreground">
                    <span className="mr-1.5 font-sans font-medium text-muted-foreground">{COPY.formula[locale]}:</span>
                    {entry.formula[locale]}
                  </p>
                )}
              </div>

              <div className="space-y-2 border-t border-border pt-3">
                <p className="text-[11px] leading-4 text-muted-foreground">{entry.methodology[locale]}</p>
                <Link
                  href={entry.actionHref(DEFAULT_TICKER)}
                  className="inline-flex items-center gap-1 text-xs font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-ring"
                >
                  {entry.actionLabel[locale]}
                  <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
                </Link>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}

export default function RehberPage() {
  return (
    <Suspense fallback={<div className="mx-auto max-w-5xl py-8 text-xs text-muted-foreground" />}>
      <GuideContent />
    </Suspense>
  );
}
