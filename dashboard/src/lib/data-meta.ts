/**
 * Pure parser for the backend's additive `meta` provenance/freshness block
 * (see `src/core/meta.py`). Shared between UI components and cross-platform
 * error-scenario unit tests.
 */

export type ServedFrom = "live" | "store" | "stale";

export interface DataMetaInfo {
  source: string | null;
  sourceUrl: string | null;
  asOf: string | null;
  fetchedAt: string | null;
  ageSeconds: number | null;
  servedFrom: ServedFrom | null;
  stale: boolean;
  notes: string[];
}

const SERVED_FROM: readonly ServedFrom[] = ["live", "store", "stale"];

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function finiteNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/** Reads `payload.meta`; null when the payload carries no usable meta block. */
export function readDataMeta(payload: unknown): DataMetaInfo | null {
  if (!payload || typeof payload !== "object") return null;
  const raw = (payload as { meta?: unknown }).meta;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const m = raw as Record<string, unknown>;
  const servedFrom = SERVED_FROM.includes(m.served_from as ServedFrom) ? (m.served_from as ServedFrom) : null;
  const info: DataMetaInfo = {
    source: text(m.source),
    sourceUrl: text(m.source_url),
    asOf: text(m.as_of),
    fetchedAt: text(m.fetched_at),
    ageSeconds: finiteNumber(m.age_seconds),
    servedFrom,
    stale: m.stale === true || servedFrom === "stale",
    notes: Array.isArray(m.notes) ? m.notes.map(text).filter((note): note is string => note !== null) : [],
  };
  return info.source || info.fetchedAt || info.servedFrom || info.asOf ? info : null;
}

/** Display names for the source codes the backend uses; unknown values pass through. */
const SOURCE_NAMES: Record<string, string> = {
  tradingview: "TradingView",
  isyatirim: "İş Yatırım",
  kap: "KAP",
  tcmb: "TCMB",
  evds: "TCMB EVDS",
  tuik: "TÜİK",
  bist: "Borsa İstanbul",
  borsaistanbul: "Borsa İstanbul",
  yahoo: "Yahoo Finance",
  yfinance: "Yahoo Finance",
  hedeffiyat: "hedeffiyat.com.tr",
};

/** "kap+isyatirim" → "KAP + İş Yatırım". */
export function sourceName(source: string | null): string | null {
  if (!source) return null;
  return source
    .split("+")
    .map((part) => SOURCE_NAMES[part.trim().toLowerCase()] ?? part.trim())
    .filter(Boolean)
    .join(" + ");
}
