"use client";

import { useLocale } from "@/lib/locale-context";
import { type Locale, localeLabels } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { Languages } from "lucide-react";

const locales: Locale[] = ["tr", "en", "fr"];

interface LocaleToggleProps {
  className?: string;
}

export function LocaleToggle({ className }: LocaleToggleProps) {
  const { locale, setLocale } = useLocale();

  return (
    <div
      className={cn(
        "flex items-center gap-0.5 h-8 px-1 rounded-full border transition-all duration-200",
        "bg-white dark:bg-zinc-950 border-zinc-200 dark:border-zinc-800",
        className,
      )}
    >
      <Languages className="w-3.5 h-3.5 text-muted-foreground ml-1 mr-0.5 flex-shrink-0" />
      {locales.map((l) => (
        <button
          key={l}
          onClick={() => setLocale(l)}
          className={cn(
            "px-2 py-1 rounded-full text-[10px] font-bold transition-all duration-200",
            locale === l
              ? "bg-primary text-primary-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {localeLabels[l]}
        </button>
      ))}
    </div>
  );
}
