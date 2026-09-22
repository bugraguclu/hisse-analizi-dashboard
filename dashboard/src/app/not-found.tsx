"use client";

import Link from "next/link";
import { ArrowLeft, SearchX } from "lucide-react";
import { useLocale } from "@/lib/locale-context";

export default function NotFound() {
  const { t } = useLocale();
  return (
    <section className="flex min-h-[60vh] items-center justify-center" aria-labelledby="not-found-title">
      <div className="w-full max-w-md rounded-2xl border border-border/60 bg-card p-8 text-center shadow-sm">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-muted">
          <SearchX className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
        </div>
        <p className="text-xs font-bold uppercase tracking-widest text-primary">404</p>
        <h1 id="not-found-title" className="mt-2 text-xl font-bold text-foreground">
          {t("notFound.title")}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">{t("notFound.description")}</p>
        <Link
          href="/"
          className="mt-6 inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" /> {t("error.backHome")}
        </Link>
      </div>
    </section>
  );
}
