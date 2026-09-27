"use client";

import { useId, useMemo, useRef, useState } from "react";
import { Popover } from "@base-ui/react/popover";
import { useQuery } from "@tanstack/react-query";
import { Check, GitCompareArrows, Loader2, Search, X } from "lucide-react";
import { foldTr } from "@/components/shared/search/fold";
import { buildTickerIndex, searchTickers } from "@/components/shared/search/ticker-index";
import { useListNav } from "@/components/shared/search/use-list-nav";
import { api } from "@/lib/api";
import { STALE_TIME } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import { SERIES_CSS_VAR } from "./colors";
import { ChipButton, POPUP_CLASS } from "./controls";
import { useChartI18n } from "./i18n";

export type CompareKind = "ticker" | "index";

export interface CompareItem {
  symbol: string;
  kind: CompareKind;
  label: string;
  /** Categorical palette slot of its line. */
  color: number;
}

export interface CompareChoice {
  symbol: string;
  kind: CompareKind;
  label: string;
  name?: string;
}

/** Indices the backend serves with chart history (see /market/index/{symbol}). */
export const COMPARE_INDICES: readonly CompareChoice[] = [
  { symbol: "XU100", kind: "index", label: "XU100", name: "BIST 100" },
  { symbol: "XU030", kind: "index", label: "XU030", name: "BIST 30" },
  { symbol: "XU050", kind: "index", label: "XU050", name: "BIST 50" },
  { symbol: "XBANK", kind: "index", label: "XBANK", name: "BIST Banka" },
  { symbol: "XUSIN", kind: "index", label: "XUSIN", name: "BIST Sınai" },
  { symbol: "XUHIZ", kind: "index", label: "XUHIZ", name: "BIST Hizmetler" },
  { symbol: "XHOLD", kind: "index", label: "XHOLD", name: "BIST Holding ve Yatırım" },
  { symbol: "XUTEK", kind: "index", label: "XUTEK", name: "BIST Teknoloji" },
];

export const MAX_COMPARE = 4;

/**
 * "Karşılaştır": overlay up to four indices or stocks as % return
 * (TradingView's "compare symbol"). Indices are listed up front; typing
 * searches the whole BIST equity list locally, belif-search style.
 */
export function ComparePicker({
  items,
  onAdd,
  onRemove,
  onClear,
  exclude,
  compact = false,
}: {
  items: readonly CompareItem[];
  onAdd: (choice: CompareChoice) => void;
  onRemove: (symbol: string) => void;
  onClear: () => void;
  /** The chart's own symbol. */
  exclude: string;
  compact?: boolean;
}) {
  const { t } = useChartI18n();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const baseId = useId();
  const listId = `${baseId}-list`;

  // Same query key as the site search: usually cached already.
  const indexQ = useQuery({
    queryKey: ["market-companies-all"],
    queryFn: ({ signal }) => api.allCompanies(signal),
    select: buildTickerIndex,
    staleTime: STALE_TIME.reference,
    enabled: open,
  });

  const needle = foldTr(query);
  const options = useMemo<CompareChoice[]>(() => {
    const indices = COMPARE_INDICES.filter(
      (choice) => choice.symbol !== exclude && (!needle || foldTr(`${choice.symbol} ${choice.name ?? ""}`).includes(needle)),
    );
    const stocks = needle && indexQ.data ? searchTickers(indexQ.data, query, 8) : [];
    return [
      ...indices,
      ...stocks
        .filter((option) => option.ticker !== exclude)
        .map((option) => ({ symbol: option.ticker, kind: "ticker" as const, label: option.ticker, name: option.name })),
    ];
  }, [needle, query, indexQ.data, exclude]);

  const nav = useListNav({ count: open ? options.length : 0, listKey: options.map((option) => option.symbol).join(","), idPrefix: baseId, tabWalks: false });
  const active = new Map(items.map((item) => [item.symbol, item]));
  const full = items.length >= MAX_COMPARE;

  const toggle = (choice: CompareChoice) => {
    if (active.has(choice.symbol)) onRemove(choice.symbol);
    else if (!full) onAdd(choice);
  };

  const indexCount = options.filter((option) => option.kind === "index").length;

  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery("");
      }}
    >
      <Popover.Trigger
        render={
          <ChipButton pressed={items.length > 0} aria-label={compact ? t("compare.button") : undefined} title={t("compare.title")}>
            <GitCompareArrows />
            {compact ? null : t("compare.button")}
            {items.length > 0 ? (
              <span className="flex items-center gap-0.5" aria-hidden>
                {items.map((item) => (
                  <span key={item.symbol} className="h-2 w-2 rounded-[2px]" style={{ background: SERIES_CSS_VAR[item.color % 5] }} />
                ))}
              </span>
            ) : null}
          </ChipButton>
        }
      />
      <Popover.Portal>
        <Popover.Positioner side="bottom" align="start" sideOffset={6} collisionPadding={12} className="z-[90]">
          <Popover.Popup initialFocus={inputRef} className={cn(POPUP_CLASS, "flex max-h-[min(30rem,calc(100dvh-6rem))] w-[min(21rem,calc(100vw-1.5rem))] flex-col")}>
            <div className="flex items-center gap-2 border-b border-border px-3">
              <Search aria-hidden className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <input
                ref={inputRef}
                type="search"
                role="combobox"
                aria-expanded
                aria-controls={listId}
                aria-activedescendant={nav.active >= 0 ? nav.optionId(nav.active) : undefined}
                aria-label={t("compare.search")}
                placeholder={t("compare.search")}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (nav.onKeyDown(event)) return;
                  if (event.key === "Enter") {
                    event.preventDefault();
                    const choice = options[nav.active >= 0 ? nav.active : 0];
                    if (choice) toggle(choice);
                  }
                }}
                className="h-10 min-w-0 flex-1 bg-transparent text-[13px] text-foreground outline-none placeholder:text-muted-foreground [&::-webkit-search-cancel-button]:hidden"
              />
              {indexQ.isFetching && needle ? <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin text-muted-foreground" /> : null}
            </div>

            {items.length > 0 ? (
              <div className="border-b border-border px-3 py-2">
                <div className="flex items-center justify-between">
                  <h3 className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{t("compare.active")}</h3>
                  <button
                    type="button"
                    onClick={onClear}
                    className="rounded-sm px-1 text-[11px] font-medium text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60"
                  >
                    {t("compare.clear")}
                  </button>
                </div>
                <ul className="mt-1 flex flex-wrap gap-1">
                  {items.map((item) => (
                    <li key={item.symbol}>
                      <span className="inline-flex h-6 items-center gap-1.5 rounded-md border border-border pl-2 pr-0.5 font-mono text-[11px] text-foreground">
                        <span aria-hidden className="h-0 w-3 border-t-2" style={{ borderColor: SERIES_CSS_VAR[item.color % 5] }} />
                        {item.label}
                        <button
                          type="button"
                          onClick={() => onRemove(item.symbol)}
                          aria-label={t("compare.remove", { symbol: item.label })}
                          className="inline-flex h-5 w-5 items-center justify-center rounded-sm text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            <div id={listId} role="listbox" aria-label={t("compare.button")} className="min-h-0 flex-1 overflow-y-auto overscroll-contain py-1 scrollbar-thin">
              {options.map((choice, index) => {
                const selected = active.get(choice.symbol);
                const disabled = !selected && full;
                const header =
                  index === 0 && indexCount > 0 ? t("compare.indices") : index === indexCount && choice.kind === "ticker" ? t("compare.stocks") : null;
                return (
                  <div key={`${choice.kind}:${choice.symbol}`}>
                    {header ? <p className="px-3 pb-0.5 pt-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{header}</p> : null}
                    <div
                      id={nav.optionId(index)}
                      role="option"
                      aria-selected={nav.active === index}
                      aria-checked={Boolean(selected)}
                      aria-disabled={disabled || undefined}
                      onPointerMove={() => nav.setActive(index)}
                      onClick={() => toggle(choice)}
                      className={cn(
                        "mx-1.5 flex cursor-pointer items-center gap-3 rounded-md px-2 py-1.5",
                        nav.active === index && "bg-muted",
                        disabled && "cursor-not-allowed opacity-50",
                      )}
                    >
                      <span className="w-14 shrink-0 font-mono text-[12px] font-medium text-foreground">{choice.label}</span>
                      <span className="min-w-0 flex-1 truncate text-[12px] text-muted-foreground">{choice.name}</span>
                      {selected ? (
                        <Check aria-hidden className="h-3.5 w-3.5 shrink-0" style={{ color: SERIES_CSS_VAR[selected.color % 5] }} />
                      ) : null}
                    </div>
                  </div>
                );
              })}
              {needle && options.length === 0 && !indexQ.isFetching ? (
                <p className="px-3 py-5 text-center text-xs text-muted-foreground">{t("compare.noResults")}</p>
              ) : null}
            </div>
            {full ? <p className="border-t border-border px-3 py-2 text-[11px] text-muted-foreground">{t("compare.limit", { n: MAX_COMPARE })}</p> : null}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
