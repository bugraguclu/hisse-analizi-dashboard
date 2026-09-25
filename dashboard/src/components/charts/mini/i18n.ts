"use client";

import { useCallback } from "react";
import { useLocale } from "@/lib/locale-context";
import type { Locale } from "@/lib/i18n";
import type { RatioKey } from "@/components/stock/types";

/**
 * Small dictionary for strings owned by the mini charts themselves (never
 * domain text — that always comes in as props/labels from the caller, e.g.
 * IndicatorPanel's zone names or AnalystRecommendations' "Ortalama"). Keys
 * that already exist in the stock dictionary (src/components/stock/i18n.ts)
 * are reused by the integrating card instead of being duplicated here.
 */
const dict = {
  shareOfTotal: { tr: "{value} pay", en: "{value} share", fr: "{value} part" },
  aboveRange: { tr: "Aralığın üzerinde", en: "Above range", fr: "Au-dessus de la plage" },
  belowRange: { tr: "Aralığın altında", en: "Below range", fr: "En dessous de la plage" },
  otherSegment: { tr: "Diğer", en: "Other", fr: "Autres" },

  // Ratio formula hints (RatiosCard row tooltips).
  "formula.gross_margin": { tr: "Brüt kâr / Net satışlar", en: "Gross profit / Net sales", fr: "Bénéfice brut / Chiffre d'affaires net" },
  "formula.operating_margin": {
    tr: "Esas faaliyet kârı / Net satışlar",
    en: "Operating profit / Net sales",
    fr: "Résultat opérationnel / Chiffre d'affaires net",
  },
  "formula.ebitda_margin": { tr: "FAVÖK / Net satışlar", en: "EBITDA / Net sales", fr: "EBITDA / Chiffre d'affaires net" },
  "formula.net_margin": { tr: "Net kâr / Net satışlar", en: "Net income / Net sales", fr: "Résultat net / Chiffre d'affaires net" },
  "formula.roe": {
    tr: "Ana ortaklık net kârı / Ortalama ana ortaklık özkaynakları",
    en: "Net income to parent / Average parent equity",
    fr: "Résultat net part du groupe / Capitaux propres moyens part du groupe",
  },
  "formula.roa": { tr: "Net kâr / Ortalama toplam varlıklar", en: "Net income / Average total assets", fr: "Résultat net / Total actif moyen" },
  "formula.current_ratio": {
    tr: "Dönen varlıklar / Kısa vadeli yükümlülükler",
    en: "Current assets / Current liabilities",
    fr: "Actif circulant / Passif circulant",
  },
  "formula.debt_to_equity": {
    tr: "Toplam yükümlülükler / Özkaynaklar",
    en: "Total liabilities / Equity",
    fr: "Total des passifs / Capitaux propres",
  },
  "formula.net_debt_ebitda": {
    tr: "(Finansal borçlar − Nakit) / FAVÖK",
    en: "(Financial debt − Cash) / EBITDA",
    fr: "(Dette financière − Trésorerie) / EBITDA",
  },
  "formula.pe_ratio": { tr: "Fiyat / Hisse başı kâr", en: "Price / Earnings per share", fr: "Cours / Bénéfice par action" },
  "formula.pb_ratio": { tr: "Piyasa değeri / Defter değeri", en: "Market cap / Book value", fr: "Capitalisation / Valeur comptable" },
  "formula.ps_ratio": { tr: "Piyasa değeri / Net satışlar", en: "Market cap / Net sales", fr: "Capitalisation / Chiffre d'affaires net" },
  "formula.ev_ebitda": { tr: "Firma değeri / FAVÖK", en: "Enterprise value / EBITDA", fr: "Valeur d'entreprise / EBITDA" },
  "formula.revenue_growth_yoy": {
    tr: "Yıllık satış değişimi",
    en: "Year-over-year revenue change",
    fr: "Variation annuelle du chiffre d'affaires",
  },
  "formula.net_income_growth_yoy": {
    tr: "Yıllık net kâr değişimi",
    en: "Year-over-year net income change",
    fr: "Variation annuelle du résultat net",
  },
} as const;

export type MiniKey = keyof typeof dict;
export type MiniVars = Record<string, string | number>;

export function miniText(key: MiniKey, locale: Locale, vars?: MiniVars): string {
  const entry = dict[key];
  const text: string = entry[locale] ?? entry.tr;
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (match, name: string) => (name in vars ? String(vars[name]) : match));
}

/** `t(key, vars)` bound to the active UI locale for the mini-chart dictionary above. */
export function useMiniChartI18n() {
  const { locale } = useLocale();
  const t = useCallback((key: MiniKey, vars?: MiniVars) => miniText(key, locale, vars), [locale]);
  return { t };
}

/** RatioKey → this dictionary's formula-hint key, for RatiosCard's row tooltips. */
export const RATIO_FORMULA_KEY: Record<RatioKey, MiniKey> = {
  gross_margin: "formula.gross_margin",
  operating_margin: "formula.operating_margin",
  ebitda_margin: "formula.ebitda_margin",
  net_margin: "formula.net_margin",
  roe: "formula.roe",
  roa: "formula.roa",
  current_ratio: "formula.current_ratio",
  net_debt_ebitda: "formula.net_debt_ebitda",
  debt_to_equity: "formula.debt_to_equity",
  pe_ratio: "formula.pe_ratio",
  pb_ratio: "formula.pb_ratio",
  ps_ratio: "formula.ps_ratio",
  ev_ebitda: "formula.ev_ebitda",
  revenue_growth_yoy: "formula.revenue_growth_yoy",
  net_income_growth_yoy: "formula.net_income_growth_yoy",
};
