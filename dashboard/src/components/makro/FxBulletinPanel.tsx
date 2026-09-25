"use client";

import { useMemo, useState } from "react";
import { EMPTY_VALUE, formatMarketDate, formatNumber, getIntlLocale } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useMakroI18n } from "./i18n";
import { useFxBulletin } from "./queries";
import { ApiDataMeta } from "@/components/shared/DataMeta";
import { Panel, PanelEmpty, PanelError, PriceChange, Shimmer, SourceLine } from "./ui";
import type { FxBulletinRate } from "./types";

const COLLAPSED_ROWS = 6;

function currencyName(code: string, fallback: string): string {
  try {
    const names = new Intl.DisplayNames([getIntlLocale()], { type: "currency" });
    const name = names.of(code);
    return name && name !== code ? name : fallback;
  } catch {
    return fallback;
  }
}

/** TCMB quotes some currencies per 100 units (JPY); show them the way the bulletin does. */
function quoted(value: number | null, rate: FxBulletinRate): string {
  if (value === null) return EMPTY_VALUE;
  return formatNumber(value * (rate.quoted_unit || 1), 4);
}

export function FxBulletinPanel({ className }: { className?: string }) {
  const { t } = useMakroI18n();
  const bulletinQ = useFxBulletin();
  const [expanded, setExpanded] = useState(false);
  const rates = useMemo(() => bulletinQ.data?.rates ?? [], [bulletinQ.data?.rates]);
  const shown = expanded ? rates : rates.slice(0, COLLAPSED_ROWS);
  const date = bulletinQ.data?.date;

  return (
    <Panel
      className={className}
      title={t("fx.title")}
      subtitle={date ? t("fx.desc", { date: formatMarketDate(date, "date") }) : undefined}
      footer={
        <>
          <SourceLine source="TCMB" />
          <p className="mt-1">{t("fx.note")}</p>
          <ApiDataMeta path="/macro/fx-bulletin" className="mt-1" />
        </>
      }
    >
      {bulletinQ.isPending ? (
        <div className="space-y-1.5">
          {Array.from({ length: COLLAPSED_ROWS }, (_, i) => (
            <Shimmer key={i} className="h-7" />
          ))}
        </div>
      ) : bulletinQ.isError && !bulletinQ.data ? (
        <PanelError error={bulletinQ.error} onRetry={() => void bulletinQ.refetch()} />
      ) : rates.length === 0 ? (
        <PanelEmpty />
      ) : (
        <>
          <div className={cn("overflow-x-auto scrollbar-thin", expanded && "max-h-[26rem] overflow-y-auto")}>
            <table className="w-full min-w-[34rem] text-xs">
              <caption className="sr-only">{t("fx.title")}</caption>
              <thead className="sticky top-0 z-10 bg-card">
                <tr className="border-b border-border text-[11px] uppercase tracking-wider text-muted-foreground">
                  <th scope="col" className="py-1.5 pr-3 text-left font-medium">{t("fx.currency")}</th>
                  <th scope="col" className="py-1.5 pr-3 text-right font-medium">{t("fx.forexBuying")}</th>
                  <th scope="col" className="py-1.5 pr-3 text-right font-medium">{t("fx.forexSelling")}</th>
                  <th scope="col" className="py-1.5 pr-3 text-right font-medium">{t("fx.banknoteBuying")}</th>
                  <th scope="col" className="py-1.5 pr-3 text-right font-medium">{t("fx.banknoteSelling")}</th>
                  <th scope="col" className="py-1.5 text-right font-medium">{t("fx.change")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {shown.map((rate) => (
                  <tr key={rate.currency}>
                    <th scope="row" className="py-1.5 pr-3 text-left font-normal">
                      <span className="font-mono font-medium text-foreground">
                        {rate.quoted_unit > 1 ? `${rate.quoted_unit} ` : ""}
                        {rate.currency}
                      </span>
                      <span className="ml-2 hidden text-muted-foreground sm:inline">{currencyName(rate.currency, rate.name)}</span>
                    </th>
                    <td className="py-1.5 pr-3 text-right font-mono tabular-nums text-foreground">{quoted(rate.forex_buying, rate)}</td>
                    <td className="py-1.5 pr-3 text-right font-mono tabular-nums text-foreground">{quoted(rate.forex_selling, rate)}</td>
                    <td className="py-1.5 pr-3 text-right font-mono tabular-nums text-muted-foreground">{quoted(rate.banknote_buying, rate)}</td>
                    <td className="py-1.5 pr-3 text-right font-mono tabular-nums text-muted-foreground">{quoted(rate.banknote_selling, rate)}</td>
                    <td className="py-1.5 text-right">
                      <PriceChange value={rate.change_percent} className="justify-end" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rates.length > COLLAPSED_ROWS ? (
            <button
              type="button"
              onClick={() => setExpanded((value) => !value)}
              aria-expanded={expanded}
              className="mt-2 text-[11px] font-medium text-primary hover:underline focus-visible:outline-2 focus-visible:outline-ring"
            >
              {expanded ? t("common.showLess") : t("common.showAll", { count: rates.length })}
            </button>
          ) : null}
        </>
      )}
    </Panel>
  );
}
