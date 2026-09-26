"use client";

import { useLocale } from "@/lib/locale-context";
import type { TranslationKey } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/**
 * KAP event taxonomy shared by the home page, the stock pages and /events.
 *
 * Visual language (site-wide): severity is a word only — "Yüksek" in the
 * destructive tone, "Orta" in the warn tone, routine ("Bilgi") items stay
 * unmarked — optionally paired with a 2px rule on the row's left edge
 * (SEVERITY_RULE_CLASS). Categories are plain muted text, never coloured badges.
 */

export type SeverityKey = "HIGH" | "WATCH" | "INFO";

/** Most to least important — the order used by filters and sorting. */
export const SEVERITY_LEVELS: readonly SeverityKey[] = ["HIGH", "WATCH", "INFO"];

export const severityKeys: Record<SeverityKey, TranslationKey> = {
  HIGH: "severity.high",
  WATCH: "severity.medium",
  INFO: "severity.info",
};

/** Text tone of the severity word ("" = default foreground). */
export const SEVERITY_TEXT_CLASS: Record<SeverityKey, string> = {
  HIGH: "text-destructive",
  WATCH: "text-warn",
  INFO: "text-muted-foreground",
};

/** Background of the 2px row-edge rule; INFO rows get none. */
export const SEVERITY_RULE_CLASS: Record<SeverityKey, string | null> = {
  HIGH: "bg-destructive",
  WATCH: "bg-warn",
  INFO: null,
};

export function toSeverity(value?: string | null): SeverityKey {
  const upper = (value ?? "").trim().toUpperCase();
  return upper === "HIGH" || upper === "WATCH" ? upper : "INFO";
}

/**
 * Severity as a word. INFO renders nothing unless `showInfo` is set — routine
 * disclosures are the default and would only add noise.
 */
export function SeverityBadge({
  severity,
  showInfo = false,
  className,
}: {
  severity?: string | null;
  showInfo?: boolean;
  className?: string;
}) {
  const { t } = useLocale();
  const key = toSeverity(severity);
  if (key === "INFO" && !showInfo) return null;
  return (
    <span className={cn("whitespace-nowrap text-[11px] font-medium", SEVERITY_TEXT_CLASS[key], className)}>
      {t(severityKeys[key])}
    </span>
  );
}

export type CategoryKey =
  | "DIVIDEND"
  | "CAPITAL_INCREASE"
  | "SHARE_BUYBACK"
  | "NEW_BUSINESS"
  | "MERGER_ACQUISITION"
  | "FINANCIAL_RESULTS"
  | "MANAGEMENT"
  | "GENERAL_ASSEMBLY"
  | "INSIDER_TRADING"
  | "LEGAL"
  | "CREDIT_RATING"
  | "DEBT_INSTRUMENT"
  | "MARKET_NOTICE"
  | "OTHER";

/** Every category code (backend EventCategory enum names) in display order. */
export const CATEGORY_CODES: readonly CategoryKey[] = [
  "DIVIDEND",
  "CAPITAL_INCREASE",
  "SHARE_BUYBACK",
  "NEW_BUSINESS",
  "MERGER_ACQUISITION",
  "FINANCIAL_RESULTS",
  "MANAGEMENT",
  "GENERAL_ASSEMBLY",
  "INSIDER_TRADING",
  "LEGAL",
  "CREDIT_RATING",
  "DEBT_INSTRUMENT",
  "MARKET_NOTICE",
  "OTHER",
];

export const categoryKeys: Record<CategoryKey, TranslationKey> = {
  DIVIDEND: "category.dividend",
  CAPITAL_INCREASE: "category.capitalIncrease",
  SHARE_BUYBACK: "category.shareBuyback",
  NEW_BUSINESS: "category.newBusiness",
  MERGER_ACQUISITION: "category.mergerAcquisition",
  FINANCIAL_RESULTS: "category.financialResults",
  MANAGEMENT: "category.management",
  GENERAL_ASSEMBLY: "category.generalAssembly",
  INSIDER_TRADING: "category.insiderTrading",
  LEGAL: "category.legal",
  CREDIT_RATING: "category.creditRating",
  DEBT_INSTRUMENT: "category.debtInstrument",
  MARKET_NOTICE: "category.marketNotice",
  OTHER: "category.other",
};

/**
 * Older API versions serialise EventCategory by *value* — Turkish slugs such as
 * "temettü" — in the legacy `category` field, while `category_code` carries the
 * enum name. Accept both so labels never silently collapse to "Other".
 */
const categoryAliases: Record<string, CategoryKey> = {
  "temettü": "DIVIDEND",
  "sermaye_artırımı": "CAPITAL_INCREASE",
  "pay_geri_alımı": "SHARE_BUYBACK",
  "yeni_iş": "NEW_BUSINESS",
  "birleşme_devralma": "MERGER_ACQUISITION",
  "finansal_sonuç": "FINANCIAL_RESULTS",
  "yönetim_değişimi": "MANAGEMENT",
  "genel_kurul": "GENERAL_ASSEMBLY",
  "pay_alım_satım": "INSIDER_TRADING",
  "dava_ceza": "LEGAL",
  "kredi_notu": "CREDIT_RATING",
  "borçlanma_aracı": "DEBT_INSTRUMENT",
  "piyasa_duyurusu": "MARKET_NOTICE",
  "diğer": "OTHER",
};

export function isCategoryKey(value: unknown): value is CategoryKey {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(categoryKeys, value);
}

/** Enum name or legacy slug → CategoryKey; null when empty, OTHER when unrecognised. */
export function toCategoryKey(category?: string | null): CategoryKey | null {
  if (!category) return null;
  const trimmed = category.trim().normalize("NFC");
  if (!trimmed) return null;
  const upper = trimmed.toUpperCase();
  if (isCategoryKey(upper)) return upper;
  return categoryAliases[trimmed.toLocaleLowerCase("tr-TR")] ?? "OTHER";
}
