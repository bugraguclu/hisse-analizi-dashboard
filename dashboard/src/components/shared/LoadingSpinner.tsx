"use client";

import { Loader2 } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useLocale } from "@/lib/locale-context";

/** Quiet inline loading state: a small spinner and a label. */
export function LoadingSpinner({ text }: { text?: string }) {
  const { t } = useLocale();
  const label = text ?? t("common.loading");
  return (
    <div role="status" aria-live="polite" className="flex items-center justify-center gap-2 py-10 text-xs text-muted-foreground">
      <Loader2 aria-hidden="true" className="h-3.5 w-3.5 animate-spin" />
      {label}
    </div>
  );
}

export function CardSkeleton() {
  return (
    <div className="card-surface p-4" aria-hidden="true">
      <Skeleton className="mb-3 h-4 w-24" />
      <Skeleton className="mb-2 h-8 w-32" />
      <Skeleton className="h-3 w-20" />
    </div>
  );
}

export function TableSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-1.5 p-4" aria-hidden="true">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-9 w-full" />
      ))}
    </div>
  );
}
