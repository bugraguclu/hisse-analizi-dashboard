"use client";

import { Fragment, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Menu, Search, X } from "lucide-react";
import { TickerSearch } from "@/components/shared/TickerSearch";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { LocaleToggle } from "@/components/ui/locale-toggle";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
  BreadcrumbText,
} from "@/components/ui/breadcrumb";
import { useLocale } from "@/lib/locale-context";
import { SECTION_LABELS, SECTIONS_WITH_INDEX } from "./nav";
import { useShell } from "./shell-context";

const APP_NAME = "Hisse Analizi";

interface Crumb {
  key: string;
  label: string;
  /** Null when the segment has no page of its own (e.g. /hisse without a ticker). */
  href: string | null;
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function TopBar() {
  const pathname = usePathname();
  const { t } = useLocale();
  const { openMobileNav, mobileNavOpen, mobileNavTriggerRef } = useShell();
  // Mobile search row, scoped to the page it was opened on (closes on navigation).
  const [searchOpenOn, setSearchOpenOn] = useState<string | null>(null);
  const mobileSearchOpen = searchOpenOn === pathname;

  const segments = pathname.split("/").filter(Boolean);
  const knownSection = segments.length === 0 || segments[0] in SECTION_LABELS;
  const crumbs: Crumb[] = knownSection
    ? segments.map((segment, index) => {
        const labelKey = index === 0 ? SECTION_LABELS[segment] : undefined;
        const isSectionWithoutIndex = index === 0 && !SECTIONS_WITH_INDEX.has(segment);
        return {
          key: segments.slice(0, index + 1).join("/"),
          label: labelKey ? t(labelKey) : safeDecode(segment).toUpperCase(),
          href: isSectionWithoutIndex ? null : `/${segments.slice(0, index + 1).join("/")}`,
        };
      })
    : [{ key: "not-found", label: t("notFound.title"), href: null }];
  const homeLabel = t("nav.dashboard");
  const current = crumbs.at(-1);
  const section = crumbs.length > 1 ? crumbs[0].label : null;

  // Client-rendered pages cannot export metadata; keep the tab title in sync here.
  const titleParts = current ? [current.label, section, APP_NAME] : [t("dashboard.marketOverview"), APP_NAME];
  const documentTitle = titleParts.filter((part, i, all): part is string => !!part && all.indexOf(part) === i).join(" · ");
  useEffect(() => {
    document.title = documentTitle;
  }, [documentTitle]);

  return (
    <header className="sticky top-0 z-30 border-b border-border/40 bg-card/80 backdrop-blur-md supports-[backdrop-filter]:bg-card/60">
      <div className="flex h-14 items-center gap-2 px-3 md:px-6">
        {/* Mobile: menu + current page title */}
        <button
          ref={mobileNavTriggerRef}
          type="button"
          onClick={openMobileNav}
          aria-label={t("shell.openMenu")}
          aria-expanded={mobileNavOpen}
          aria-controls="mobile-navigation"
          className="-ml-1 rounded-lg p-2 text-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring md:hidden"
        >
          <Menu className="h-5 w-5" aria-hidden="true" />
        </button>
        <p className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground md:hidden">
          {current ? (
            <>
              {section && <span className="font-normal text-muted-foreground">{section} · </span>}
              {current.label}
            </>
          ) : (
            homeLabel
          )}
        </p>

        {/* Desktop: breadcrumbs */}
        <Breadcrumb aria-label={t("shell.breadcrumb")} className="hidden min-w-0 flex-1 md:block">
          <BreadcrumbList>
            <BreadcrumbItem>
              {crumbs.length === 0 ? <BreadcrumbPage>{homeLabel}</BreadcrumbPage> : <BreadcrumbLink href="/">{homeLabel}</BreadcrumbLink>}
            </BreadcrumbItem>
            {crumbs.map((crumb, index) => (
              <Fragment key={crumb.key}>
                <BreadcrumbSeparator />
                <BreadcrumbItem>
                  {index === crumbs.length - 1 ? (
                    <BreadcrumbPage>{crumb.label}</BreadcrumbPage>
                  ) : crumb.href ? (
                    <BreadcrumbLink href={crumb.href}>{crumb.label}</BreadcrumbLink>
                  ) : (
                    <BreadcrumbText>{crumb.label}</BreadcrumbText>
                  )}
                </BreadcrumbItem>
              </Fragment>
            ))}
          </BreadcrumbList>
        </Breadcrumb>

        <div className="flex shrink-0 items-center gap-2">
          <div className="hidden w-60 md:block lg:w-72">
            <TickerSearch hotkey />
          </div>
          <button
            type="button"
            onClick={() => setSearchOpenOn(mobileSearchOpen ? null : pathname)}
            aria-label={mobileSearchOpen ? t("shell.closeSearch") : t("shell.openSearch")}
            aria-expanded={mobileSearchOpen}
            className="rounded-lg p-2 text-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring md:hidden"
          >
            {mobileSearchOpen ? <X className="h-5 w-5" aria-hidden="true" /> : <Search className="h-5 w-5" aria-hidden="true" />}
          </button>
          <div className="hidden h-6 w-px bg-border/60 md:block" aria-hidden="true" />
          <LocaleToggle className="hidden md:inline-flex" />
          <ThemeToggle className="hidden md:inline-flex" />
        </div>
      </div>

      {mobileSearchOpen && (
        <div className="border-t border-border/40 px-3 py-2 md:hidden">
          <TickerSearch autoFocus />
        </div>
      )}
    </header>
  );
}
