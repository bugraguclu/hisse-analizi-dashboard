"use client";

import { AlertCircle, Inbox, RefreshCw, WifiOff } from "lucide-react";

export function ErrorState({
  message = "Veri yuklenemedi",
  onRetry,
}: {
  message?: string;
  onRetry?: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-10 gap-3">
      <div className="w-12 h-12 rounded-2xl bg-destructive/10 flex items-center justify-center">
        <AlertCircle className="h-6 w-6 text-destructive/70" />
      </div>
      <span className="text-sm text-destructive/80 font-medium">{message}</span>
      {onRetry && (
        <button
          onClick={onRetry}
          className="flex items-center gap-1.5 text-xs font-medium text-primary hover:text-primary/80 px-3 py-1.5 rounded-lg border border-border/60 hover:bg-muted/50 transition-all mt-1"
        >
          <RefreshCw className="h-3 w-3" />
          Tekrar dene
        </button>
      )}
    </div>
  );
}

export function EmptyState({
  message = "Veri bulunamadi",
  onRetry,
}: {
  message?: string;
  onRetry?: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-10 gap-2.5 text-muted-foreground">
      <div className="w-12 h-12 rounded-2xl bg-muted/50 flex items-center justify-center">
        <Inbox className="h-6 w-6 opacity-50" />
      </div>
      <span className="text-sm font-medium">{message}</span>
      {onRetry && (
        <button
          onClick={onRetry}
          className="flex items-center gap-1.5 text-xs font-medium text-primary hover:text-primary/80 px-3 py-1.5 rounded-lg border border-border/60 hover:bg-muted/50 transition-all mt-1"
        >
          <RefreshCw className="h-3 w-3" />
          Tekrar dene
        </button>
      )}
    </div>
  );
}

export function OfflineState({ message = "Backend baglantisi kurulamadi" }: { message?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-10 gap-2.5 text-muted-foreground">
      <div className="w-12 h-12 rounded-2xl bg-amber-500/10 flex items-center justify-center">
        <WifiOff className="h-6 w-6 text-amber-500/70" />
      </div>
      <span className="text-sm font-medium">{message}</span>
      <span className="text-[11px] text-muted-foreground/70">Backend sunucusunun calisiyor oldugundan emin olun</span>
    </div>
  );
}
