"use client";

import { useState } from "react";
import Link from "next/link";
import { Dialog } from "@base-ui/react/dialog";
import { ExternalLink, FileText, X } from "lucide-react";
import { SeverityBadge } from "@/components/shared/SeverityBadge";
import { formatMarketDate } from "@/lib/format";
import { safeExternalUrl } from "@/lib/url";
import { asObj } from "./parsers";
import { isNotFoundError, useEventDetail, useKapItems } from "./hooks";
import { useStockI18n } from "./i18n";
import { SectionCard, SectionEmpty, SectionError, SectionSkeleton } from "./ui";

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function EventDetailDialog({ eventId, onClose }: { eventId: string | null; onClose: () => void }) {
  const { t } = useStockI18n();
  const detailQ = useEventDetail(eventId);
  const detail = asObj(detailQ.data);
  const title = text(detail?.title);
  const excerpt = text(detail?.excerpt);
  const body = text(detail?.body_text);
  const url = safeExternalUrl(detail?.event_url);

  return (
    <Dialog.Root open={eventId !== null} onOpenChange={(open) => (open ? undefined : onClose())}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm" />
        <Dialog.Popup className="fixed left-1/2 top-1/2 z-50 flex max-h-[85vh] w-[calc(100%-2rem)] max-w-2xl -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-border/60 bg-card shadow-2xl outline-none">
          <div className="flex items-center justify-between gap-3 border-b border-border/40 px-5 py-3.5">
            <Dialog.Title className="text-sm font-semibold text-foreground">{t("kap.detailTitle")}</Dialog.Title>
            <Dialog.Close
              aria-label={t("common.close")}
              className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
            >
              <X aria-hidden className="h-4 w-4" />
            </Dialog.Close>
          </div>
          <div className="space-y-4 overflow-y-auto p-5">
            {detailQ.isPending ? (
              <SectionSkeleton rows={5} />
            ) : detailQ.isError ? (
              isNotFoundError(detailQ.error) ? (
                <SectionEmpty message={t("kap.detailNotFound")} />
              ) : (
                <SectionError error={detailQ.error} onRetry={() => void detailQ.refetch()} />
              )
            ) : (
              <>
                <h3 className="text-base font-semibold leading-snug text-foreground">{title ?? t("kap.untitled")}</h3>
                <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                  <SeverityBadge severity={text(detail?.severity) ?? "INFO"} />
                  <span className="font-mono">{formatMarketDate(text(detail?.published_at), "dateTime")}</span>
                  {text(detail?.source_code) ? <span>{text(detail?.source_code)?.toUpperCase()}</span> : null}
                </div>
                {excerpt && excerpt !== title ? (
                  <div className="rounded-xl bg-muted/30 p-4">
                    <h4 className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{t("kap.summary")}</h4>
                    <p className="text-sm leading-relaxed text-foreground">{excerpt}</p>
                  </div>
                ) : null}
                {body ? (
                  <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground/90">{body}</p>
                ) : (
                  <p className="text-xs text-muted-foreground">{t("kap.noBody")}</p>
                )}
                {url ? (
                  <a
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
                  >
                    <ExternalLink aria-hidden className="h-3 w-3" /> {t("kap.openOnKap")}
                  </a>
                ) : null}
              </>
            )}
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/**
 * KAP disclosures: DB events (with severity and a detail view) merged with
 * the live KAP feed, which also covers disclosures the poller has not stored.
 */
export function KapEventsCard({ ticker }: { ticker: string }) {
  const { t } = useStockI18n();
  const [selected, setSelected] = useState<string | null>(null);
  const kap = useKapItems(ticker, 10);

  return (
    <SectionCard
      title={t("kap.title")}
      icon={<FileText />}
      actions={
        <Link href={`/events?ticker=${ticker}`} className="text-[11px] font-semibold text-primary hover:underline">
          {t("kap.viewAll")}
        </Link>
      }
      footer={kap.partialError ? t("kap.partialError") : t("kap.footer")}
      bodyClassName="p-0 sm:p-0"
    >
      {kap.isPending ? (
        <SectionSkeleton rows={6} className="p-4 sm:p-5" />
      ) : kap.isError ? (
        <SectionError error={kap.error} onRetry={kap.refetch} />
      ) : kap.items.length === 0 ? (
        <SectionEmpty message={t("kap.empty")} />
      ) : (
        <ul className="divide-y divide-border/30">
          {kap.items.map((item, index) => {
            const content = (
              <>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-foreground">{item.title || t("kap.untitled")}</span>
                  <span className="mt-0.5 block text-[11px] text-muted-foreground">
                    {formatMarketDate(item.time || item.publishedAt, "dateTime")} · KAP
                  </span>
                </span>
                {item.id ? (
                  <SeverityBadge severity={item.severity ?? "INFO"} />
                ) : (
                  <ExternalLink aria-hidden className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                )}
              </>
            );
            const rowClass =
              "flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/30 focus-visible:bg-muted/30 focus-visible:outline-none sm:px-5";
            return (
              <li key={item.id ?? item.url ?? `${item.time}-${index}`}>
                {item.id ? (
                  <button type="button" className={rowClass} onClick={() => setSelected(item.id)} aria-haspopup="dialog">
                    {content}
                  </button>
                ) : item.url ? (
                  <a href={item.url} target="_blank" rel="noopener noreferrer" className={rowClass}>
                    {content}
                    <span className="sr-only">{t("common.opensInNewTab")}</span>
                  </a>
                ) : (
                  <div className={rowClass}>{content}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <EventDetailDialog eventId={selected} onClose={() => setSelected(null)} />
    </SectionCard>
  );
}
