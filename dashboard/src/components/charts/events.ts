"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { formatNumber, parseDate, toFiniteNumber } from "@/lib/format";
import type { Locale } from "@/lib/i18n";
import type { EventOut } from "@/types";
import { chartText } from "./i18n";
import type { ChartEvent, ChartEventKind } from "./types";

interface DividendRow {
  Date?: string | null;
  Amount?: number | null;
  NetRate?: number | null;
}

/** Up to 4 decimals, trailing zeros dropped: 3,442 TL / 0,1444 TL. */
function perShare(value: number): string {
  const text = formatNumber(value, 4);
  return text.includes(",") ? text.replace(/0+$/, "").replace(/,$/, "") : text;
}

function dividendEvents(payload: unknown, locale: Locale): ChartEvent[] {
  const rows = (payload as { dividends?: DividendRow[] } | null)?.dividends;
  if (!Array.isArray(rows)) return [];
  const out: ChartEvent[] = [];
  for (const row of rows) {
    const date = parseDate(row.Date ?? null);
    const gross = toFiniteNumber(row.Amount);
    if (!date) continue;
    const netRate = toFiniteNumber(row.NetRate);
    const detail =
      gross !== null && gross > 0
        ? netRate !== null && netRate > 0
          ? chartText("event.dividendDetail", locale, { gross: perShare(gross), net: perShare(netRate / 100) })
          : chartText("event.dividendGross", locale, { gross: perShare(gross) })
        : null;
    out.push({
      id: `div-${date.getTime()}-${out.length}`,
      kind: "dividend",
      time: date.getTime(),
      title: chartText("event.dividend", locale),
      detail,
      url: null,
    });
  }
  return out;
}

function kapKind(event: EventOut): ChartEventKind {
  switch (event.category_code) {
    case "FINANCIAL_RESULTS":
      return "earnings";
    case "CAPITAL_INCREASE":
      return "capital";
    case "DIVIDEND":
      return "dividend";
    default:
      return "disclosure";
  }
}

/**
 * Only disclosures that move a price chart: financial reports, capital
 * increases and the HIGH-severity rest. A report comes as three forms (report,
 * responsibility statement, activity report); only the report itself is kept.
 */
function kapEvents(events: readonly EventOut[]): ChartEvent[] {
  const out: ChartEvent[] = [];
  const seen = new Set<string>();
  for (const event of events) {
    if (seen.has(event.id)) continue;
    seen.add(event.id);
    const kind = kapKind(event);
    if (kind === "earnings" && event.severity !== "HIGH") continue;
    const date = parseDate(event.published_at ?? null);
    if (!date) continue;
    const title = (event.title ?? "").trim();
    const summary = (event.summary ?? event.excerpt ?? "").trim();
    out.push({
      id: `kap-${event.id}`,
      kind,
      time: date.getTime(),
      title: title || summary,
      detail: summary && summary !== title ? summary : null,
      url: event.event_url ?? null,
    });
  }
  return out;
}

async function loadChartEvents(symbol: string, locale: Locale, signal: AbortSignal): Promise<ChartEvent[]> {
  const [dividends, high, capital] = await Promise.allSettled([
    api.dividends(symbol),
    api.eventsPage({ ticker: symbol, severity: "HIGH", limit: 200 }, signal),
    api.eventsPage({ ticker: symbol, category: "CAPITAL_INCREASE", limit: 50 }, signal),
  ]);
  const kap: EventOut[] = [
    ...(high.status === "fulfilled" ? high.value.items : []),
    ...(capital.status === "fulfilled" ? capital.value.items : []),
  ];
  const events = [...(dividends.status === "fulfilled" ? dividendEvents(dividends.value, locale) : []), ...kapEvents(kap)];
  if (events.length === 0 && dividends.status === "rejected" && high.status === "rejected") throw dividends.reason;
  return events.sort((a, b) => a.time - b.time);
}

/**
 * Dividends (İş Yatırım history), financial reports, capital increases and
 * key KAP disclosures of a stock, for the event badges on its price chart.
 * KAP history only reaches back to when this site started polling.
 */
export function useChartEvents(symbol: string, locale: Locale, enabled: boolean) {
  return useQuery({
    queryKey: ["chartEvents", symbol, locale],
    queryFn: ({ signal }) => loadChartEvents(symbol, locale, signal),
    staleTime: 10 * 60_000,
    enabled: enabled && symbol.length > 0,
  });
}
