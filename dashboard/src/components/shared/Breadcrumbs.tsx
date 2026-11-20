"use client";

import Link from "next/link";
import { useLocale } from "@/lib/locale-context";
import { cn } from "@/lib/utils";

export interface BreadcrumbItem {
  label: string;
  href: string;
}

/**
 * Semantic breadcrumb trail (<nav> + <ol> + <Link aria-current="page">).
 * Separators are generated via CSS with empty alt text so screen readers do
 * not announce slashes.
 */
export function Breadcrumbs({
  items,
  className,
}: {
  items: readonly BreadcrumbItem[];
  className?: string;
}) {
  const { t } = useLocale();
  if (items.length === 0) return null;

  return (
    <nav aria-label={t("shell.breadcrumb")} className={cn("breadcrumb-nav text-xs text-muted-foreground", className)}>
      <ol>
        {items.map((item, index) => {
          const isCurrent = index === items.length - 1;
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={isCurrent ? "page" : undefined}
                className={cn(
                  "rounded-sm underline-offset-[3px] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                  isCurrent
                    ? "font-medium text-foreground"
                    : "text-muted-foreground hover:text-foreground hover:underline",
                )}
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
