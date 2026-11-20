"use client";

import { formatMarketDate, formatRelativeTime, parseDate } from "@/lib/format";
import { useLocale } from "@/lib/locale-context";
import type { Locale } from "@/lib/i18n";
import { useNow } from "@/hooks/use-now";
import { useApiMeta } from "@/lib/api-meta";
import { readDataMeta, sourceName, type DataMetaInfo, type ServedFrom } from "@/lib/data-meta";
import { cn } from "@/lib/utils";

export { readDataMeta, sourceName, type DataMetaInfo, type ServedFrom };

const DICT = {
  stale: {
    tr: "Sağlayıcıya ulaşılamadı; son kayıtlı veri",
    en: "Provider unreachable; last saved data",
    fr: "Fournisseur injoignable ; dernières données enregistrées",
  },
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
  return parts;
}

/**
 * Low-prominence provenance line (11px muted text; warn colour only when stale).
 * - default: shows only what the reader must know — the stale fallback
 * - `showSource` / `showAsOf`: also name the source / the date the data describes
 * The full detail (source, fetch time, served-from, backend notes) is in the tooltip.
 */
export function DataMeta({
  payload,
  showSource = false,
  showAsOf = false,
  className,
}: {
  /** Raw API response (the component reads its `meta` block). */
  payload: unknown;
  showSource?: boolean;
  showAsOf?: boolean;
  className?: string;
}) {
  const { locale } = useLocale();
  const now = useNow();
  const info = readDataMeta(payload);
  if (!info) return null;

  const parts = describe(info, locale, now);
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
