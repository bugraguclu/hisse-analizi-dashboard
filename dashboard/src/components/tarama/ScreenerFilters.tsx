"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, SlidersHorizontal, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useLocale } from "@/lib/locale-context";
import type { Locale } from "@/lib/i18n";

/**
 * Screener template ids (borsapy `Screener.TEMPLATES`, confirmed live via
 * GET /market/screener/templates) with correct Turkish/English/French
 * labels. The previous inline dict was missing "low_upside", "low_volume"
 * and "sell_recommendation" entirely (silently falling back to the raw,
 * underscore-separated id) and had ASCII-mangled Turkish for the rest
 * (e.g. "Dusuk F/K" instead of "Düşük F/K").
 */
const TEMPLATE_LABELS: Record<string, Record<Locale, string>> = {
  small_cap: { tr: "Küçük Sermaye", en: "Small Cap", fr: "Petite Capitalisation" },
  mid_cap: { tr: "Orta Sermaye", en: "Mid Cap", fr: "Capitalisation Moyenne" },
  large_cap: { tr: "Büyük Sermaye", en: "Large Cap", fr: "Grande Capitalisation" },
  high_dividend: { tr: "Yüksek Temettü", en: "High Dividend", fr: "Dividende Élevé" },
  high_upside: { tr: "Yüksek Potansiyel", en: "High Upside", fr: "Fort Potentiel" },
  low_upside: { tr: "Düşük Potansiyel", en: "Low Upside", fr: "Faible Potentiel" },
  high_volume: { tr: "Yüksek Hacim", en: "High Volume", fr: "Volume Élevé" },
  low_volume: { tr: "Düşük Hacim", en: "Low Volume", fr: "Volume Faible" },
  buy_recommendation: { tr: "Al Önerisi", en: "Buy Recommendation", fr: "Recommandation d'Achat" },
  sell_recommendation: { tr: "Sat Önerisi", en: "Sell Recommendation", fr: "Recommandation de Vente" },
  high_net_margin: { tr: "Yüksek Net Marj", en: "High Net Margin", fr: "Marge Nette Élevée" },
  high_return: { tr: "Yüksek Getiri", en: "High Return", fr: "Rendement Élevé" },
  low_pe: { tr: "Düşük F/K", en: "Low P/E", fr: "PER Faible" },
  high_roe: { tr: "Yüksek ROE", en: "High ROE", fr: "ROE Élevé" },
  high_foreign_ownership: { tr: "Yüksek Yabancı Oranı", en: "High Foreign Ownership", fr: "Forte Part Étrangère" },
};

function templateLabel(id: string, locale: Locale): string {
  const known = TEMPLATE_LABELS[id];
  if (known) return known[locale];
  // Defensive fallback for a template id the backend adds later.
  return id.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Range-filter keys the backend's `_NUMERIC_FILTERS`/`_RANGE_FILTER_ALIASES`
 * accept (src/adapters/screener_adapter.py) — sent as `${key}_min`/`${key}_max`.
 * `market_cap` is in *million TL* (İş Yatırım units), matching the backend. */
export const RANGE_FILTER_KEYS = ["market_cap", "pe", "pb", "dividend_yield", "upside_potential", "net_margin", "roe"] as const;
export type RangeFilterKey = (typeof RANGE_FILTER_KEYS)[number];
export type RangeFilters = Record<RangeFilterKey, [string, string]>;

export const EMPTY_RANGE_FILTERS: RangeFilters = {
  market_cap: ["", ""],
  pe: ["", ""],
  pb: ["", ""],
  dividend_yield: ["", ""],
  upside_potential: ["", ""],
  net_margin: ["", ""],
  roe: ["", ""],
};

const RANGE_LABELS: Record<RangeFilterKey, Record<Locale, string>> = {
  market_cap: { tr: "Piyasa Değeri (Milyon TL)", en: "Market Cap (Million TRY)", fr: "Capitalisation (Millions TRY)" },
  pe: { tr: "F/K", en: "P/E", fr: "PER" },
  pb: { tr: "PD/DD", en: "P/B", fr: "C/VC" },
  dividend_yield: { tr: "Temettü Verimi (%)", en: "Dividend Yield (%)", fr: "Rendement du dividende (%)" },
  upside_potential: { tr: "Yükseliş Potansiyeli (%)", en: "Upside Potential (%)", fr: "Potentiel de hausse (%)" },
  net_margin: { tr: "Net Kâr Marjı (%)", en: "Net Margin (%)", fr: "Marge nette (%)" },
  roe: { tr: "ROE (%)", en: "ROE (%)", fr: "ROE (%)" },
};

export function rangesToApiFilters(ranges: RangeFilters): Record<string, number> {
  const out: Record<string, number> = {};
  for (const key of RANGE_FILTER_KEYS) {
    const [min, max] = ranges[key];
    if (min.trim() !== "" && Number.isFinite(Number(min))) out[`${key}_min`] = Number(min);
    if (max.trim() !== "" && Number.isFinite(Number(max))) out[`${key}_max`] = Number(max);
  }
  return out;
}

export function hasActiveRanges(ranges: RangeFilters): boolean {
  return RANGE_FILTER_KEYS.some((k) => ranges[k][0] !== "" || ranges[k][1] !== "");
}

const chipClass = (active: boolean) =>
  `px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-all border ${
    active ? "bg-primary text-primary-foreground border-primary" : "border-border/60 text-muted-foreground hover:text-foreground hover:border-primary/40"
  }`;

export function ScreenerFilters({
  templates,
  activeTemplate,
  onTemplateChange,
  initialRanges,
  onRangesCommit,
}: {
  templates: string[];
  activeTemplate: string;
  onTemplateChange: (id: string) => void;
  initialRanges: RangeFilters;
  onRangesCommit: (ranges: RangeFilters) => void;
}) {
  const { t, locale } = useLocale();
  const [expanded, setExpanded] = useState(() => hasActiveRanges(initialRanges));
  const [ranges, setRanges] = useState<RangeFilters>(initialRanges);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Re-sync when the URL's range filters change from outside this component
  // (back/forward navigation, a pasted/shared link) — `initialRanges` is a
  // stable reference from the parent's useMemo, so this doesn't fight with
  // the user's own debounced edits (see updateRange).
  useEffect(() => {
    setRanges(initialRanges);
  }, [initialRanges]);

  // Numeric filters auto-apply (debounced) instead of needing an "Apply"
  // button — mirrors the ticker-search debounce pattern used elsewhere.
  const updateRange = (key: RangeFilterKey, which: 0 | 1, value: string) => {
    const next: RangeFilters = { ...ranges, [key]: which === 0 ? [value, ranges[key][1]] : [ranges[key][0], value] };
    setRanges(next);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => onRangesCommit(next), 400);
  };

  const clearRanges = () => {
    setRanges(EMPTY_RANGE_FILTERS);
    clearTimeout(debounceRef.current);
    onRangesCommit(EMPTY_RANGE_FILTERS);
  };

  useEffect(() => () => clearTimeout(debounceRef.current), []);

  const activeRangeCount = RANGE_FILTER_KEYS.filter((k) => ranges[k][0] !== "" || ranges[k][1] !== "").length;

  return (
    <div className="bg-card rounded-2xl border border-border/60 p-5 space-y-4">
      {templates.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-foreground mb-3">
            {locale === "en" ? "Quick Filters" : locale === "fr" ? "Filtres rapides" : "Hazır Filtreler"}
          </h2>
          <div className="flex flex-wrap gap-2">
            <button onClick={() => onTemplateChange("")} className={chipClass(!activeTemplate)}>
              {t("common.all")}
            </button>
            {templates.map((tmpl) => (
              <button key={tmpl} onClick={() => onTemplateChange(tmpl)} className={chipClass(activeTemplate === tmpl)}>
                {templateLabel(tmpl, locale)}
              </button>
            ))}
          </div>
        </div>
      )}

      <div>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          aria-controls="tarama-advanced-filters"
          className="flex items-center gap-1.5 text-xs font-semibold text-foreground hover:text-primary transition-colors"
        >
          <SlidersHorizontal className="h-3.5 w-3.5" />
          {locale === "en" ? "Advanced filters" : locale === "fr" ? "Filtres avancés" : "Gelişmiş Filtreler"}
          {activeRangeCount > 0 && (
            <span className="text-[10px] font-mono bg-primary/10 text-primary px-1.5 py-0.5 rounded-full">{activeRangeCount}</span>
          )}
          <ChevronDown className={`h-3.5 w-3.5 transition-transform ${expanded ? "rotate-180" : ""}`} />
        </button>

        {expanded && (
          <div id="tarama-advanced-filters" className="mt-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {RANGE_FILTER_KEYS.map((key) => (
              <div key={key}>
                <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1 block">
                  {RANGE_LABELS[key][locale]}
                </span>
                <div className="flex items-center gap-1.5">
                  <Input
                    type="number"
                    inputMode="decimal"
                    placeholder={t("common.min")}
                    aria-label={`${RANGE_LABELS[key][locale]} ${t("common.min")}`}
                    value={ranges[key][0]}
                    onChange={(e) => updateRange(key, 0, e.target.value)}
                    className="h-8 text-xs"
                  />
                  <span className="text-muted-foreground text-xs">–</span>
                  <Input
                    type="number"
                    inputMode="decimal"
                    placeholder={t("common.max")}
                    aria-label={`${RANGE_LABELS[key][locale]} ${t("common.max")}`}
                    value={ranges[key][1]}
                    onChange={(e) => updateRange(key, 1, e.target.value)}
                    className="h-8 text-xs"
                  />
                </div>
              </div>
            ))}
            {activeRangeCount > 0 && (
              <button
                type="button"
                onClick={clearRanges}
                className="flex items-center gap-1 self-start text-[11px] font-medium text-muted-foreground hover:text-destructive transition-colors mt-1"
              >
                <X className="h-3 w-3" /> {t("common.reset")}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
