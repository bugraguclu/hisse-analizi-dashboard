"use client";

import { useTheme } from "next-themes";
import { Moon, Sun } from "lucide-react";
import { useLocale } from "@/lib/locale-context";
import { cn } from "@/lib/utils";

/**
 * Light/dark switch. The icon comes purely from the `.dark` class that
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
        "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors",
        "hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring",
        className,
      )}
    >
      <span className="sr-only dark:hidden">{t("theme.toDark")}</span>
      <span className="sr-only hidden dark:inline">{t("theme.toLight")}</span>
      <Moon aria-hidden="true" className="h-4 w-4 dark:hidden" strokeWidth={1.75} />
      <Sun aria-hidden="true" className="hidden h-4 w-4 dark:block" strokeWidth={1.75} />
    </button>
  );
}
