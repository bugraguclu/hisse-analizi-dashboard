"use client";

import { useTheme } from "next-themes";
import { Moon, Sun } from "lucide-react";
import { useLocale } from "@/lib/locale-context";
import { cn } from "@/lib/utils";

/**
 * Light/dark switch. The visual state comes purely from the `.dark` class that
 * next-themes sets before first paint, so there is no hydration flash and no
 * "mounted" gate. The accessible name describes the action for both themes.
 */
export function ThemeToggle({ className }: { className?: string }) {
  const { resolvedTheme, setTheme } = useTheme();
  const { t } = useLocale();

  return (
    <button
      type="button"
      onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
      className={cn(
        "group relative inline-flex h-8 w-14 shrink-0 items-center rounded-full border p-0.5 transition-colors",
        "border-border bg-background hover:bg-muted/60",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        className,
      )}
    >
      <span className="sr-only dark:hidden">{t("theme.toDark")}</span>
      <span className="sr-only hidden dark:inline">{t("theme.toLight")}</span>
      <span
        aria-hidden="true"
        className="flex h-6 w-6 translate-x-0 items-center justify-center rounded-full bg-muted shadow-sm transition-transform duration-300 dark:translate-x-6"
      >
        <Sun className="h-3.5 w-3.5 text-amber-500 dark:hidden" strokeWidth={2} />
        <Moon className="hidden h-3.5 w-3.5 text-foreground dark:block" strokeWidth={2} />
      </span>
    </button>
  );
}
