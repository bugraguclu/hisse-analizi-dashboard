"use client";

import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { X, ExternalLink } from "lucide-react";
import { api } from "@/lib/api";
import { formatMarketDate, EMPTY_VALUE } from "@/lib/format";
import { SeverityBadge, CategoryBadge } from "@/components/shared/SeverityBadge";
import { LoadingSpinner } from "@/components/shared/LoadingSpinner";
import { EmptyState, ErrorState } from "@/components/shared/ErrorState";
import { useLocale } from "@/lib/locale-context";
import { safeExternalUrl } from "@/lib/url";
import type { EventDetailOut } from "@/types";
import { normalizeCategory } from "./eventTaxonomy";

export function EventDetailModal({
  eventId,
  onClose,
}: {
  eventId: string;
  onClose: () => void;
}) {
  const { t } = useLocale();
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["eventDetail", eventId],
    queryFn: () => api.eventDetail(eventId),
    enabled: !!eventId,
  });

  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const previouslyFocused = useRef<Element | null>(null);

  const detail = data as EventDetailOut | null;
  const eventUrl = safeExternalUrl(detail?.event_url);
  const category = normalizeCategory(detail?.category);

  // Focus the dialog on open and return focus to the triggering row on close,
  // so keyboard/screen-reader users aren't dropped back at the top of the page.
  useEffect(() => {
    previouslyFocused.current = document.activeElement;
    closeButtonRef.current?.focus();
    return () => {
      if (previouslyFocused.current instanceof HTMLElement) previouslyFocused.current.focus();
    };
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 10 }}
        transition={{ duration: 0.2 }}
        className="relative bg-card border border-border/60 rounded-2xl shadow-2xl max-w-2xl w-full max-h-[80vh] overflow-hidden"
        role="dialog"
        aria-modal="true"
        aria-labelledby="event-detail-title"
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-border/40">
          <h3 id="event-detail-title" className="text-sm font-semibold text-foreground">{t("events.detail")}</h3>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            aria-label={t("common.close")}
            className="p-1.5 rounded-lg hover:bg-muted/50 transition-colors focus-visible:ring-2 focus-visible:ring-primary/40 outline-none"
          >
            <X className="h-4 w-4 text-muted-foreground" />
          </button>
        </div>

        <div className="overflow-y-auto p-5 space-y-4" style={{ maxHeight: "calc(80vh - 60px)" }}>
          {isError ? (
            <ErrorState message={t("common.loadError")} onRetry={() => { void refetch(); }} />
          ) : isLoading ? (
            <LoadingSpinner text={t("common.loading")} />
          ) : !detail ? (
            <EmptyState message={t("events.detailNotFound")} />
          ) : (
            <>
              <div>
                <h2 className="text-base font-semibold text-foreground leading-snug">
                  {detail.title || t("events.untitled")}
                </h2>
                <div className="flex items-center gap-2 mt-2 flex-wrap">
                  {detail.ticker && (
                    <span className="text-xs font-bold text-primary bg-primary/10 px-2 py-0.5 rounded">
                      {detail.ticker}
                    </span>
                  )}
                  <CategoryBadge category={category} />
                  <SeverityBadge severity={detail.severity} />
                  <span className="text-[10px] text-muted-foreground font-mono">
                    {formatMarketDate(detail.published_at, "dateTime")}
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    {detail.source_code?.toUpperCase()}
                  </span>
                </div>
              </div>

              {detail.excerpt && (
                <div className="bg-muted/30 rounded-xl p-4">
                  <h4 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                    {t("events.summary")}
                  </h4>
                  <p className="text-sm text-foreground leading-relaxed">{detail.excerpt}</p>
                </div>
              )}

              {detail.body_text && (
                <div className="prose prose-sm dark:prose-invert max-w-none">
                  <p className="text-sm text-foreground/90 leading-relaxed whitespace-pre-wrap">
                    {detail.body_text}
                  </p>
                </div>
              )}

              {eventUrl && (
                <a
                  href={eventUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:text-primary/80 transition-colors"
                >
                  <ExternalLink className="h-3 w-3" />
                  {t("events.goToSource")}
                </a>
              )}

              {detail.metadata_json && Object.keys(detail.metadata_json).length > 0 && (
                <div className="bg-muted/20 rounded-xl p-4">
                  <h4 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                    {t("events.additionalInfo")}
                  </h4>
                  <div className="space-y-1.5">
                    {Object.entries(detail.metadata_json).map(([key, val]) => (
                      <div key={key} className="flex justify-between text-xs">
                        <span className="text-muted-foreground">{key}</span>
                        <span className="text-foreground font-mono">{val == null ? EMPTY_VALUE : String(val)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </motion.div>
    </div>
  );
}
