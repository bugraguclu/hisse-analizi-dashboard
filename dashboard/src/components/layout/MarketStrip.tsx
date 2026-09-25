"use client";

import { Fragment, type Ref } from "react";
import Link from "next/link";
import { Pause, Play } from "lucide-react";
import { formatChangePercent, formatMarketDate, formatNumber, TREND_TEXT_CLASS, trendTone } from "@/lib/format";
import { useLocale } from "@/lib/locale-context";
import type { MarketPhase } from "@/lib/market-hours";
import type { TranslationKey } from "@/lib/i18n";
import { useMarketStatus } from "@/hooks/use-market-status";
import { findQuote, quoteTimeMs, useIndexQuotes } from "@/components/dashboard/queries";
import { formatBp, formatMarketValue } from "@/components/makro/format";
import { useMarkets } from "@/components/makro/queries";
import type { MarketQuote } from "@/components/makro/types";
import { cn } from "@/lib/utils";
import { useMarquee, useMarqueePause } from "./use-marquee";

/** Headline BIST indices, in tape order, with their short names. */
const STRIP_INDICES = [
  { symbol: "XU100", label: "BIST 100" },
  { symbol: "XU030", label: "BIST 30" },
  { symbol: "XBANK", label: "BIST Banka" },
  { symbol: "XUSIN", label: "BIST Sınai" },
] as const;

interface TapeInstrument {
  key: string;
  label?: string;
  labelKey?: TranslationKey;
}

/** Live FX and commodities from the macro page's TradingView feed (same query, no extra requests). */
const STRIP_MARKETS: readonly TapeInstrument[] = [
  { key: "usdtry", label: "USD/TRY" },
  { key: "eurtry", label: "EUR/TRY" },
  { key: "gram_gold", labelKey: "shell.tapeGramGold" },
  { key: "xauusd", labelKey: "shell.tapeOunceGold" },
  { key: "brent", labelKey: "shell.tapeBrent" },
];

/** Benchmark Turkish government bond yields from the same feed. */
const STRIP_BONDS: readonly TapeInstrument[] = [
  { key: "tr02y", labelKey: "shell.tapeTr2y" },
  { key: "tr10y", labelKey: "shell.tapeTr10y" },
];

const PAUSE_STORAGE_KEY = "hisse.marketStrip.paused";

const PHASE_HINT: Partial<Record<MarketPhase, TranslationKey>> = {
  preOpen: "market.preOpen",
  afterClose: "market.afterClose",
  weekend: "market.weekend",
  noTrading: "market.noTrading",
};

interface TapeEntry {
  id: string;
  label: string;
  pending?: boolean;
  value?: string;
  /** Drives the colour of `changeText`; omitted for yields, whose move is shown neutral. */
  change?: number | null;
  changeText?: string;
  neutral?: boolean;
  href?: string;
  title?: string;
}

interface TapeGroup {
  id: string;
  label: string;
  entries: TapeEntry[];
}

function TapeItem({ entry, clone }: { entry: TapeEntry; clone: boolean }) {
  const content = entry.pending ? (
    <>
      <span className="text-muted-foreground">{entry.label}</span>
      <span aria-hidden="true" className="inline-block h-3 w-24 translate-y-0.5 rounded-sm bg-muted skeleton-shimmer" />
    </>
  ) : (
    <>
      <span className="text-muted-foreground transition-colors group-hover:text-foreground">{entry.label}</span>
      <span className="font-mono font-medium tabular-nums text-foreground">{entry.value}</span>
      <span
        className={cn(
          "font-mono tabular-nums",
          entry.neutral ? "text-muted-foreground" : TREND_TEXT_CLASS[trendTone(entry.change)],
        )}
      >
        {entry.changeText}
      </span>
    </>
  );

  return (
    <li className="flex shrink-0">
      {entry.href && !entry.pending ? (
        <Link
          href={entry.href}
          // A moving tape would otherwise prefetch the link every time it scrolls into view.
          prefetch={false}
          draggable={false}
          tabIndex={clone ? -1 : undefined}
          title={entry.title}
          className="group flex items-baseline gap-2 whitespace-nowrap rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          {content}
        </Link>
      ) : (
        <span className="flex items-baseline gap-2 whitespace-nowrap" title={entry.title}>
          {content}
        </span>
      )}
    </li>
  );
}

/** One full pass of the tape. Clones are hidden from assistive tech and the tab order. */
function TapeCopy({ groups, clone, ref }: { groups: TapeGroup[]; clone: boolean; ref?: Ref<HTMLDivElement> }) {
  return (
    <div
      ref={ref}
      aria-hidden={clone || undefined}
      // Trailing divider + padding: the seam between copies looks like any other group boundary.
      className={cn("flex shrink-0 items-center gap-5", groups.length > 0 && "pr-5")}
    >
      {groups.map((group) => (
        <Fragment key={group.id}>
          <ul aria-label={group.label} className="flex shrink-0 items-center gap-5">
            {group.entries.map((entry) => (
              <TapeItem key={entry.id} entry={entry} clone={clone} />
            ))}
          </ul>
          <span aria-hidden="true" className="h-3.5 w-px shrink-0 bg-border" />
        </Fragment>
      ))}
    </div>
  );
}

/**
 * Market tape under the header: BIST indices, live FX / gold / oil and the
 * benchmark bond yields, scrolling endlessly (drag, swipe, wheel, Tab and a
 * pause button), with the session status fixed on the right.
 */
export function MarketStrip() {
  const { t, locale } = useLocale();
  const quotesQ = useIndexQuotes();
  const marketsQ = useMarkets();
  const [paused, togglePaused] = useMarqueePause(PAUSE_STORAGE_KEY);
  const { viewportRef, trackRef, copyRef, copies } = useMarquee(paused);

  const quotes = quotesQ.data?.quotes;
  const headline = findQuote(quotes, "XU100");
  const quoteAt = quoteTimeMs(headline);
  const status = useMarketStatus(quoteAt);
  const hintKey = status ? PHASE_HINT[status.phase] : undefined;

  const groups: TapeGroup[] = [];

  const indexEntries = STRIP_INDICES.flatMap<TapeEntry>(({ symbol, label }) => {
    if (quotesQ.isPending) return [{ id: symbol, label, pending: true }];
    const quote = findQuote(quotes, symbol);
    if (!quote) return [];
    return [
      {
        id: symbol,
        label,
        // An index level is never 0 — treat it as missing upstream data.
        value: formatNumber(quote.last !== null && quote.last > 0 ? quote.last : null),
        change: quote.change_percent,
        changeText: formatChangePercent(quote.change_percent),
      },
    ];
  });
  if (indexEntries.length > 0) groups.push({ id: "indices", label: t("shell.indices"), entries: indexEntries });

  const instruments = marketsQ.data?.instruments;
  const marketEntries = (list: readonly TapeInstrument[], yields: boolean) =>
    list.flatMap<TapeEntry>((instrument) => {
      const label = instrument.labelKey ? t(instrument.labelKey) : (instrument.label ?? instrument.key);
      if (marketsQ.isPending) return [{ id: instrument.key, label, pending: true }];
      const quote: MarketQuote | undefined = instruments?.find((item) => item.key === instrument.key);
      if (!quote || typeof quote.last !== "number" || !Number.isFinite(quote.last)) return [];
      const updatedAt = quote.updated_at ?? marketsQ.data?.as_of;
      const source = t(yields ? "shell.tapeYieldSource" : "shell.tapePriceSource");
      return [
        {
          id: instrument.key,
          label,
          value: formatMarketValue(quote.last, quote.key, quote.unit),
          // Yields move in basis points and carry no good/bad colour (as on /makro).
          change: yields ? quote.change : quote.change_percent,
          changeText: yields ? formatBp(quote.change, locale) : formatChangePercent(quote.change_percent),
          neutral: yields,
          href: "/makro",
          title: updatedAt
            ? `${source}, ${t("shell.tapeUpdated", { time: formatMarketDate(updatedAt, "time") })}`
            : source,
        },
      ];
    });
  const fxEntries = marketEntries(STRIP_MARKETS, false);
  if (fxEntries.length > 0) groups.push({ id: "markets", label: t("shell.tapeMarkets"), entries: fxEntries });
  const bondEntries = marketEntries(STRIP_BONDS, true);
  if (bondEntries.length > 0) groups.push({ id: "bonds", label: t("shell.tapeBonds"), entries: bondEntries });

  return (
    <div className="border-b border-border bg-card/40 px-4 md:px-6">
      <div className="mx-auto flex h-9 max-w-7xl items-center gap-3 text-xs">
        <div
          ref={viewportRef}
          className={cn(
            "min-w-0 flex-1 self-stretch overflow-hidden overscroll-x-contain",
            "cursor-grab select-none touch-pan-y touch-pinch-zoom [-webkit-touch-callout:none]",
            "data-dragging:cursor-grabbing [&[data-dragging]_*]:cursor-grabbing",
            "[mask-image:linear-gradient(to_right,transparent,#000_2rem,#000_calc(100%-2rem),transparent)]",
          )}
        >
          <div ref={trackRef} className="flex h-full w-max items-center will-change-transform">
            <TapeCopy groups={groups} clone />
            <TapeCopy ref={copyRef} groups={groups} clone={false} />
            {Array.from({ length: copies - 1 }, (_, i) => (
              <TapeCopy key={i} groups={groups} clone />
            ))}
          </div>
        </div>

        <button
          type="button"
          onClick={togglePaused}
          aria-pressed={paused}
          aria-label={t("shell.tapePause")}
          title={paused ? t("shell.tapePlay") : t("shell.tapePause")}
          className="relative inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors after:absolute after:-inset-1.5 after:content-[''] hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
        >
          {paused ? (
            <Play className="h-3.5 w-3.5" aria-hidden="true" />
          ) : (
            <Pause className="h-3.5 w-3.5" aria-hidden="true" />
          )}
        </button>

        {status && (
          <p className="hidden shrink-0 items-center gap-2 text-muted-foreground sm:flex" title={t("dashboard.sessionHours")}>
            <span aria-hidden="true" className={cn("h-1.5 w-1.5 rounded-full", status.isOpen ? "bg-up" : "bg-muted-foreground/60")} />
            {status.isOpen ? (
              <span className="text-foreground">{t("dashboard.marketOpen")}</span>
            ) : (
              <span>{hintKey ? t(hintKey) : t("dashboard.marketClosed")}</span>
            )}
          </p>
        )}
      </div>
    </div>
  );
}
