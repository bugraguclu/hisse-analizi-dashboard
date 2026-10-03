"use client";

import { useId, useMemo, useRef, useState } from "react";
import { Popover } from "@base-ui/react/popover";
import { Check, SquareFunction, Plus, Search, X } from "lucide-react";
import { foldTr } from "@/components/shared/search/fold";
import { useListNav } from "@/components/shared/search/use-list-nav";
import { cn } from "@/lib/utils";
import { SERIES_CSS_VAR } from "./colors";
import { ChipButton, POPUP_CLASS } from "./controls";
import { useChartI18n, type ChartKey } from "./i18n";
import { defaultParams, INDICATOR_ORDER, INDICATORS, indicatorLabel } from "./indicator-catalog";
import type { IndicatorDef } from "./indicator-types";
import { localize } from "./indicator-view";
import { MAX_INDICATORS, newIndicatorId, presetIndicator } from "./prefs";
import type { IndicatorConfig, IndicatorKind } from "./types";

const GROUPS: ReadonlyArray<{ group: IndicatorDef["group"]; label: ChartKey }> = [
  { group: "trend", label: "ind.group.trend" },
  { group: "momentum", label: "ind.group.momentum" },
  { group: "volatility", label: "ind.group.volatility" },
  { group: "volume", label: "ind.group.volume" },
];

/** One-click indicator sets (TradingView's "indicator templates"); picking one replaces the chart's indicators. */
const TEMPLATES: ReadonlyArray<{ key: ChartKey; hint: string; build: () => IndicatorConfig[]; needsVolume?: boolean }> = [
  {
    key: "templates.trend",
    hint: "SMA 20 · 50 · 200",
    build: () => [presetIndicator("sma", { length: 20 }, 0), presetIndicator("sma", { length: 50 }, 1), presetIndicator("sma", { length: 200 }, 2)],
  },
  {
    key: "templates.momentum",
    hint: "RSI · MACD",
    build: () => [presetIndicator("rsi", { length: 14 }, 0), presetIndicator("macd", { fast: 12, slow: 26, signal: 9 }, 0)],
  },
  {
    key: "templates.volatility",
    hint: "Bollinger · ATR",
    build: () => [presetIndicator("bb", { length: 20, mult: 2 }, 3), presetIndicator("atr", { length: 14 }, 0)],
  },
  {
    key: "templates.volume",
    hint: "OBV · MFI",
    build: () => [presetIndicator("obv", {}, 0), presetIndicator("mfi", { length: 14 }, 1)],
    needsVolume: true,
  },
];

/** Lengths a second, third… instance of the same average starts with (TradingView users' usual set). */
const LADDERS: Partial<Record<IndicatorKind, readonly number[]>> = {
  sma: [20, 50, 100, 200],
  ema: [9, 21, 50, 200],
};

/** A new instance of `kind` that doesn't duplicate what the chart already has. */
export function nextIndicator(kind: IndicatorKind, existing: readonly IndicatorConfig[]): IndicatorConfig {
  const params = defaultParams(kind);
  const same = existing.filter((config) => config.kind === kind);
  const ladder = LADDERS[kind];
  if (ladder && "length" in params) {
    const used = new Set(same.map((config) => config.params.length));
    params.length = ladder.find((value) => !used.has(value)) ?? params.length;
  }
  // Overlays share the price pane: pick a colour no other overlay uses. Panes stand alone.
  const def = INDICATORS[kind];
  const taken = new Set(
    existing.filter((config) => (def.placement === "overlay" ? INDICATORS[config.kind].placement === "overlay" : config.kind === kind)).map((config) => config.color),
  );
  const color = [0, 1, 2, 3, 4].find((slot) => !taken.has(slot)) ?? existing.length % 5;
  return { id: newIndicatorId(kind), kind, params, color };
}

function unavailableReason(def: IndicatorDef, context: { intraday: boolean; hasVolume: boolean }): ChartKey | null {
  if (def.requires?.intraday && !context.intraday) return "ind.needsIntraday";
  if (def.requires?.volume && !context.hasVolume) return "ind.needsVolume";
  return null;
}

/**
 * "Göstergeler": a searchable catalogue (TradingView's indicator dialog in a
 * popover) — type to filter, arrows + Enter to add, several instances per
 * kind, the chart's current indicators on top with a quick remove.
 */
export function IndicatorMenu({
  indicators,
  onChange,
  intraday,
  hasVolume,
  volume,
  onVolumeChange,
  open,
  onOpenChange,
  compact = false,
}: {
  indicators: readonly IndicatorConfig[];
  onChange: (next: IndicatorConfig[]) => void;
  intraday: boolean;
  hasVolume: boolean;
  volume: boolean;
  onVolumeChange: (on: boolean) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Icon-only trigger (phones). */
  compact?: boolean;
}) {
  const { t, locale } = useChartI18n();
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const baseId = useId();
  const listId = `${baseId}-list`;
  const needle = foldTr(query);

  const matches = useMemo(() => {
    const tokens = needle.split(" ").filter(Boolean);
    return INDICATOR_ORDER.filter((kind) => {
      if (tokens.length === 0) return true;
      const def = INDICATORS[kind];
      const haystack = foldTr([def.abbr, def.name.tr, def.name.en, def.name.fr, ...(def.keywords ?? [])].join(" "));
      return tokens.every((token) => haystack.includes(token));
    });
  }, [needle]);

  const nav = useListNav({ count: open ? matches.length : 0, listKey: `${needle}|${matches.join(",")}`, idPrefix: baseId, tabWalks: false });
  const full = indicators.length >= MAX_INDICATORS;
  const context = { intraday, hasVolume };

  const add = (kind: IndicatorKind) => {
    const def = INDICATORS[kind];
    if (full || unavailableReason(def, context)) return;
    onChange([...indicators, nextIndicator(kind, indicators)]);
  };

  const countOf = (kind: IndicatorKind) => indicators.filter((config) => config.kind === kind).length;

  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) setQuery("");
      }}
    >
      <Popover.Trigger
        render={
          <ChipButton aria-label={compact ? t("ind.button") : undefined} title={t("ind.button")}>
            <SquareFunction />
            {compact ? null : t("ind.button")}
            {indicators.length > 0 ? (
              <span className="rounded-sm bg-muted px-1 font-mono text-[10px] leading-4 text-foreground tabular-nums">{indicators.length}</span>
            ) : null}
          </ChipButton>
        }
      />
      <Popover.Portal>
        <Popover.Positioner side="bottom" align="start" sideOffset={6} collisionPadding={12} className="z-[90]">
          <Popover.Popup initialFocus={inputRef} className={cn(POPUP_CLASS, "flex max-h-[min(34rem,calc(100dvh-6rem))] w-[min(24rem,calc(100vw-1.5rem))] flex-col")}>
            <div className="flex items-center gap-2 border-b border-border px-3">
              <Search aria-hidden className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <input
                ref={inputRef}
                type="search"
                role="combobox"
                aria-expanded
                aria-controls={listId}
                aria-activedescendant={nav.active >= 0 ? nav.optionId(nav.active) : undefined}
                aria-label={t("ind.search")}
                placeholder={t("ind.search")}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (nav.onKeyDown(event)) return;
                  if (event.key === "Enter") {
                    event.preventDefault();
                    const kind = matches[nav.active >= 0 ? nav.active : 0];
                    if (kind) add(kind);
                  }
                }}
                className="h-10 min-w-0 flex-1 bg-transparent text-[13px] text-foreground outline-none placeholder:text-muted-foreground [&::-webkit-search-cancel-button]:hidden"
              />
              {query ? (
                <button
                  type="button"
                  onClick={() => {
                    setQuery("");
                    inputRef.current?.focus();
                  }}
                  aria-label={t("event.close")}
                  className="inline-flex h-6 w-6 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              ) : null}
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain scrollbar-thin">
              {!needle ? (
                <section className="border-b border-border px-1.5 py-2">
                  <h3 className="px-1.5 pb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{t("templates.title")}</h3>
                  <div className="grid grid-cols-2 gap-1 px-1">
                    {TEMPLATES.map((template) => {
                      const disabled = template.needsVolume === true && !hasVolume;
                      return (
                        <button
                          key={template.key}
                          type="button"
                          disabled={disabled}
                          onClick={() => onChange(template.build())}
                          className="flex flex-col items-start rounded-md border border-border px-2 py-1.5 text-left outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/60 disabled:opacity-50"
                        >
                          <span className="text-[12px] font-medium text-foreground">{t(template.key)}</span>
                          <span className="font-mono text-[10px] text-muted-foreground">{template.hint}</span>
                        </button>
                      );
                    })}
                  </div>
                </section>
              ) : null}
              {!needle && indicators.length > 0 ? (
                <section className="border-b border-border px-1.5 py-2">
                  <h3 className="px-1.5 pb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{t("ind.onChart")}</h3>
                  <ul className="flex flex-wrap gap-1 px-1">
                    {indicators.map((config) => (
                      <li key={config.id}>
                        <span className="inline-flex h-6 items-center gap-1.5 rounded-md border border-border pl-2 pr-0.5 text-[11px]">
                          <span aria-hidden className="h-2 w-2 rounded-[2px]" style={{ background: SERIES_CSS_VAR[config.color % 5] }} />
                          <span className={cn("font-mono tabular-nums", config.hidden ? "text-muted-foreground line-through" : "text-foreground")}>
                            {indicatorLabel(config)}
                          </span>
                          <button
                            type="button"
                            onClick={() => onChange(indicators.filter((item) => item.id !== config.id))}
                            aria-label={t("ind.removeNamed", { name: indicatorLabel(config) })}
                            className="inline-flex h-5 w-5 items-center justify-center rounded-sm text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}

              <div id={listId} role="listbox" aria-label={t("ind.button")} className="py-1">
                {matches.length === 0 ? <p className="px-3 py-6 text-center text-xs text-muted-foreground">{t("ind.noResults")}</p> : null}
                {GROUPS.map(({ group, label }) => {
                  const kinds = matches.filter((kind) => INDICATORS[kind].group === group);
                  if (kinds.length === 0) return null;
                  return (
                    <div key={group} role="group" aria-label={t(label)}>
                      <p className="px-3 pb-0.5 pt-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{t(label)}</p>
                      {kinds.map((kind) => {
                        const index = matches.indexOf(kind);
                        const def = INDICATORS[kind];
                        const reason = unavailableReason(def, context);
                        const count = countOf(kind);
                        const disabled = reason !== null || full;
                        return (
                          <div
                            key={kind}
                            id={nav.optionId(index)}
                            role="option"
                            aria-selected={nav.active === index}
                            aria-disabled={disabled || undefined}
                            onPointerMove={() => nav.setActive(index)}
                            onClick={() => add(kind)}
                            className={cn(
                              "mx-1.5 flex cursor-pointer items-start gap-3 rounded-md px-2 py-1.5",
                              nav.active === index && "bg-muted",
                              disabled && "cursor-not-allowed opacity-55",
                            )}
                          >
                            <span className="min-w-0 flex-1">
                              <span className="flex items-baseline gap-2">
                                <span className="truncate text-[13px] font-medium text-foreground">{localize(def.name, locale)}</span>
                                <span className="font-mono text-[10px] text-muted-foreground">{def.abbr}</span>
                              </span>
                              <span className="block text-[11px] leading-4 text-muted-foreground">
                                {reason ? t(reason) : localize(def.description, locale)}
                              </span>
                            </span>
                            <span className="mt-0.5 flex shrink-0 items-center gap-1.5 text-[10px] text-muted-foreground">
                              <span>{def.placement === "pane" ? t("ind.pane") : t("ind.overlay")}</span>
                              {count > 0 ? (
                                <span className="inline-flex items-center gap-0.5 font-medium text-foreground" title={t("ind.added", { n: count })}>
                                  <Check className="h-3 w-3" />
                                  {count}
                                </span>
                              ) : (
                                <Plus aria-hidden className="h-3.5 w-3.5" />
                              )}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="flex items-center gap-2 border-t border-border px-3 py-2 text-[11px]">
              <label className={cn("inline-flex cursor-pointer items-center gap-2", !hasVolume && "cursor-not-allowed opacity-50")}>
                <input
                  type="checkbox"
                  checked={volume && hasVolume}
                  disabled={!hasVolume}
                  onChange={(event) => onVolumeChange(event.target.checked)}
                  className="h-3.5 w-3.5 accent-foreground"
                />
                <span className="text-foreground">{t("ind.volume")}</span>
              </label>
              {full ? <span className="text-muted-foreground">{t("ind.limit", { n: MAX_INDICATORS })}</span> : null}
              {indicators.length > 0 ? (
                <button
                  type="button"
                  onClick={() => onChange([])}
                  className="ml-auto rounded-sm px-1.5 py-0.5 font-medium text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60"
                >
                  {t("ind.removeAll")}
                </button>
              ) : null}
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
