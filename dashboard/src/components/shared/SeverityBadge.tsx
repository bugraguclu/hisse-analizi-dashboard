"use client";

import { Badge } from "@/components/ui/badge";
import { useLocale } from "@/lib/locale-context";
import type { TranslationKey } from "@/lib/i18n";

export type SeverityKey = "HIGH" | "WATCH" | "INFO";

const severityClassNames: Record<SeverityKey, string> = {
  HIGH: "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20",
  WATCH: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20",
  INFO: "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20",
};

export const severityKeys: Record<SeverityKey, TranslationKey> = {
  HIGH: "severity.high",
  WATCH: "severity.medium",
  INFO: "severity.info",
};

export function toSeverity(value?: string | null): SeverityKey {
  const upper = (value ?? "").trim().toUpperCase();
  return upper === "HIGH" || upper === "WATCH" ? upper : "INFO";
}

export function SeverityBadge({ severity }: { severity?: string | null }) {
  const { t } = useLocale();
  const key = toSeverity(severity);
  return (
    <Badge variant="outline" className={`text-[11px] font-semibold ${severityClassNames[key]}`}>
      {t(severityKeys[key])}
    </Badge>
  );
}

export type CategoryKey = "DIVIDEND" | "CAPITAL_INCREASE" | "LEGAL" | "MANAGEMENT" | "FINANCIAL_RESULTS" | "NEW_BUSINESS" | "OTHER";

const categoryClassNames: Record<CategoryKey, string> = {
  DIVIDEND: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
  CAPITAL_INCREASE: "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20",
  LEGAL: "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20",
  MANAGEMENT: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20",
  FINANCIAL_RESULTS: "bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20",
  NEW_BUSINESS: "bg-teal-500/10 text-teal-600 dark:text-teal-400 border-teal-500/20",
  OTHER: "bg-muted text-muted-foreground border-border",
};

export const categoryKeys: Record<CategoryKey, TranslationKey> = {
  DIVIDEND: "category.dividend",
  CAPITAL_INCREASE: "category.capitalIncrease",
  LEGAL: "category.legal",
  MANAGEMENT: "category.management",
  FINANCIAL_RESULTS: "category.financial",
  NEW_BUSINESS: "category.newBusiness",
  OTHER: "category.other",
};

/**
 * The API serialises EventCategory by *value* (src/core/enums.py:
 * "temettü", "sermaye_artırımı", …) while the DB/enum names are English.
 * Accept both so badges never silently collapse to "Other".
 */
const categoryAliases: Record<string, CategoryKey> = {
  "temettü": "DIVIDEND",
  "sermaye_artırımı": "CAPITAL_INCREASE",
  "yeni_iş": "NEW_BUSINESS",
  "dava_ceza": "LEGAL",
  "yönetim_değişimi": "MANAGEMENT",
  "finansal_sonuç": "FINANCIAL_RESULTS",
  "diğer": "OTHER",
};

export function toCategoryKey(category?: string | null): CategoryKey | null {
  if (!category) return null;
  const trimmed = category.trim();
  const upper = trimmed.toUpperCase();
  if (upper in categoryKeys) return upper as CategoryKey;
  return categoryAliases[trimmed.toLocaleLowerCase("tr-TR")] ?? "OTHER";
}

export function CategoryBadge({ category }: { category?: string | null }) {
  const { t } = useLocale();
  const key = toCategoryKey(category);
  if (!key) return null;
  return (
    <Badge variant="outline" className={`text-[11px] font-semibold ${categoryClassNames[key]}`}>
      {t(categoryKeys[key])}
    </Badge>
  );
}
