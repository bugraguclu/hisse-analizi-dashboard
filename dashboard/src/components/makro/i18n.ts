"use client";

import { useCallback } from "react";
import { useLocale } from "@/lib/locale-context";
import { makroText, type MakroKey, type MakroVars } from "./i18n-dict";

export { makroText, type MakroKey, type MakroVars };

/** `t(key, vars)` bound to the active UI locale (macro-page dictionary in i18n-dict.ts). */
export function useMakroI18n() {
  const { locale } = useLocale();
  const t = useCallback((key: MakroKey, vars?: MakroVars) => makroText(key, locale, vars), [locale]);
  return { t, locale };
}
