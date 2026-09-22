import type { TranslationKey } from "@/lib/i18n";

/**
 * Backend quirk (src/core/enums.py `EventCategory`): every enum member's
 * `.value` is a Turkish slug distinct from its `.name` (e.g.
 * `OTHER = "diğer"`), unlike every other enum in that file. The DB column
 * stores the member `.name` (confirmed via psql: OTHER, FINANCIAL_RESULTS,
 * DIVIDEND, MANAGEMENT, CAPITAL_INCREASE, NEW_BUSINESS, LEGAL), but FastAPI/
 * Pydantic serializes `str, Enum` members by `.value`, so `/events` and
 * `/events/{id}` actually return the Turkish slug in `category`. The shared
 * `CategoryBadge` (components/shared/SeverityBadge.tsx) keys its labels and
 * colors on the English name, so it silently mislabels every category
 * except "diğer" as "Other". Map the slug back to the enum name here so the
 * badge (and our own filter UI) render correctly regardless of which form
 * the backend sends — verified 1:1 against a live row per category.
 */
const CATEGORY_SLUG_TO_ENUM: Record<string, string> = {
  "temettü": "DIVIDEND",
  "sermaye_artırımı": "CAPITAL_INCREASE",
  "yeni_iş": "NEW_BUSINESS",
  "dava_ceza": "LEGAL",
  "yönetim_değişimi": "MANAGEMENT",
  "finansal_sonuç": "FINANCIAL_RESULTS",
  "diğer": "OTHER",
};

/** Normalize a backend `category` value to the enum name CategoryBadge expects. */
export function normalizeCategory(raw?: string | null): string | null {
  if (!raw) return null;
  const lower = raw.toLowerCase();
  return CATEGORY_SLUG_TO_ENUM[lower] ?? raw.toUpperCase();
}

export const CATEGORY_FILTER_OPTIONS = [
  "DIVIDEND",
  "CAPITAL_INCREASE",
  "NEW_BUSINESS",
  "LEGAL",
  "MANAGEMENT",
  "FINANCIAL_RESULTS",
  "OTHER",
] as const;

export const CATEGORY_LABEL_KEYS: Record<string, TranslationKey> = {
  DIVIDEND: "category.dividend",
  CAPITAL_INCREASE: "category.capitalIncrease",
  LEGAL: "category.legal",
  MANAGEMENT: "category.management",
  FINANCIAL_RESULTS: "category.financial",
  NEW_BUSINESS: "category.newBusiness",
  OTHER: "category.other",
};

export const SEVERITY_FILTER_OPTIONS = ["HIGH", "WATCH", "INFO"] as const;

export const SEVERITY_LABEL_KEYS: Record<string, TranslationKey> = {
  HIGH: "severity.high",
  WATCH: "severity.medium",
  INFO: "severity.info",
};
