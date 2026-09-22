"use client";

import { useLocale } from "@/lib/locale-context";
import { LOCALES, localeLabels, localeNames } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/** TR / EN / FR segmented switch; the choice persists in a cookie (see LocaleProvider). */
export function LocaleToggle({ className }: { className?: string }) {
  const { locale, setLocale, t } = useLocale();

  return (
    <div
      role="group"
      aria-label={t("shell.language")}
      className={cn("inline-flex h-8 shrink-0 items-center gap-0.5 rounded-full border border-border bg-background p-0.5", className)}
    >
      {LOCALES.map((l) => (
        <button
          type="button"
          key={l}
          lang={l}
          onClick={() => setLocale(l)}
          aria-pressed={locale === l}
          aria-label={localeNames[l]}
          title={localeNames[l]}
          className={cn(
            "h-6 min-w-8 rounded-full px-2 text-[11px] font-bold transition-colors",
            "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring",
            locale === l ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {localeLabels[l]}
        </button>
      ))}
    </div>
  );
}
