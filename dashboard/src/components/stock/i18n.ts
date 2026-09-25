"use client";

import { useCallback } from "react";
import { useLocale } from "@/lib/locale-context";
import { stockText, type StockKey, type StockVars } from "./i18n-dict";

export { stockText, type StockKey, type StockVars };

/** `t(key, vars)` bound to the active UI locale (stock-page dictionary in i18n-dict.ts). */
export function useStockI18n() {
  const { locale } = useLocale();
  const t = useCallback((key: StockKey, vars?: StockVars) => stockText(key, locale, vars), [locale]);
  return { t, locale };
}
