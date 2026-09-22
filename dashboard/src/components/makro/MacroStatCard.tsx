"use client";

import type { ComponentType, ReactNode } from "react";
import { LoadingSpinner } from "@/components/shared/LoadingSpinner";
import { ErrorState } from "@/components/shared/ErrorState";
import { useLocale } from "@/lib/locale-context";

/**
 * Generic macro-page card shell. Deliberately has no fixed/`h-full` height —
 * cards in the same grid row can have different natural heights (e.g. once
 * a trend chart is added to one), and the grid itself uses `items-start` so
 * shorter siblings don't get stretched into an empty box.
 *
 * `isError` renders a distinct error state instead of `children` — a failed
 * fetch must never fall through to the same "-" a genuinely empty response
 * would show.
 */
export function MacroStatCard({
  title,
  icon: Icon,
  children,
  isLoading,
  isError,
  errorMessage,
  onRetry,
}: {
  title: string;
  icon?: ComponentType<{ className?: string }>;
  children: ReactNode;
  isLoading?: boolean;
  isError?: boolean;
  errorMessage?: string;
  onRetry?: () => void;
}) {
  const { t } = useLocale();
  return (
    <div className="bg-card rounded-2xl border border-border/60 p-5 hover:shadow-sm transition-all">
      <div className="flex items-center gap-2 mb-4">
        {Icon && <Icon className="h-4 w-4 text-primary" />}
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      </div>
      {isError ? (
        <ErrorState message={errorMessage || t("common.loadError")} onRetry={onRetry} />
      ) : isLoading ? (
        <LoadingSpinner text={t("common.loading")} />
      ) : (
        children
      )}
    </div>
  );
}

/** "Source · as of <date>" attribution line, shared by every macro card. */
export function SourceFooter({ source, asOf }: { source?: string | null; asOf?: string | null }) {
  if (!source && !asOf) return null;
  return (
    <p className="text-[10px] text-muted-foreground mt-2 pt-2 border-t border-border/30">
      {[source, asOf].filter(Boolean).join(" · ")}
    </p>
  );
}
