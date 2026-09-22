"use client";

import Link from "next/link";
import { useLocale } from "@/lib/locale-context";

export interface CompanyListItem {
  symbol: string;
  name: string;
}

export function CompaniesGrid({ companies }: { companies: CompanyListItem[] }) {
  const { t, locale } = useLocale();
  if (companies.length === 0) return null;

  return (
    <div className="bg-card rounded-2xl border border-border/60 overflow-hidden">
      <div className="px-5 py-4 border-b border-border/40 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-foreground">
          {locale === "en" ? "All BIST Companies" : locale === "fr" ? "Toutes les sociétés BIST" : "Tüm BIST Şirketleri"}
        </h2>
        <span className="text-[10px] font-mono text-muted-foreground bg-muted/50 px-2 py-0.5 rounded">
          {companies.length} {t("common.stocks")}
        </span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-0 divide-x divide-y divide-border/20 max-h-96 overflow-y-auto">
        {companies.map((c) => (
          <Link key={c.symbol} href={`/hisse/${c.symbol}`} className="px-4 py-3 hover:bg-muted/10 transition-colors">
            <div className="text-xs font-bold text-primary">{c.symbol}</div>
            {c.name && c.name !== c.symbol && (
              <div className="text-[10px] text-muted-foreground truncate mt-0.5">{c.name}</div>
            )}
          </Link>
        ))}
      </div>
    </div>
  );
}
