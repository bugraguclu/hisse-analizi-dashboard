"use client";

import { cn } from "@/lib/utils";
import { useWidgetI18n } from "./i18n";
import { isWidgetKey, type WidgetKey } from "./i18n-dict";
import type { OptionValue } from "./model";

function text(value: OptionValue | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

/** A heading widget's text: what the visitor typed, else its translated preset. */
export function headingLabel(options: Record<string, OptionValue> | undefined, t: (key: WidgetKey) => string): string {
  const presetKey = `heading.${text(options?.preset)}`;
  return text(options?.text) || (isWidgetKey(presetKey) ? t(presetKey) : "") || t("heading.placeholder");
}

/**
 * Section heading between rows of cards. Default layouts name a translated
 * preset (`preset: "monetary"`) and an anchor for in-page links; a heading the
 * visitor typed wins over the preset.
 */
export function HeadingWidget({ options }: { options: Record<string, OptionValue> }) {
  const { t } = useWidgetI18n();
  const label = headingLabel(options, t);
  const anchor = text(options.anchor);
  if (options.style === "caps") {
    return (
      <h2 id={anchor || undefined} className="scroll-mt-24 pt-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </h2>
    );
  }
  return (
    <h2 id={anchor || undefined} className="scroll-mt-24 pt-4 text-[15px] font-semibold tracking-tight text-foreground">
      {label}
    </h2>
  );
}

/** Free-text note card (the visitor's own reminders, targets, theses). */
export function NoteWidget({ options }: { options: Record<string, OptionValue> }) {
  const { t } = useWidgetI18n();
  const title = text(options.title) || t("note.title");
  const body = text(options.text);
  return (
    <section className="card-surface flex min-w-0 flex-col overflow-hidden">
      <header className="flex min-h-12 items-center border-b border-border px-4 py-2">
        <h2 className="min-w-0 truncate text-[13px] font-semibold leading-5 text-foreground">{title}</h2>
      </header>
      <div className={cn("grow whitespace-pre-wrap break-words p-4 text-[13px] leading-relaxed", body ? "text-foreground" : "text-muted-foreground")}>
        {body || t("note.empty")}
      </div>
    </section>
  );
}
