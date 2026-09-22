"use client";

import { AlertCircle, Inbox, RefreshCw } from "lucide-react";
import { useLocale } from "@/lib/locale-context";
import { cn } from "@/lib/utils";

function RetryButton({ onRetry }: { onRetry: () => void }) {
  const { t } = useLocale();
  return (
    <button
      type="button"
      onClick={onRetry}
      className="mt-1 flex items-center gap-1.5 rounded-lg border border-border/60 px-3 py-1.5 text-xs font-medium text-primary transition-colors hover:bg-muted/50 hover:text-primary/80 focus-visible:outline-2 focus-visible:outline-ring"
    >
      <RefreshCw className="h-3 w-3" aria-hidden="true" />
      {t("common.retry")}
    </button>
  );
}

/** Failed request. `message` defaults to a localized "could not load data". */
export function ErrorState({
  message,
  onRetry,
  compact = false,
  className,
}: {
  message?: string;
  onRetry?: () => void;
  /** Smaller padding for use inside cards/rows. */
  compact?: boolean;
  className?: string;
}) {
  const { t } = useLocale();
  return (
    <div
      role="alert"
      className={cn("flex flex-col items-center justify-center gap-3 px-4 text-center", compact ? "py-6" : "py-10", className)}
    >
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-destructive/10">
        <AlertCircle className="h-6 w-6 text-destructive/70" aria-hidden="true" />
      </div>
      <span className="text-sm font-medium text-destructive/80">{message ?? t("common.dataLoadError")}</span>
      {onRetry && <RetryButton onRetry={onRetry} />}
    </div>
  );
}

/** Successful request without data. `message` defaults to a localized "no data found". */
export function EmptyState({
  message,
  onRetry,
  compact = false,
  className,
}: {
  message?: string;
  onRetry?: () => void;
  compact?: boolean;
  className?: string;
}) {
  const { t } = useLocale();
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-2.5 px-4 text-center text-muted-foreground",
        compact ? "py-6" : "py-10",
        className,
      )}
    >
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-muted/50">
        <Inbox className="h-6 w-6 opacity-50" aria-hidden="true" />
      </div>
      <span className="text-sm font-medium">{message ?? t("common.noData")}</span>
      {onRetry && <RetryButton onRetry={onRetry} />}
    </div>
  );
}
