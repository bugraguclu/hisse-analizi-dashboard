"use client";

import { Building2 } from "lucide-react";
import { formatChangePercent, formatCompact, formatMultiple, formatNumber, formatPercent, formatPrice } from "@/lib/format";
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

function YearRange({ low, high, current }: { low: number; high: number; current: number | null }) {
  const { t } = useStockI18n();
  const span = high - low || 1;
  const position = current != null ? Math.min(Math.max((current - low) / span, 0), 1) : null;
  return (
    <div>
      <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{t("profile.yearRange")}</div>
      <div className="relative mt-3 h-1.5 rounded-full bg-gradient-to-r from-down/40 via-muted to-up/40">
        {position != null ? (
          <span
            className="absolute top-1/2 h-3.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-foreground"
            style={{ left: `${position * 100}%` }}
            title={formatPrice(current)}
          />
        ) : null}
      </div>
      <div className="mt-1.5 flex justify-between font-mono text-[11px] tabular-nums text-muted-foreground">
        <span>{formatPrice(low)}</span>
        {position != null ? (
          <span className="text-foreground">{t("profile.fromHigh", { value: formatChangePercent(((current ?? high) / high - 1) * 100, 1) })}</span>
        ) : null}
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
    { key: "legal", label: t("profile.legalName"), value: identity.identity?.legalName ?? company?.legalName ?? "—" },
    { key: "sector", label: t("profile.sector"), value: company?.sector ?? "—" },
    { key: "market", label: t("profile.market"), value: company?.market ?? "—" },
    { key: "exchange", label: t("profile.exchange"), value: [fi?.exchange ?? "BIST", fi?.currency].filter(Boolean).join(" · ") },
    { key: "shares", label: t("profile.shares"), value: formatCompact(fi?.shares) },
    { key: "floatShares", label: t("profile.floatShares"), value: formatCompact(floatShares) },
    { key: "freeFloat", label: t("stats.freeFloat"), value: formatPercent(fi?.freeFloat, 1) },
    { key: "foreign", label: t("stats.foreignRatio"), value: formatPercent(fi?.foreignRatio, 1) },
    { key: "website", label: t("profile.website"), value: company?.website ?? "—" },
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
    <SectionCard title={t("profile.title")} icon={<Building2 />} footer={t("profile.footer")}>
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
