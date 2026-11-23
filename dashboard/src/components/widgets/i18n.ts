"use client";

import { useCallback } from "react";
import { useLocale } from "@/lib/locale-context";
import { widgetText, type WidgetKey, type WidgetVars } from "./i18n-dict";

export { widgetText, type WidgetKey, type WidgetVars };

/** `t(key, vars)` bound to the active UI locale (widget dictionary in i18n-dict.ts). */
export function useWidgetI18n() {
  const { locale } = useLocale();
  const t = useCallback((key: WidgetKey, vars?: WidgetVars) => widgetText(key, locale, vars), [locale]);
  return { t, locale };
}
