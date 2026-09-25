"use client";

import { useLocale } from "@/lib/locale-context";
import { LOCALES, localeLabels, localeNames } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/** TR / EN / FR switch; the choice persists in a cookie (see LocaleProvider). */
export function LocaleToggle({ className }: { className?: string }) {
  const { locale, setLocale, t } = useLocale();

  return (
    <div role="group" aria-label={t("shell.language")} className={cn("inline-flex h-8 shrink-0 items-center", className)}>
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
            "h-7 min-w-7 rounded-md px-1.5 font-mono text-[11px] font-medium transition-colors",
            "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring",
            locale === l ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {localeLabels[l]}
        </button>
      ))}
    </div>
  );
}
