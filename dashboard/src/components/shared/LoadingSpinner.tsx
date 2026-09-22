"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { OrbitalLoader } from "@/components/ui/orbital-loader";
import { useLocale } from "@/lib/locale-context";

export function LoadingSpinner({ text }: { text?: string }) {
  const { t } = useLocale();
  const label = text ?? t("common.loading");
  return (
    <div role="status" aria-live="polite" className="flex flex-col items-center justify-center gap-3 py-12">
      <OrbitalLoader message={label} />
    </div>
  );
}

export function CardSkeleton() {
  return (
    <div className="rounded-xl border border-border bg-card p-5" aria-hidden="true">
      <Skeleton className="mb-3 h-4 w-24" />
      <Skeleton className="mb-2 h-8 w-32" />
      <Skeleton className="h-3 w-20" />
    </div>
  );
}

export function TableSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-2 p-4" aria-hidden="true">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-10 w-full" />
      ))}
    </div>
  );
}
