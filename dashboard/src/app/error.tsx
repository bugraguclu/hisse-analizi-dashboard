"use client";

import { useEffect } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

export default function AppError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <section className="min-h-[60vh] flex items-center justify-center" role="alert">
      <div className="max-w-md w-full rounded-2xl border border-border/60 bg-card p-8 text-center shadow-sm">
        <div className="mx-auto mb-4 h-12 w-12 rounded-2xl bg-destructive/10 flex items-center justify-center">
          <AlertTriangle className="h-6 w-6 text-destructive" />
        </div>
        <h1 className="text-xl font-bold text-foreground">Beklenmeyen bir hata oluştu</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Ekran yüklenirken bir sorunla karşılaşıldı. İşlemi güvenle yeniden deneyebilirsiniz.
        </p>
        <button
          type="button"
          onClick={retry}
          className="mt-6 inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
        >
          <RefreshCw className="h-4 w-4" /> Yeniden dene
        </button>
      </div>
    </section>
  );
}
