"use client";

import { X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { TickerFilterInput } from "./TickerFilterInput";
import { useLocale } from "@/lib/locale-context";
import type { SourceOut } from "@/types";
import {
  CATEGORY_FILTER_OPTIONS,
  CATEGORY_LABEL_KEYS,
  SEVERITY_FILTER_OPTIONS,
  SEVERITY_LABEL_KEYS,
} from "./eventTaxonomy";

const selectClass =
  "text-xs border border-border/60 rounded-lg px-2.5 py-1.5 bg-background text-foreground focus:ring-2 focus:ring-primary/20 focus:border-primary/40 transition-all outline-none";
const fieldLabelClass = "text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1 block";

export interface EventFilterValues {
  sourceCode: string;
  ticker: string;
  search: string;
  category: string;
  severity: string;
  since: string;
  until: string;
}

export function EventFilters({
  sources,
  values,
  onSourceChange,
  onTickerSelect,
  onSearchChange,
  onTickerClear,
  onCategoryChange,
  onSeverityChange,
  onSinceChange,
  onUntilChange,
}: {
  sources: SourceOut[];
  values: EventFilterValues;
  onSourceChange: (code: string) => void;
  onTickerSelect: (ticker: string) => void;
  onSearchChange: (text: string) => void;
  onTickerClear: () => void;
  onCategoryChange: (v: string) => void;
  onSeverityChange: (v: string) => void;
  onSinceChange: (v: string) => void;
  onUntilChange: (v: string) => void;
}) {
  const { t } = useLocale();

  return (
    <div className="flex flex-wrap gap-3 items-end">
      <div>
        <span className={fieldLabelClass}>{t("events.source")}</span>
        <div className="bg-muted/50 rounded-lg p-0.5 flex gap-0.5" role="tablist" aria-label={t("events.source")}>
          <button
            role="tab"
            aria-selected={values.sourceCode === ""}
            onClick={() => onSourceChange("")}
            className={`px-3.5 py-1.5 rounded-md text-xs font-semibold transition-all ${
              values.sourceCode === "" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {t("common.all")}
          </button>
          {sources.map((s) => (
            <button
              key={s.code}
              role="tab"
              aria-selected={values.sourceCode === s.code}
              onClick={() => onSourceChange(s.code)}
              title={s.name}
              className={`px-3.5 py-1.5 rounded-md text-xs font-semibold transition-all ${
                values.sourceCode === s.code ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {s.code === "kap" ? "KAP" : s.name}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className={fieldLabelClass} htmlFor="events-category-filter">{t("events.category")}</label>
        <select
          id="events-category-filter"
          value={values.category}
          onChange={(e) => onCategoryChange(e.target.value)}
          className={selectClass}
        >
          <option value="">{t("common.all")}</option>
          {CATEGORY_FILTER_OPTIONS.map((c) => (
            <option key={c} value={c}>{t(CATEGORY_LABEL_KEYS[c])}</option>
          ))}
        </select>
      </div>

      <div>
        <label className={fieldLabelClass} htmlFor="events-severity-filter">{t("events.severity")}</label>
        <select
          id="events-severity-filter"
          value={values.severity}
          onChange={(e) => onSeverityChange(e.target.value)}
          className={selectClass}
        >
          <option value="">{t("common.all")}</option>
          {SEVERITY_FILTER_OPTIONS.map((s) => (
            <option key={s} value={s}>{t(SEVERITY_LABEL_KEYS[s])}</option>
          ))}
        </select>
      </div>

      <div className="flex items-end gap-1.5">
        <div>
          <label className={fieldLabelClass} htmlFor="events-since">{t("events.dateFrom")}</label>
          <Input
            id="events-since"
            type="date"
            value={values.since}
            onChange={(e) => onSinceChange(e.target.value)}
            className="h-8 text-xs w-[140px]"
          />
        </div>
        <div>
          <label className={fieldLabelClass} htmlFor="events-until">{t("events.dateTo")}</label>
          <Input
            id="events-until"
            type="date"
            value={values.until}
            min={values.since || undefined}
            onChange={(e) => onUntilChange(e.target.value)}
            className="h-8 text-xs w-[140px]"
          />
        </div>
        {(values.since || values.until) && (
          <button
            type="button"
            onClick={() => { onSinceChange(""); onUntilChange(""); }}
            aria-label={t("common.reset")}
            title={t("common.reset")}
            className="p-1.5 rounded-lg hover:bg-muted/50 transition-colors mb-0.5"
          >
            <X className="h-3.5 w-3.5 text-muted-foreground" />
          </button>
        )}
      </div>

      <div>
        <span className={fieldLabelClass}>{t("events.searchTicker")}</span>
        <TickerFilterInput
          ticker={values.ticker}
          search={values.search}
          onTickerSelect={onTickerSelect}
          onSearchChange={onSearchChange}
          onClear={onTickerClear}
        />
      </div>
    </div>
  );
}
