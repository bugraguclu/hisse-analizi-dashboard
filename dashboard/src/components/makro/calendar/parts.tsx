"use client";

import { cn } from "@/lib/utils";
import type { Locale } from "@/lib/i18n";
import { countryLabel, IMPORTANCE_LABELS } from "./i18n";
import type { Importance } from "./types";
import { highlightSegments } from "./utils";

/** Importance reads as a word in its token colour, plus a 2px rule at the row edge (site convention). */
export const IMPORTANCE_TEXT: Record<Importance, string> = {
  high: "text-destructive",
  mid: "text-warn",
  low: "text-muted-foreground",
};

export const IMPORTANCE_RULE: Record<Importance, string | null> = {
  high: "bg-destructive",
  mid: "bg-warn",
  low: null,
};

/** 2px mark in the importance colour — the row-edge rule in miniature (low gets a neutral one). */
export function ImportanceMarker({ level, className }: { level: Importance; className?: string }) {
  return <span aria-hidden="true" className={cn("inline-block h-3 w-0.5 shrink-0", IMPORTANCE_RULE[level] ?? "bg-muted-foreground/40", className)} />;
}

export function ImportanceText({ level, locale, className }: { level: Importance; locale: Locale; className?: string }) {
  return (
    <span className={cn("whitespace-nowrap text-[11px] font-medium", IMPORTANCE_TEXT[level], className)}>
      {IMPORTANCE_LABELS[level][locale]}
    </span>
  );
}

export function Highlight({ text, terms }: { text: string; terms: string[] }) {
  if (terms.length === 0) return <>{text}</>;
  return (
    <>
      {highlightSegments(text, terms).map((segment, i) =>
        segment.match ? (
          <mark key={i} className="rounded-[2px] bg-warn/25 text-inherit">
            {segment.text}
          </mark>
        ) : (
          <span key={i}>{segment.text}</span>
        ),
      )}
    </>
  );
}

export function CountryCodeBadge({ code, className }: { code: string; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex h-4 min-w-[1.5rem] shrink-0 items-center justify-center rounded-sm border border-border bg-muted/60 px-1 font-mono text-[10px] font-medium uppercase leading-none tracking-wider text-foreground",
        className,
      )}
    >
      {code}
    </span>
  );
}

export function Flag({
  code,
  locale,
  fallback,
  withName = false,
  className,
}: {
  code: string;
  locale: Locale;
  fallback?: string;
  withName?: boolean;
  className?: string;
}) {
  const name = countryLabel(code, locale, fallback);
  return (
    <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap", className)} title={name}>
      <CountryCodeBadge code={code} />
      {withName ? <span>{name}</span> : <span className="sr-only">{name}</span>}
    </span>
  );
}
