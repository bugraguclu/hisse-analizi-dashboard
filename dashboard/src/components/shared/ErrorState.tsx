"use client";

import { AlertCircle } from "lucide-react";

export function ErrorState({ message = "Veri yuklenemedi" }: { message?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 gap-3">
      <AlertCircle className="h-8 w-8 text-red-400" />
      <span className="text-sm text-red-500">{message}</span>
    </div>
  );
}

export function EmptyState({ message = "Veri bulunamadi" }: { message?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 gap-2 text-slate-400">
      <span className="text-sm">{message}</span>
    </div>
  );
}
