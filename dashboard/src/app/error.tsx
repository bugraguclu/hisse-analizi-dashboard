"use client";

import { useEffect } from "react";
import Link from "next/link";
import { ArrowLeft, RefreshCw } from "lucide-react";
import { useLocale } from "@/lib/locale-context";
import { isAssetLoadError, recoverStartup } from "@/lib/startup-recovery";
import { Button, buttonVariants } from "@/components/ui/button";

export default function AppError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  const { t } = useLocale();
  const assetError = isAssetLoadError(error);

  useEffect(() => {
    console.error(error);
    if (assetError) {
      recoverStartup(error);
    }
  }, [assetError, error]);

  return (
    <section className="mx-auto max-w-7xl py-10 md:py-16" role="alert" aria-labelledby="error-title">
      <div className="max-w-lg border-l-2 border-destructive pl-5">
        <h1 id="error-title" className="text-[32px] font-semibold leading-tight text-foreground">
          {assetError ? t("error.assetTitle") : t("error.title")}
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          {assetError ? t("error.assetDescription") : t("error.description")}
        </p>
        {error.digest && (
          <p className="mt-3 font-mono text-[11px] text-muted-foreground">
            {t("error.code")}: {error.digest}
          </p>
        )}
        <div className="mt-6 flex flex-wrap items-center gap-2">
          {assetError ? (
            <Button onClick={() => window.location.reload()}>
              <RefreshCw aria-hidden="true" /> {t("recovery.reload")}
            </Button>
          ) : (
            <Button onClick={() => retry()}>
              <RefreshCw aria-hidden="true" /> {t("common.retry")}
            </Button>
          )}
          <Link href="/" className={buttonVariants({ variant: "outline" })}>
            <ArrowLeft aria-hidden="true" /> {t("error.backHome")}
          </Link>
        </div>
      </div>
    </section>
  );
}
