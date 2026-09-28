/**
 * The stock's KAP sector (GET /fundamentals/{t}/sector) in the shape the stock
 * cards use. Pure module — no React and only type imports — so the parser runs
 * under `node --test` (sector.test.ts).
 */
import type { CompanySectorOut, SectorMetricKey } from "@/types";

export type { SectorMetricKey };

export interface SectorStat {
  /** Sector median; null below `minCompanies` counted companies. */
  median: number | null;
  /** Companies counted toward the median (dividend yield: payers only). */
  count: number;
  /** Companies with a value. */
  reported: number;
  /** The stock's own value. */
  value: number | null;
  /** 1 = the highest value in the sector; null when the stock's value does not count. */
  rank: number | null;
}

export interface SectorPeer {
  symbol: string;
  name: string | null;
  /** Loss-making over the last 12 months (TradingView publishes no P/E). */
  loss: boolean;
  values: Partial<Record<SectorMetricKey, number>>;
}

export interface CompanySector {
  key: string;
  /** KAP's own name, in capitals (labels come from lib/sectors.ts). */
  kapName: string;
  /** Listed companies in the sector. */
  size: number;
  minCompanies: number;
  metrics: Partial<Record<SectorMetricKey, SectorStat>>;
  /** Largest market cap first, the stock included. */
  peers: SectorPeer[];
}

const METRIC_KEYS: ReadonlySet<string> = new Set<SectorMetricKey>([
  "market_cap", "pe", "pb", "dividend_yield", "change_pct",
  "perf_1w", "perf_1m", "perf_3m", "perf_ytd", "perf_1y", "foreign_ratio",
  "gross_margin", "operating_margin", "ebitda_margin", "net_margin", "roe", "roa",
  "current_ratio", "debt_to_equity", "net_debt_ebitda", "revenue_growth_yoy", "net_income_growth_yoy",
  "ps_ratio", "ev_ebitda",
]);

function isMetricKey(key: string): key is SectorMetricKey {
  return METRIC_KEYS.has(key);
}

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function count(value: unknown): number {
  const number = finite(value);
  return number !== null && number >= 0 ? Math.floor(number) : 0;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** null when the stock has no KAP sector (`available: false`) or the payload is unusable. */
export function parseCompanySector(data: CompanySectorOut | unknown): CompanySector | null {
  if (!data || typeof data !== "object") return null;
  const payload = data as Partial<CompanySectorOut>;
  const block = payload.sector;
  const key = text(block?.key);
  if (payload.available !== true || !block || !key) return null;

  const metrics: CompanySector["metrics"] = {};
  for (const [name, raw] of Object.entries(payload.metrics ?? {})) {
    if (!isMetricKey(name) || !raw || typeof raw !== "object") continue;
    const above = finite(raw.above);
    metrics[name] = {
      median: finite(raw.median),
      count: count(raw.count),
      reported: count(raw.reported),
      value: finite(raw.value),
      rank: above !== null && above >= 0 ? above + 1 : null,
    };
  }

  const peers: SectorPeer[] = [];
  for (const raw of Array.isArray(payload.peers) ? payload.peers : []) {
    const symbol = text(raw?.symbol);
    if (!symbol) continue;
    const values: SectorPeer["values"] = {};
    for (const [name, value] of Object.entries(raw)) {
      const number = finite(value);
      if (isMetricKey(name) && number !== null) values[name] = number;
    }
    peers.push({ symbol, name: text(raw.name), loss: raw.loss === true, values });
  }

  return {
    key,
    kapName: text(block.name) ?? key,
    size: count(block.count) || peers.length,
    minCompanies: count(payload.min_companies) || 3,
    metrics,
    peers,
  };
}
