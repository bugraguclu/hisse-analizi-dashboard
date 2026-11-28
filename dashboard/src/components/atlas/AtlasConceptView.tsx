"use client";

import Link from "next/link";
import { ArrowLeft, ArrowRight, BarChart3, Compass, Filter, Globe, Layers } from "lucide-react";
import { Breadcrumbs } from "@/components/shared/Breadcrumbs";
import {
  ATLAS_CATEGORY_LABELS,
  ATLAS_CONCEPTS,
  atlasHref,
  getRelatedConcepts,
  type AtlasActionKind,
  type AtlasConcept,
} from "@/lib/atlas";
import type { Locale } from "@/lib/i18n";
import { useLocale } from "@/lib/locale-context";

const ACTION_ICON: Record<AtlasActionKind, typeof Filter> = {
  screener: Filter,
  chart: BarChart3,
  macro: Globe,
  sector: Layers,
  index: Compass,
};

const COPY: Record<
  Locale,
  {
    back: string;
    formula: string;
    pointsHeading: string;
    methodologyHeading: string;
    sourceLabel: string;
    actionsHeading: string;
    actionsLead: string;
    relatedHeading: string;
    openAction: string;
    prev: string;
    next: string;
    kindLabel: Record<AtlasActionKind, string>;
  }
> = {
  tr: {
    back: "Tüm kavramlar",
    formula: "Formül",
    pointsHeading: "Neye dikkat etmeli?",
    methodologyHeading: "Hisse Analizi metodolojisi ve kaynak",
    sourceLabel: "Veri kaynağı",
    actionsHeading: "Uygulamada gör",
    actionsLead: "Bu kavramı doğrudan canlı tarama, grafik veya keşif ekranında uygulayın.",
    relatedHeading: "İlgili kavramlar",
    openAction: "Ekranı aç",
    prev: "Önceki kavram",
    next: "Sonraki kavram",
    kindLabel: {
      screener: "Hazır Tarama",
      chart: "Grafik & Analiz",
      macro: "Makro Ekranı",
      sector: "Sektör Sayfası",
      index: "Endeks Sayfası",
    },
  },
  en: {
    back: "All concepts",
    formula: "Formula",
    pointsHeading: "What to watch for",
    methodologyHeading: "Hisse Analizi methodology & source",
    sourceLabel: "Data source",
    actionsHeading: "Open in the app",
    actionsLead: "Jump directly from this concept into live screens, charts or discovery views.",
    relatedHeading: "Related concepts",
    openAction: "Open view",
    prev: "Previous concept",
    next: "Next concept",
    kindLabel: {
      screener: "Stock Screener",
      chart: "Chart & Analysis",
      macro: "Macro Panel",
      sector: "Sector Page",
      index: "Index Page",
    },
  },
  fr: {
    back: "Tous les concepts",
    formula: "Formule",
    pointsHeading: "Points d'attention",
    methodologyHeading: "Méthodologie et sources",
    sourceLabel: "Source des données",
    actionsHeading: "Ouvrir dans l'application",
    actionsLead: "Accédez directement aux filtres, graphiques ou pages de découverte associés.",
    relatedHeading: "Concepts associés",
    openAction: "Ouvrir",
    prev: "Concept précédent",
    next: "Concept suivant",
    kindLabel: {
      screener: "Filtre prédéfini",
      chart: "Graphique & Analyse",
      macro: "Macro-économie",
      sector: "Page Secteur",
      index: "Page Indice",
    },
  },
};

export function AtlasConceptView({ concept }: { concept: AtlasConcept }) {
  const { locale, t } = useLocale();
  const copy = COPY[locale];
  const related = getRelatedConcepts(concept);
  const index = ATLAS_CONCEPTS.findIndex((item) => item.slug === concept.slug);
  const prev = index > 0 ? ATLAS_CONCEPTS[index - 1] : null;
  const next = index >= 0 && index < ATLAS_CONCEPTS.length - 1 ? ATLAS_CONCEPTS[index + 1] : null;

  return (
    <article className="mx-auto max-w-3xl space-y-8">
      <div className="space-y-4">
        <Breadcrumbs
          items={[
            { label: t("nav.dashboard"), href: "/" },
            { label: t("nav.atlas"), href: "/atlas" },
            { label: concept.title[locale], href: atlasHref(concept.slug) },
          ]}
        />

        <div className="border-b border-border pb-6">
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span className="rounded-sm bg-surface px-1.5 py-0.5 font-mono text-[11px] font-semibold text-foreground">
              {concept.badge}
            </span>
            <span>{ATLAS_CATEGORY_LABELS[concept.category][locale]}</span>
          </div>
          <h1 className="mt-2.5 font-display text-[28px] font-normal leading-tight text-foreground md:text-[34px]">
            {concept.title[locale]}
          </h1>
          <p className="mt-3 text-[15px] leading-relaxed text-foreground/85">{concept.intro[locale]}</p>
        </div>
      </div>

      {/* Formula block when present */}
      {concept.formula && (
        <section className="card-surface bg-surface/60 px-5 py-4" aria-label={copy.formula}>
          <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{copy.formula}</p>
          <p className="mt-1.5 overflow-x-auto font-mono text-[13px] font-medium text-foreground">
            {concept.formula[locale]}
          </p>
        </section>
      )}

      {/* Live in-app actions: direct transition to screener / chart / index / sector */}
      <section className="space-y-3" aria-labelledby="atlas-actions-heading">
        <div>
          <h2 id="atlas-actions-heading" className="text-lg font-semibold text-foreground">
            {copy.actionsHeading}
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">{copy.actionsLead}</p>
        </div>
        <div className="space-y-2.5">
          {concept.actions.map((action) => {
            const Icon = ACTION_ICON[action.kind];
            return (
              <Link
                key={action.href}
                href={action.href}
                className="group card-surface flex items-center justify-between gap-4 p-4 transition-colors hover:border-primary/50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                <div className="min-w-0 space-y-1">
                  <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-primary">
                    <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                    {copy.kindLabel[action.kind]}
                  </span>
                  <p className="text-sm font-semibold text-foreground group-hover:text-primary">
                    {action.label[locale]}
                  </p>
                  <p className="text-xs leading-relaxed text-muted-foreground">{action.description[locale]}</p>
                </div>
                <span className="hidden shrink-0 items-center gap-1 text-xs font-medium text-primary sm:inline-flex">
                  {copy.openAction}
                  <ArrowRight className="h-3.5 w-3.5 transition-transform motion-reduce:transform-none group-hover:translate-x-0.5" aria-hidden="true" />
                </span>
              </Link>
            );
          })}
        </div>
      </section>

      {/* Key nuances */}
      <section className="space-y-3" aria-labelledby="atlas-points-heading">
        <h2 id="atlas-points-heading" className="text-lg font-semibold text-foreground">
          {copy.pointsHeading}
        </h2>
        <ul className="space-y-2.5">
          {concept.points[locale].map((point, idx) => (
            <li key={idx} className="flex gap-3 text-sm leading-relaxed text-foreground/85">
              <span aria-hidden="true" className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
              <span>{point}</span>
            </li>
          ))}
        </ul>
      </section>

      {/* Methodology & source provenance */}
      <section className="card-surface space-y-2 p-5" aria-labelledby="atlas-methodology-heading">
        <h2 id="atlas-methodology-heading" className="text-sm font-semibold text-foreground">
          {copy.methodologyHeading}
        </h2>
        <p className="text-[13px] leading-relaxed text-muted-foreground">{concept.methodology[locale]}</p>
        <p className="pt-1 font-mono text-[11px] text-muted-foreground">
          {copy.sourceLabel}: {concept.source[locale]}
        </p>
      </section>

      {/* Related concepts */}
      {related.length > 0 && (
        <section className="space-y-3" aria-labelledby="atlas-related-heading">
          <h2 id="atlas-related-heading" className="text-base font-semibold text-foreground">
            {copy.relatedHeading}
          </h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {related.map((item) => (
              <Link
                key={item.slug}
                href={atlasHref(item.slug)}
                className="group card-surface flex flex-col justify-between gap-2 p-4 transition-colors hover:border-foreground/35 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                <div className="space-y-1">
                  <span className="inline-block rounded-sm bg-surface px-1.5 py-0.5 font-mono text-[10px] font-semibold text-foreground">
                    {item.badge}
                  </span>
                  <p className="text-sm font-semibold text-foreground group-hover:text-primary">{item.title[locale]}</p>
                  <p className="text-xs leading-relaxed text-muted-foreground">{item.cardDesc[locale]}</p>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Sequential prev / next navigation */}
      <nav aria-label={copy.back} className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-5 text-xs">
        {prev ? (
          <Link
            href={atlasHref(prev.slug)}
            className="motion-press-subtle inline-flex items-center gap-1.5 rounded-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring pointer-coarse:min-h-11"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
            <span>
              <span className="block text-[10px] uppercase tracking-wider text-muted-foreground/75">{copy.prev}</span>
              <span className="font-medium text-foreground">{prev.title[locale]}</span>
            </span>
          </Link>
        ) : (
          <Link href="/atlas" className="motion-press-subtle inline-flex items-center gap-1.5 rounded-sm text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring pointer-coarse:min-h-11">
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
            {copy.back}
          </Link>
        )}

        {next ? (
          <Link
            href={atlasHref(next.slug)}
            className="motion-press-subtle inline-flex items-center gap-1.5 rounded-sm text-right text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring pointer-coarse:min-h-11"
          >
            <span>
              <span className="block text-[10px] uppercase tracking-wider text-muted-foreground/75">{copy.next}</span>
              <span className="font-medium text-foreground">{next.title[locale]}</span>
            </span>
            <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </Link>
        ) : null}
      </nav>
    </article>
  );
}
