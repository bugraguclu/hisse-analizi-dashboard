"use client";

import { AlertCircle, Inbox } from "lucide-react";

export function ErrorState({ message = "Veri yuklenemedi" }: { message?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 gap-3">
      <AlertCircle className="h-8 w-8 text-destructive/60" />
      <span className="text-sm text-destructive/80">{message}</span>
    </div>
  );
}

export function EmptyState({ message = "Veri bulunamadi" }: { message?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 gap-2 text-muted-foreground">
      <Inbox className="h-8 w-8 opacity-40" />
      <span className="text-sm">{message}</span>
    </div>
  );
}
