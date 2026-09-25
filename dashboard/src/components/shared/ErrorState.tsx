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
      className="mt-1 inline-flex h-7 items-center gap-1.5 rounded-md border border-border px-2.5 text-xs font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
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
      className={cn("flex flex-col items-center justify-center gap-2 px-4 text-center", compact ? "py-6" : "py-10", className)}
    >
      <span className="inline-flex items-center gap-1.5 text-[13px] text-foreground">
        <AlertCircle className="h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
        {message ?? t("common.dataLoadError")}
      </span>
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
        "flex flex-col items-center justify-center gap-2 px-4 text-center text-muted-foreground",
        compact ? "py-6" : "py-10",
        className,
      )}
    >
      <span className="inline-flex items-center gap-1.5 text-[13px]">
        <Inbox className="h-4 w-4 shrink-0 opacity-70" aria-hidden="true" />
        {message ?? t("common.noData")}
      </span>
      {onRetry && <RetryButton onRetry={onRetry} />}
    </div>
  );
}
