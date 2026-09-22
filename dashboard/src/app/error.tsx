"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowLeft, RefreshCw } from "lucide-react";
import { useLocale } from "@/lib/locale-context";

export default function AppError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  const { t } = useLocale();

  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <section className="flex min-h-[60vh] items-center justify-center" role="alert" aria-labelledby="error-title">
      <div className="w-full max-w-md rounded-2xl border border-border/60 bg-card p-8 text-center shadow-sm">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-destructive/10">
          <AlertTriangle className="h-6 w-6 text-destructive" aria-hidden="true" />
        </div>
        <h1 id="error-title" className="text-xl font-bold text-foreground">
          {t("error.title")}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">{t("error.description")}</p>
        {error.digest && (
          <p className="mt-3 font-mono text-[11px] text-muted-foreground">
            {t("error.code")}: {error.digest}
          </p>
        )}
        <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
          <button
            type="button"
            onClick={() => retry()}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            <RefreshCw className="h-4 w-4" aria-hidden="true" /> {t("common.retry")}
          </button>
          <Link
            href="/"
            className="inline-flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-semibold text-foreground hover:bg-muted/60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" /> {t("error.backHome")}
          </Link>
        </div>
      </div>
    </section>
  );
}
