/**
 * Similar companies (GET /fundamentals/{t}/peers) in the shape the stock card
 * uses, and the "why" text of each pick. Pure module — no React — so it runs
 * under `node --test` (peers.test.ts). The backend sends machine-readable
 * reasons with both companies' values (src/services/peer_service.py); the words
 * are built here, in the UI language.
 */
import type { Locale } from "@/lib/i18n";
import type { CompanyPeersOut, PeerComponentKey, PeerValueKey } from "@/types";
import { formatChangePercent, formatCompact, formatMultiple, formatNumber, formatPercent } from "../../lib/format.ts";
import { sectorLabel } from "../../lib/sectors.ts";
import { stockText, type StockKey } from "./i18n-dict.ts";

export type { PeerComponentKey, PeerValueKey };

export type PeerScope = "industry" | "sector" | "industry_wide";

export interface PeerIndustry {
  /** TradingView's English name ("Airlines"). */
  key: string;
  /** TradingView's Turkish label ("Havayolları"). */
  name: string;
}

export type PeerReason =
  | { type: "same_industry"; industry: PeerIndustry }
  | { type: "same_sector"; sector: string; fallback: boolean }
  | { type: "similar_size"; metric: "market_cap" | "revenue"; value: number; peerValue: number; ratio: number }
  | { type: "close_metric"; metric: PeerComponentKey; value: number; peerValue: number; difference: number };

export interface Peer {
  symbol: string;
  name: string | null;
  score: number;
  coverage: number;
  reasons: PeerReason[];
  values: Partial<Record<PeerValueKey, number>>;
  loss: boolean;
}

export interface CompanyPeers {
  scope: PeerScope | null;
  fallback: boolean;
  sector: { key: string; kapName: string; size: number };
  /** The stock's sub-sector; `size` counts its companies in the KAP sector, the stock included. */
  industry: (PeerIndustry & { size: number }) | null;
  company: { symbol: string; name: string | null; values: Partial<Record<PeerValueKey, number>>; loss: boolean };
  /** Score components and their weights (sum 100), heaviest first. */
  weights: Array<{ metric: PeerComponentKey; weight: number }>;
  /** Components the stock has no value for. */
  unavailable: PeerComponentKey[];
  peers: Peer[];
}

const COMPONENT_KEYS: ReadonlySet<string> = new Set<PeerComponentKey>([
  "industry", "market_cap", "revenue", "ebitda_margin", "debt_to_equity", "revenue_growth_yoy", "net_margin", "roe",
]);
const VALUE_KEYS: ReadonlySet<string> = new Set<PeerValueKey>([
  "market_cap", "revenue", "pe", "pb", "ebitda_margin", "net_margin", "roe", "debt_to_equity", "revenue_growth_yoy",
]);
const SCOPES: ReadonlySet<string> = new Set<PeerScope>(["industry", "sector", "industry_wide"]);

function isComponent(key: unknown): key is PeerComponentKey {
  return typeof key === "string" && COMPONENT_KEYS.has(key);
}

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function values(raw: unknown): Partial<Record<PeerValueKey, number>> {
  const out: Partial<Record<PeerValueKey, number>> = {};
  for (const [name, value] of Object.entries(record(raw) ?? {})) {
    const number = finite(value);
    if (VALUE_KEYS.has(name) && number !== null) out[name as PeerValueKey] = number;
  }
  return out;
}

function industry(raw: unknown): PeerIndustry | null {
  const block = record(raw);
  const key = text(block?.key);
  return key ? { key, name: text(block?.name) ?? key } : null;
}

/** A reason is kept only when it is complete: a metric reason needs both companies' values. */
function reason(raw: unknown): PeerReason | null {
  const block = record(raw);
  if (!block) return null;
  if (block.type === "same_industry") {
    const ind = industry(block.industry);
    return ind ? { type: "same_industry", industry: ind } : null;
  }
  if (block.type === "same_sector") {
    const sector = text(block.sector);
    return sector ? { type: "same_sector", sector, fallback: block.fallback === true } : null;
  }
  const value = finite(block.value);
  const peerValue = finite(block.peer_value);
  if (value === null || peerValue === null) return null;
  if (block.type === "similar_size" && (block.metric === "market_cap" || block.metric === "revenue")) {
    const ratio = finite(block.ratio);
    return ratio === null ? null : { type: "similar_size", metric: block.metric, value, peerValue, ratio };
  }
  if (block.type === "close_metric" && isComponent(block.metric) && block.metric !== "industry") {
    return { type: "close_metric", metric: block.metric, value, peerValue, difference: finite(block.difference) ?? peerValue - value };
  }
  return null;
}

/** null when the stock has no KAP sector (`available: false`) or the payload is unusable. */
export function parseCompanyPeers(data: CompanyPeersOut | unknown): CompanyPeers | null {
  const payload = record(data);
  if (!payload || payload.available !== true) return null;
  const sector = record(payload.sector);
  const sectorKey = text(sector?.key);
  const company = record(payload.company);
  const symbol = text(company?.symbol);
  if (!sectorKey || !symbol) return null;

  const ownIndustry = industry(payload.industry);
  const industrySize = finite(record(payload.industry)?.count);
  const weights = Object.entries(record(payload.weights) ?? {})
    .flatMap(([metric, weight]) => {
      const number = finite(weight);
      return isComponent(metric) && number !== null && number > 0 ? [{ metric, weight: number }] : [];
    })
    .sort((a, b) => b.weight - a.weight);

  const peers: Peer[] = [];
  for (const raw of Array.isArray(payload.peers) ? payload.peers : []) {
    const peer = record(raw);
    const peerSymbol = text(peer?.symbol);
    const score = finite(peer?.score);
    if (!peer || !peerSymbol || score === null) continue;
    peers.push({
      symbol: peerSymbol,
      name: text(peer.name),
      score,
      coverage: finite(peer.coverage) ?? 0,
      reasons: (Array.isArray(peer.reasons) ? peer.reasons : []).flatMap((r) => reason(r) ?? []),
      values: values(peer.values),
      loss: peer.loss === true,
    });
  }

  const scope = typeof payload.scope === "string" && SCOPES.has(payload.scope) ? (payload.scope as PeerScope) : null;
  return {
    scope,
    fallback: payload.fallback === true,
    sector: { key: sectorKey, kapName: text(sector?.name) ?? sectorKey, size: finite(sector?.count) ?? 0 },
    industry: ownIndustry ? { ...ownIndustry, size: industrySize ?? 0 } : null,
    company: { symbol, name: text(company?.name), values: values(company?.values), loss: company?.loss === true },
    weights,
    unavailable: (Array.isArray(payload.unavailable) ? payload.unavailable : []).filter(isComponent),
    peers,
  };
}

/** TradingView's Turkish label in Turkish; its English name otherwise (TradingView has no French one). */
export function industryName(industry: PeerIndustry, locale: Locale): string {
  return locale === "tr" ? industry.name : industry.key;
}

/** A metric value in the format the stock pages use for it. */
export function formatPeerValue(metric: PeerValueKey, value: number): string {
  switch (metric) {
    case "market_cap":
    case "revenue":
      return formatCompact(value);
    case "pe":
    case "pb":
      return formatNumber(value);
    case "debt_to_equity":
      return formatMultiple(value);
    case "revenue_growth_yoy":
      return formatChangePercent(value, 1);
    default:
      return formatPercent(value, 1);
  }
}

/** The lower-case name of a score component, as it reads inside a sentence. */
export function componentLabel(metric: PeerComponentKey, locale: Locale): string {
  return stockText(`similar.metric.${metric}` as StockKey, locale);
}

/** One reason in words (`kapNames`: KAP names of sectors by key): "aynı alt sektör (Havayolları)", "piyasa değeri benzer (1,2x)", "FAVÖK marjı yakın (%22,0 / %20,0)". */
export function reasonText(item: PeerReason, locale: Locale, kapNames: Readonly<Record<string, string>> = {}): string {
  switch (item.type) {
    case "same_industry":
      return stockText("similar.reason.sameIndustry", locale, { industry: industryName(item.industry, locale) });
    case "same_sector":
      return stockText("similar.reason.sameSector", locale, {
        // KAP's own name for a sector lib/sectors.ts does not list yet.
        sector: sectorLabel(item.sector, locale, Object.hasOwn(kapNames, item.sector) ? kapNames[item.sector] : null),
      });
    case "similar_size":
      return stockText(item.metric === "market_cap" ? "similar.reason.marketCap" : "similar.reason.revenue", locale, {
        ratio: formatMultiple(item.ratio, 1),
      });
    case "close_metric": {
      const metric = item.metric as PeerValueKey;
      return stockText("similar.reason.close", locale, {
        metric: componentLabel(item.metric, locale),
        peer: formatPeerValue(metric, item.peerValue),
        self: formatPeerValue(metric, item.value),
      });
    }
  }
}

/**
 * The reasons worth reading, in order: the shared sub-sector, or — only for a company
 * that shares just the KAP sector (a widened pool) — the sector, then the close figures.
 */
export function visibleReasons(peer: Peer): PeerReason[] {
  const sameIndustry = peer.reasons.some((item) => item.type === "same_industry");
  return peer.reasons.filter((item) => !(sameIndustry && item.type === "same_sector"));
}
