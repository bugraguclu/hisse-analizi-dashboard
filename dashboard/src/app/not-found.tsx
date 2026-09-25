"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { useLocale } from "@/lib/locale-context";
import { buttonVariants } from "@/components/ui/button";
import { TickerSearch } from "@/components/shared/TickerSearch";

export default function NotFound() {
  const { t } = useLocale();
  return (
    <section className="mx-auto max-w-7xl py-10 md:py-16" aria-labelledby="not-found-title">
      <div className="max-w-lg">
        <p className="font-mono text-xs text-muted-foreground">404</p>
        <h1 id="not-found-title" className="mt-2 text-[32px] font-semibold leading-tight text-foreground">
          {t("notFound.title")}
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{t("notFound.description")}</p>
        <div className="mt-6 max-w-sm">
          <TickerSearch />
        </div>
        <Link href="/" className={buttonVariants({ variant: "outline", className: "mt-6" })}>
          <ArrowLeft aria-hidden="true" /> {t("error.backHome")}
        </Link>
      </div>
    </section>
  );
}
