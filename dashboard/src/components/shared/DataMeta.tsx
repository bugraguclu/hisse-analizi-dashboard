"use client";

import { formatMarketDate, formatRelativeTime, parseDate, toFiniteNumber } from "@/lib/format";
import { useLocale } from "@/lib/locale-context";
import type { Locale } from "@/lib/i18n";
import { useNow } from "@/hooks/use-now";
import { useApiMeta } from "@/lib/api-meta";
import { cn } from "@/lib/utils";

/**
 * Provenance / freshness line for API payloads that carry the backend's additive
 * `meta` block (src/core/meta.py on the data-platform branch):
 *
 *   {"meta": {"source": "tcmb", "as_of": "2026-09-22", "fetched_at": "...",
 *             "age_seconds": 41, "served_from": "live|store|stale", "stale": false,
 *             "delay_seconds": 900, "notes": [...]}}
 *
 * Tolerant by design: when a payload has no (or a malformed) `meta` block the
 * component renders nothing, so it can be mounted before the backend sends it.
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
  delaySeconds: number | null;
  notes: string[];
}

const SERVED_FROM: readonly ServedFrom[] = ["live", "store", "stale"];

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
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
    ageSeconds: toFiniteNumber(m.age_seconds),
    servedFrom,
    stale: m.stale === true || servedFrom === "stale",
    delaySeconds: toFiniteNumber(m.delay_seconds),
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

const DICT = {
  stale: {
    tr: "Sağlayıcıya ulaşılamadı; son kayıtlı veri",
    en: "Provider unreachable; last saved data",
    fr: "Fournisseur injoignable ; dernières données enregistrées",
  },
  delayed: { tr: "{minutes} dk gecikmeli", en: "Delayed {minutes} min", fr: "Différé de {minutes} min" },
  asOf: { tr: "{date} itibarıyla", en: "As of {date}", fr: "Au {date}" },
  updated: { tr: "güncelleme {when}", en: "updated {when}", fr: "mis à jour {when}" },
  source: { tr: "Kaynak: {source}", en: "Source: {source}", fr: "Source : {source}" },
  servedFrom: {
    tr: { live: "sağlayıcıdan canlı", store: "kayıtlı kopyadan", stale: "eski kayıtlı kopyadan" },
    en: { live: "live from provider", store: "from saved copy", stale: "from outdated saved copy" },
    fr: { live: "en direct du fournisseur", store: "depuis la copie enregistrée", stale: "depuis une copie ancienne" },
  },
} as const;

function fill(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => vars[key] ?? "");
}

/** "2026-09-22" → "22 Eyl 2026"; period labels such as "2026/06" stay as sent. */
function asOfLabel(asOf: string): string {
  return /^\d{4}-\d{2}-\d{2}/.test(asOf) && parseDate(asOf) ? formatMarketDate(asOf, "date") : asOf;
}

function fetchedLabel(info: DataMetaInfo, now: number | null): string | null {
  const fetched = parseDate(info.fetchedAt);
  if (fetched && now !== null) return formatRelativeTime(fetched, now);
  if (fetched) return formatMarketDate(fetched, "dayMonthTime");
  return null;
}

function describe(info: DataMetaInfo, locale: Locale, now: number | null) {
  const parts: string[] = [];
  const when = info.asOf ? asOfLabel(info.asOf) : fetchedLabel(info, now);
  if (info.stale) parts.push(when ? `${DICT.stale[locale]} (${when})` : DICT.stale[locale]);
  if (info.delaySeconds !== null && info.delaySeconds >= 60) {
    parts.push(fill(DICT.delayed[locale], { minutes: String(Math.round(info.delaySeconds / 60)) }));
  }
  return parts;
}

/**
 * Low-prominence provenance line (11px muted text; warn colour only when stale).
 * - default: shows only what the reader must know — stale fallback and provider delay
 * - `showSource` / `showAsOf`: also name the source / the date the data describes
 * The full detail (source, fetch time, served-from, backend notes) is in the tooltip.
 */
export function DataMeta({
  payload,
  showSource = false,
  showAsOf = false,
  showDelay = true,
  className,
}: {
  /** Raw API response (the component reads its `meta` block). */
  payload: unknown;
  showSource?: boolean;
  showAsOf?: boolean;
  /** Off where the card already says prices are delayed. */
  showDelay?: boolean;
  className?: string;
}) {
  const { locale } = useLocale();
  const now = useNow();
  const info = readDataMeta(payload);
  if (!info) return null;

  const parts = describe(showDelay ? info : { ...info, delaySeconds: null }, locale, now);
  const name = sourceName(info.source);
  if (showAsOf && info.asOf && !info.stale) parts.push(fill(DICT.asOf[locale], { date: asOfLabel(info.asOf) }));
  if (showSource && name) parts.push(fill(DICT.source[locale], { source: name }));
  if (parts.length === 0) return null;

  const fetched = fetchedLabel(info, now);
  // Backend notes repeat the stale sentence the line already shows.
  const notes = info.notes.filter((note) => !Object.values(DICT.stale).some((stale) => note.startsWith(stale)));
  const tooltip = [
    name ? fill(DICT.source[locale], { source: name }) : null,
    info.servedFrom ? DICT.servedFrom[locale][info.servedFrom] : null,
    fetched ? fill(DICT.updated[locale], { when: fetched }) : null,
    ...notes,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <p
      className={cn("text-[11px] leading-4 text-muted-foreground", info.stale && "text-warn", className)}
      title={tooltip || undefined}
      data-served-from={info.servedFrom ?? undefined}
    >
      {parts.join(" · ")}
    </p>
  );
}

/** <DataMeta> for the newest API response under `path` (e.g. "/fundamentals/THYAO/live-ratios"). */
export function ApiDataMeta({ path, ...props }: { path: string } & Omit<Parameters<typeof DataMeta>[0], "payload">) {
  return <DataMeta payload={useApiMeta(path)} {...props} />;
}
