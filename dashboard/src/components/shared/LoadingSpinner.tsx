"use client";

import { Skeleton } from "@/components/ui/skeleton";

export function LoadingSpinner({ text = "Yukleniyor..." }: { text?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 gap-3">
      <div className="w-8 h-8 border-2 border-slate-200 border-t-blue-600 rounded-full animate-spin" />
      <span className="text-sm text-slate-400">{text}</span>
    </div>
  );
}

export function CardSkeleton() {
  return (
    <div className="bg-white rounded-xl border border-slate-100 p-5 shadow-sm">
      <Skeleton className="h-4 w-24 mb-3 bg-slate-100" />
      <Skeleton className="h-8 w-32 mb-2 bg-slate-100" />
      <Skeleton className="h-3 w-20 bg-slate-100" />
    </div>
  );
}

export function TableSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-2 p-4">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-10 w-full bg-slate-100" />
      ))}
    </div>
  );
}
