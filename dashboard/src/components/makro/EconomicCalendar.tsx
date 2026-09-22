"use client";

import { useMemo, useState } from "react";
import { Calendar } from "lucide-react";
import { formatMarketDate } from "@/lib/format";
import { LoadingSpinner } from "@/components/shared/LoadingSpinner";
import { EmptyState, ErrorState } from "@/components/shared/ErrorState";
import { useLocale } from "@/lib/locale-context";
import type { Locale } from "@/lib/i18n";

export interface CalendarItem {
  Event?: unknown;
  Date?: unknown;
  Time?: unknown;
  Country?: unknown;
  Importance?: unknown;
  Actual?: unknown;
  Forecast?: unknown;
  Previous?: unknown;
}

const LABELS: Record<string, Record<Locale, string>> = {
  dateTime: { tr: "Tarih", en: "Date", fr: "Date" },
  importance: { tr: "Önem", en: "Importance", fr: "Importance" },
  event: { tr: "Olay", en: "Event", fr: "Événement" },
  actual: { tr: "Gerçekleşen", en: "Actual", fr: "Réalisé" },
  forecast: { tr: "Tahmin", en: "Forecast", fr: "Prévision" },
  previous: { tr: "Önceki", en: "Previous", fr: "Précédent" },
  importanceFilter: { tr: "Önem filtresi", en: "Importance filter", fr: "Filtre d'importance" },
  countryFilter: { tr: "Ülke filtresi", en: "Country filter", fr: "Filtre pays" },
  allImportance: { tr: "Tümü", en: "All", fr: "Tous" },
  midPlus: { tr: "Orta ve üzeri", en: "Medium and up", fr: "Moyenne et plus" },
  highOnly: { tr: "Yalnızca yüksek", en: "High only", fr: "Élevée uniquement" },
  allCountries: { tr: "Tüm ülkeler", en: "All countries", fr: "Tous les pays" },
  shown: { tr: "{shown} / {total} olay", en: "{shown} / {total} events", fr: "{shown} / {total} événements" },
  noMatch: { tr: "Bu filtrelerle eşleşen olay yok.", en: "No events match these filters.", fr: "Aucun événement ne correspond à ces filtres." },
};

type ImportanceFilter = "all" | "mid" | "high";
const IMPORTANCE_RANK: Record<string, number> = { low: 0, mid: 1, high: 2 };
const HOME_COUNTRY = "Türkiye";

function importanceOf(item: CalendarItem): string {
  return String(item.Importance ?? "low").toLowerCase();
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: string }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`rounded-lg px-2.5 py-1 text-[11px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-ring ${
        active ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

const IMPORTANCE_STYLES: Record<string, { dot: string }> = {
  high: { dot: "bg-destructive" },
  mid: { dot: "bg-amber-500" },
  low: { dot: "bg-muted-foreground/40" },
};

const IMPORTANCE_LABELS: Record<string, Record<Locale, string>> = {
  high: { tr: "Yüksek", en: "High", fr: "Élevée" },
  mid: { tr: "Orta", en: "Medium", fr: "Moyenne" },
  low: { tr: "Düşük", en: "Low", fr: "Faible" },
};

/** The upstream calendar bakes an empty "Period" marker into the title as a
 * literal " (-)" suffix (every row has Period="-"). Strip it for display —
 * it carries no information for the viewer. */
function cleanEventName(raw: string): string {
  return raw.replace(/\s*\(-\)\s*$/, "").trim();
}

export function EconomicCalendar({
  items,
  isLoading,
  isError,
  errorMessage,
  onRetry,
  noDataLabel,
}: {
  items: CalendarItem[];
  isLoading: boolean;
  isError?: boolean;
  errorMessage?: string;
  onRetry?: () => void;
  noDataLabel: string;
}) {
  const { t, locale } = useLocale();
  const L = (key: keyof typeof LABELS) => LABELS[key][locale];
  // Default hides low-importance rows: the upstream window is dominated by minor US data.
  const [importance, setImportance] = useState<ImportanceFilter>("mid");
  const [country, setCountry] = useState<string>("all");

  const countries = useMemo(() => {
    const set = new Set(items.map((item) => String(item.Country ?? "")).filter(Boolean));
    return [...set].sort((a, b) => (a === HOME_COUNTRY ? -1 : b === HOME_COUNTRY ? 1 : a.localeCompare(b, "tr")));
  }, [items]);

  const filtered = useMemo(() => {
    const minRank = importance === "high" ? 2 : importance === "mid" ? 1 : 0;
    return items.filter(
      (item) =>
        (IMPORTANCE_RANK[importanceOf(item)] ?? 0) >= minRank &&
        (country === "all" || String(item.Country ?? "") === country),
    );
  }, [items, importance, country]);

  return (
    <div className="bg-card rounded-2xl border border-border/60 p-5">
      <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex items-center gap-2">
          <Calendar className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-semibold text-foreground">{t("makro.calendar")}</h2>
        </div>
        {items.length > 0 && !isError && !isLoading ? (
          <>
            <div role="group" aria-label={L("importanceFilter")} className="flex flex-wrap items-center gap-1">
              <FilterChip active={importance === "all"} onClick={() => setImportance("all")}>{L("allImportance")}</FilterChip>
              <FilterChip active={importance === "mid"} onClick={() => setImportance("mid")}>{L("midPlus")}</FilterChip>
              <FilterChip active={importance === "high"} onClick={() => setImportance("high")}>{L("highOnly")}</FilterChip>
            </div>
            {countries.length > 1 ? (
              <div role="group" aria-label={L("countryFilter")} className="flex flex-wrap items-center gap-1">
                <FilterChip active={country === "all"} onClick={() => setCountry("all")}>{L("allCountries")}</FilterChip>
                {countries.map((name) => (
                  <FilterChip key={name} active={country === name} onClick={() => setCountry(name)}>
                    {name}
                  </FilterChip>
                ))}
              </div>
            ) : null}
            <span className="ml-auto text-[11px] text-muted-foreground" aria-live="polite">
              {L("shown").replace("{shown}", String(Math.min(filtered.length, 40))).replace("{total}", String(items.length))}
            </span>
          </>
        ) : null}
      </div>
      {isError ? (
        <ErrorState message={errorMessage || t("common.loadError")} onRetry={onRetry} />
      ) : isLoading ? (
        <LoadingSpinner text={t("common.loading")} />
      ) : items.length === 0 ? (
        <EmptyState message={noDataLabel} />
      ) : filtered.length === 0 ? (
        <EmptyState message={L("noMatch")} />
      ) : (
        <div className="overflow-x-auto max-h-96 overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-card">
              <tr className="border-b border-border/40">
                <th scope="col" className="py-2 pr-3 text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">{L("dateTime")}</th>
                <th scope="col" className="py-2 pr-3 text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">{L("importance")}</th>
                <th scope="col" className="py-2 pr-3 text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">{L("event")}</th>
                <th scope="col" className="py-2 pr-3 text-right text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">{L("actual")}</th>
                <th scope="col" className="py-2 pr-3 text-right text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">{L("forecast")}</th>
                <th scope="col" className="py-2 text-right text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">{L("previous")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/20">
              {filtered.slice(0, 40).map((item, i) => {
                const name = cleanEventName(String(item.Event ?? "-"));
                const dateRaw = item.Date != null ? String(item.Date) : "";
                const time = item.Time != null ? String(item.Time) : "";
                const country = item.Country != null ? String(item.Country) : "";
                const actual = item.Actual;
                const forecast = item.Forecast;
                const previous = item.Previous;
                const level = importanceOf(item);
                const style = IMPORTANCE_STYLES[level] ?? IMPORTANCE_STYLES.low;
                return (
                  <tr key={i} className="hover:bg-muted/10 transition-colors">
                    <td className="py-2 pr-3 whitespace-nowrap text-muted-foreground font-mono">
                      {dateRaw ? formatMarketDate(dateRaw, "dayMonth") : "-"}
                      {time && time !== "00:00" ? ` ${time}` : ""}
                    </td>
                    <td className="py-2 pr-3">
                      <span className="inline-flex items-center gap-1.5" title={IMPORTANCE_LABELS[level]?.[locale] ?? level}>
                        <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${style.dot}`} aria-hidden="true" />
                        <span className="text-[10px] text-muted-foreground hidden sm:inline">{IMPORTANCE_LABELS[level]?.[locale] ?? level}</span>
                      </span>
                    </td>
                    <td className="py-2 pr-3 text-foreground">
                      {name}
                      {country && <span className="text-muted-foreground"> · {country}</span>}
                    </td>
                    <td className="py-2 pr-3 text-right font-mono font-semibold text-foreground">{actual != null ? String(actual) : "-"}</td>
                    <td className="py-2 pr-3 text-right font-mono text-muted-foreground">{forecast != null ? String(forecast) : "-"}</td>
                    <td className="py-2 text-right font-mono text-muted-foreground">{previous != null ? String(previous) : "-"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
