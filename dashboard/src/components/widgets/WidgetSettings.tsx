"use client";

import { useId, useState } from "react";
import { Dialog } from "@base-ui/react/dialog";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { cn } from "@/lib/utils";
import { resolveOptions, type WidgetMeta } from "./catalog";
import { useWidgetI18n } from "./i18n";
import type { OptionValue, WidgetInstance } from "./model";
import { TickerPicker } from "./TickerPicker";

export interface WidgetSettingsPatch {
  ticker: string | null;
  options: Record<string, OptionValue | null>;
}

const FIELD_LABEL = "text-[11px] font-medium uppercase tracking-wider text-muted-foreground";
const INPUT =
  "w-full rounded-md border border-input bg-background px-3 text-[13px] text-foreground outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30";

/**
 * A widget's settings: the stock it follows (custom pages) and its own
 * options (view, compact, text…). Edits are a draft until Save.
 */
export function WidgetSettingsDialog({
  widget,
  meta,
  pageTicker,
  tickerOverrides,
  onSave,
  onClose,
}: {
  widget: WidgetInstance | null;
  meta: WidgetMeta | undefined;
  pageTicker: string;
  tickerOverrides: boolean;
  onSave: (patch: WidgetSettingsPatch) => void;
  onClose: () => void;
}) {
  const open = widget !== null && meta !== undefined;
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/40 transition-opacity duration-200 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0" />
        <Dialog.Popup className="fixed left-1/2 top-[12vh] z-50 w-[min(28rem,calc(100vw-2rem))] -translate-x-1/2 rounded-xl border border-border bg-card text-foreground shadow-[0_24px_64px_-24px_rgb(0_0_0/0.5)] outline-none transition-[opacity,scale] duration-150 data-[ending-style]:scale-95 data-[ending-style]:opacity-0 data-[starting-style]:scale-95 data-[starting-style]:opacity-0">
          {open ? (
            <SettingsForm
              key={widget.id}
              widget={widget}
              meta={meta}
              pageTicker={pageTicker}
              tickerOverrides={tickerOverrides}
              onSave={(patch) => {
                onSave(patch);
                onClose();
              }}
              onCancel={onClose}
            />
          ) : null}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function SettingsForm({
  widget,
  meta,
  pageTicker,
  tickerOverrides,
  onSave,
  onCancel,
}: {
  widget: WidgetInstance;
  meta: WidgetMeta;
  pageTicker: string;
  tickerOverrides: boolean;
  onSave: (patch: WidgetSettingsPatch) => void;
  onCancel: () => void;
}) {
  const { t } = useWidgetI18n();
  const baseId = useId();
  const [ticker, setTicker] = useState<string | null>(widget.ticker ?? null);
  const [options, setOptions] = useState(() => resolveOptions(meta, widget.options));
  const name = t(meta.name);
  const showTicker = meta.stock && tickerOverrides;
  const fields = meta.options ?? [];

  const submit = () => {
    const patch: Record<string, OptionValue | null> = {};
    for (const field of fields) {
      const value = options[field.key];
      // Defaults and empty text aren't stored.
      const isDefault = field.kind === "text" ? value === "" : value === field.default;
      patch[field.key] = isDefault ? null : value;
    }
    onSave({ ticker, options: patch });
  };

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <div className="flex items-center gap-2 border-b border-border py-2 pl-5 pr-2">
        <Dialog.Title className="min-w-0 grow truncate text-[15px] font-semibold">{t("widget.settingsTitle", { name })}</Dialog.Title>
        <Dialog.Close
          aria-label={t("settings.close")}
          className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
        >
          <X aria-hidden className="size-4" />
        </Dialog.Close>
      </div>

      <div className="space-y-5 px-5 py-4">
        {showTicker ? (
          <fieldset className="space-y-2">
            <legend className={FIELD_LABEL}>{t("settings.ticker")}</legend>
            <SegmentedControl
              label={t("settings.ticker")}
              size="sm"
              value={ticker === null ? "page" : "own"}
              onChange={(value) => setTicker(value === "page" ? null : (ticker ?? pageTicker))}
              options={[
                { value: "page", label: t("settings.tickerPage", { ticker: pageTicker }) },
                { value: "own", label: t("settings.tickerPick") },
              ]}
            />
            {ticker !== null ? (
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <TickerPicker value={ticker} onChange={setTicker} label={t("settings.tickerPick")} />
                <p className="text-xs text-muted-foreground">{t("settings.tickerHint")}</p>
              </div>
            ) : null}
          </fieldset>
        ) : null}

        {fields.map((field) => {
          const id = `${baseId}-${field.key}`;
          if (field.kind === "select") {
            return (
              <fieldset key={field.key} className="space-y-2">
                <legend className={FIELD_LABEL}>{t(field.label)}</legend>
                <SegmentedControl
                  label={t(field.label)}
                  size="sm"
                  value={String(options[field.key])}
                  onChange={(value) => setOptions((current) => ({ ...current, [field.key]: value }))}
                  options={field.choices.map((choice) => ({ value: choice.value, label: t(choice.label) }))}
                />
              </fieldset>
            );
          }
          if (field.kind === "toggle") {
            return (
              <label key={field.key} htmlFor={id} className="flex cursor-pointer items-center gap-2.5 text-[13px]">
                <input
                  id={id}
                  type="checkbox"
                  checked={options[field.key] === true}
                  onChange={(event) => setOptions((current) => ({ ...current, [field.key]: event.target.checked }))}
                  className="size-4 accent-foreground"
                />
                {t(field.label)}
              </label>
            );
          }
          const value = String(options[field.key] ?? "");
          const placeholder = field.placeholder ? t(field.placeholder) : undefined;
          return (
            <div key={field.key} className="space-y-2">
              <label htmlFor={id} className={cn(FIELD_LABEL, "block")}>
                {t(field.label)}
              </label>
              {field.multiline ? (
                <textarea
                  id={id}
                  rows={6}
                  maxLength={field.maxLength}
                  value={value}
                  placeholder={placeholder}
                  onChange={(event) => setOptions((current) => ({ ...current, [field.key]: event.target.value }))}
                  className={cn(INPUT, "min-h-28 resize-y py-2 leading-relaxed")}
                />
              ) : (
                <input
                  id={id}
                  type="text"
                  maxLength={field.maxLength}
                  value={value}
                  placeholder={placeholder}
                  onChange={(event) => setOptions((current) => ({ ...current, [field.key]: event.target.value }))}
                  className={cn(INPUT, "h-9")}
                />
              )}
            </div>
          );
        })}

        {!showTicker && fields.length === 0 ? <p className="text-[13px] text-muted-foreground">{t("settings.none")}</p> : null}
      </div>

      <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
        <Button variant="outline" onClick={onCancel}>
          {t("pages.cancel")}
        </Button>
        <Button type="submit">{t("pages.save")}</Button>
      </div>
    </form>
  );
}
