"use client";

import { usePathname } from "next/navigation";
import { TickerSearch } from "@/components/shared/TickerSearch";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { LocaleToggle } from "@/components/ui/locale-toggle";
import { useLocale } from "@/lib/locale-context";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import type { TranslationKey } from "@/lib/i18n";

const routeLabelKeys: Record<string, TranslationKey> = {
  "": "nav.dashboard",
  events: "nav.events",
  hisse: "nav.stockAnalysis",
  teknik: "nav.technicalAnalysis",
  temel: "nav.fundamentalAnalysis",
  makro: "nav.macroEconomy",
  tarama: "nav.screening",
};

export function TopBar() {
  const pathname = usePathname();
  const { t } = useLocale();
  const segments = pathname.split("/").filter(Boolean);

  const breadcrumbs = segments.map((segment, index) => {
    const href = "/" + segments.slice(0, index + 1).join("/");
    const labelKey = routeLabelKeys[segment];
    const label = labelKey ? t(labelKey) : segment.toUpperCase();
    const isLast = index === segments.length - 1;
    return { href, label, isLast };
  });

  return (
    <header className="h-14 bg-card/60 backdrop-blur-md border-b border-border/40 flex items-center justify-between px-4 md:px-6 sticky top-0 z-30">
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink href="/">{t("nav.dashboard")}</BreadcrumbLink>
          </BreadcrumbItem>
          {breadcrumbs.map((crumb) => (
            <span key={crumb.href} className="contents">
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                {crumb.isLast ? (
                  <BreadcrumbPage>{crumb.label}</BreadcrumbPage>
                ) : (
                  <BreadcrumbLink href={crumb.href}>{crumb.label}</BreadcrumbLink>
                )}
              </BreadcrumbItem>
            </span>
          ))}
        </BreadcrumbList>
      </Breadcrumb>

      <div className="flex items-center gap-2">
        <div className="hidden md:block w-60">
          <TickerSearch />
        </div>
        <div className="h-6 w-px bg-border/40 hidden md:block" />
        <LocaleToggle />
        <ThemeToggle />
      </div>
    </header>
  );
}
