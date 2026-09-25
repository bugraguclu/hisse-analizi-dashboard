"use client";

import { useCallback } from "react";
import { useLocale } from "@/lib/locale-context";
import { eventsPlural, eventsText, type EventsKey, type EventsPluralKey, type EventsVars } from "./i18n-dict";

export { eventsText, type EventsKey, type EventsVars };

/**
 * `t(key, vars)` / `tp(base, count, vars)` bound to the active UI locale
 * (dictionary in i18n-dict.ts). `tp` picks the `.one`/`.other` form and
 * passes `count` as a variable.
 */
export function useEventsI18n() {
  const { locale, t: tShared } = useLocale();
  const t = useCallback((key: EventsKey, vars?: EventsVars) => eventsText(key, locale, vars), [locale]);
  const tp = useCallback(
    (base: EventsPluralKey, count: number, vars?: EventsVars) => eventsPlural(base, count, locale, { count, ...vars }),
    [locale],
  );
  return { t, tp, tShared, locale };
}
