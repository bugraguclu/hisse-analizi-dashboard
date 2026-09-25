"use client";

import { formatChangePercent, formatCompact, formatMultiple, formatNumber, formatPercent, formatPrice, EMPTY_VALUE } from "@/lib/format";
import { safeExternalUrl } from "@/lib/url";
import { useCompanyProfile, useFastInfo, useQuote, useRatios } from "./hooks";
import { useStockI18n } from "./i18n";
import { useShellIdentity } from "./StockShell";
import { SectionCard, SectionError, Stat } from "./ui";

function positive(value: number | null | undefined): number | null {
  return value != null && value > 0 ? value : null;
}

/** Free-text rows (wrap instead of truncating, no monospace). */
const TEXT_ITEMS = new Set(["name", "legal", "sector", "market", "exchange", "website"]);
/** Rows that come from the KAP company card (`/fundamentals/{t}/info`). */
const PROFILE_ITEMS = new Set(["sector", "market", "website"]);

/** A few abbreviations that should keep their canonical casing instead of being title-cased. */
const KEEP_CASE_TR: Record<string, string> = { bist: "BIST", "a.o.": "A.O.", "a.ş.": "A.Ş.", "t.a.ş.": "T.A.Ş." };

/** Conjunctions/particles that stay lower-case inside a title ("… ve Depolama"). */
const LOWER_WORDS_TR = new Set(["ve", "ile", "veya", "ya", "da", "de", "ki", "için"]);

/** "ULAŞTIRMA VE DEPOLAMA" → "Ulaştırma ve Depolama" (Turkish-aware; sector/market come from
 *  KAP in shouting uppercase). A couple of known abbreviations keep their canonical casing. */
function titleCaseTr(raw: string): string {
  return raw
    .trim()
    .toLocaleLowerCase("tr-TR")
    .split(/\s+/)
    .map(
      (word, index) =>
        KEEP_CASE_TR[word] ??
        (index > 0 && LOWER_WORDS_TR.has(word)
          ? word
          : // First letter, even after an opening "(" or quote.
            word.replace(/\p{L}/u, (letter) => letter.toLocaleUpperCase("tr-TR"))),
    )
    .join(" ");
}

/** Legal names arrive either properly cased or in KAP's all-caps form ("TÜRK HAVA YOLLARI A.O.");
 *  only the all-caps form is title-cased, so mixed-case names keep their own spelling. */
function displayName(raw: string | null | undefined): string | null {
  if (!raw) return null;
  return /\p{Ll}/u.test(raw) ? raw : titleCaseTr(raw);
}

/** Backend "website" is sometimes one URL, sometimes several joined with " / " or runs of
 *  spaces, occasionally with a free-text label glued on (e.g. "Kurumsal Sitesi: www.x.com").
 *  Pull out every URL-looking token; everything else (labels, stray separators) is dropped. */
function extractWebsiteUrls(raw: string): string[] {
  const urls: string[] = [];
  for (const token of raw.split(/\s+/)) {
    const match = token.match(/(https?:\/\/\S+|www\.\S+)/i);
    if (!match) continue;
    const cleaned = match[1].replace(/[),.;]+$/, "");
    const withScheme = /^https?:\/\//i.test(cleaned) ? cleaned : `https://${cleaned}`;
    const url = safeExternalUrl(withScheme);
    if (url && !urls.includes(url)) urls.push(url);
  }
  return urls;
}

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, "");
  } catch {
    return url;
  }
}

function WebsiteLinks({ raw }: { raw: string }) {
  const { t } = useStockI18n();
  const urls = extractWebsiteUrls(raw);
  if (urls.length === 0) return <>{EMPTY_VALUE}</>;
  return (
    <div className="flex flex-col gap-1">
      {urls.map((url) => (
        <a
          key={url}
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          title={url}
          className="inline-flex max-w-full items-center gap-1 truncate rounded-sm text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
        >
          <span className="truncate">{hostnameOf(url)}</span>
          <span className="sr-only">{t("common.opensInNewTab")}</span>
        </a>
      ))}
    </div>
  );
}

/** 52-week range: low/high at the ends, a marker for the current price, and its distance
 *  from the high on its own line so it never collides with the marker or the end labels. */
function YearRange({ low, high, current }: { low: number; high: number; current: number | null }) {
  const { t } = useStockI18n();
  const span = high - low || 1;
  const position = current != null ? Math.min(Math.max((current - low) / span, 0), 1) : null;
  const fromHigh = current != null ? formatChangePercent((current / high - 1) * 100, 1) : null;
  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{t("profile.yearRange")}</span>
        {current != null && fromHigh != null ? (
          <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
            <span className="font-semibold text-foreground">{formatPrice(current)}</span> {t("profile.fromHigh", { value: fromHigh })}
          </span>
        ) : null}
      </div>
      <div className="relative mt-2.5 h-1.5 rounded-full bg-muted">
        {position != null ? (
          <span
            aria-hidden
            className="absolute top-1/2 h-3.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-foreground ring-2 ring-card"
            style={{ left: `${position * 100}%` }}
          />
        ) : null}
      </div>
      <div className="mt-1.5 flex justify-between font-mono text-[11px] tabular-nums text-muted-foreground">
        <span>{formatPrice(low)}</span>
        <span>{formatPrice(high)}</span>
      </div>
    </div>
  );
}

/**
 * Company identity (KAP company card) + market/valuation snapshot. F/K and
 * PD/DD come from TradingView fast_info like everywhere else on the page
 * (computed ratios only as a fallback); F/S and FD/FAVÖK from KAP statements.
 */
export function CompanyProfileCard({ ticker }: { ticker: string }) {
  const { t } = useStockI18n();
  const identity = useShellIdentity();
  const fastQ = useFastInfo(ticker);
  const ratiosQ = useRatios(ticker);
  const profileQ = useCompanyProfile(ticker);
  const { quote } = useQuote(ticker);
  const fi = fastQ.data ?? null;
  const company = profileQ.data ?? null;
  const ratios = ratiosQ.data?.values ?? {};
  const pending = fastQ.isPending;
  const floatShares = fi?.shares != null && fi.freeFloat != null ? (fi.shares * fi.freeFloat) / 100 : null;
  const price = quote?.last ?? fi?.last ?? null;

  const profile = [
    { key: "name", label: t("profile.name"), value: identity.identity?.name ?? ticker },
    { key: "legal", label: t("profile.legalName"), value: displayName(identity.identity?.legalName ?? company?.legalName) ?? EMPTY_VALUE },
    { key: "sector", label: t("profile.sector"), value: company?.sector ? titleCaseTr(company.sector) : EMPTY_VALUE },
    { key: "market", label: t("profile.market"), value: company?.market ? titleCaseTr(company.market) : EMPTY_VALUE },
    { key: "exchange", label: t("profile.exchange"), value: [fi?.exchange ?? "BIST", fi?.currency].filter(Boolean).join(" · ") },
    { key: "shares", label: t("profile.shares"), value: formatCompact(fi?.shares) },
    { key: "floatShares", label: t("profile.floatShares"), value: formatCompact(floatShares) },
    { key: "freeFloat", label: t("stats.freeFloat"), value: formatPercent(fi?.freeFloat, 1) },
    { key: "foreign", label: t("stats.foreignRatio"), value: formatPercent(fi?.foreignRatio, 1) },
    { key: "website", label: t("profile.website"), value: company?.website ? <WebsiteLinks raw={company.website} /> : EMPTY_VALUE },
  ];
  const itemPending = (key: string) => {
    if (key === "name") return identity.status === "loading";
    if (key === "legal") return identity.status === "loading" || (!identity.identity?.legalName && profileQ.isPending);
    return PROFILE_ITEMS.has(key) ? profileQ.isPending : pending;
  };
  const valuation = [
    { key: "mcap", label: t("stats.marketCap"), value: formatCompact(fi?.marketCap ?? quote?.marketCap) },
    { key: "pe", label: t("stats.pe"), value: formatNumber(positive(fi?.pe ?? ratios.pe_ratio)) },
    { key: "pb", label: t("stats.pb"), value: formatNumber(positive(fi?.pb ?? ratios.pb_ratio)) },
    { key: "ps", label: t("profile.ps"), value: formatMultiple(positive(ratios.ps_ratio)) },
    { key: "evEbitda", label: t("profile.evEbitda"), value: formatMultiple(positive(ratios.ev_ebitda)) },
    { key: "avg50", label: t("stats.avg50"), value: formatPrice(fi?.avg50) },
    { key: "avg200", label: t("stats.avg200"), value: formatPrice(fi?.avg200) },
  ];

  return (
    <SectionCard title={t("profile.title")} footer={t("profile.footer")}>
      {fastQ.isError && !fi ? (
        <SectionError error={fastQ.error} onRetry={() => void fastQ.refetch()} />
      ) : (
        <div className="space-y-5">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
            {profile.map((item) => (
              <Stat
                key={item.key}
                label={item.label}
                value={item.value}
                pending={itemPending(item.key)}
                valueClassName={TEXT_ITEMS.has(item.key) ? "font-sans whitespace-normal break-words" : undefined}
              />
            ))}
          </dl>
          <div className="border-t border-border/40 pt-4">
            <h3 className="mb-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{t("profile.valuation")}</h3>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
              {valuation.map((item) => {
                // Computed ratios are needed for F/S, FD/FAVÖK and as the F/K–PD/DD fallback.
                const needsRatios =
                  item.key === "ps" || item.key === "evEbitda" || (item.key === "pe" && fi?.pe == null) || (item.key === "pb" && fi?.pb == null);
                return <Stat key={item.key} label={item.label} value={item.value} pending={pending || (needsRatios && ratiosQ.isPending)} />;
              })}
            </dl>
          </div>
          {fi?.yearLow != null && fi.yearHigh != null ? <YearRange low={fi.yearLow} high={fi.yearHigh} current={price} /> : null}
        </div>
      )}
    </SectionCard>
  );
}
