"use client";

import { useState, type ReactNode } from "react";
import { Popover } from "@base-ui/react/popover";
import { Eye, EyeOff, Minus, Plus, RotateCcw, Trash2 } from "lucide-react";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import { SERIES_CSS_VAR } from "./colors";
import { POPUP_CLASS, ToolButton } from "./controls";
import { useChartI18n } from "./i18n";
import { defaultParams, sanitizeParams } from "./indicator-catalog";
import type { IndicatorParamSpec } from "./indicator-types";
import { localize, type IndicatorView } from "./indicator-view";
import type { IndicatorConfig } from "./types";

function decimalsOf(step: number): number {
  const text = String(step);
  const dot = text.indexOf(".");
  return dot < 0 ? 0 : text.length - dot - 1;
}

function ParamField({ spec, value, onChange, label }: { spec: IndicatorParamSpec; value: number; onChange: (next: number) => void; label: string }) {
  const decimals = decimalsOf(spec.step);
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? formatNumber(value, decimals);
  const commit = (text: string) => {
    const parsed = Number(text.replace(/\s/g, "").replace(",", "."));
    setDraft(null);
    if (Number.isFinite(parsed)) onChange(parsed);
  };
  const step = (direction: 1 | -1) => onChange(Number((value + direction * spec.step).toFixed(decimals)));
  return (
    <label className="flex items-center justify-between gap-3">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="inline-flex items-center rounded-md border border-border">
        <button
          type="button"
          tabIndex={-1}
          aria-hidden
          disabled={value <= spec.min}
          onClick={() => step(-1)}
          className="inline-flex h-7 w-6 items-center justify-center text-muted-foreground hover:text-foreground disabled:opacity-40"
        >
          <Minus className="h-3 w-3" />
        </button>
        <input
          inputMode={decimals > 0 ? "decimal" : "numeric"}
          value={shown}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={(event) => commit(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") commit(event.currentTarget.value);
            else if (event.key === "ArrowUp") {
              event.preventDefault();
              step(1);
            } else if (event.key === "ArrowDown") {
              event.preventDefault();
              step(-1);
            }
          }}
          aria-label={label}
          className="h-7 w-14 bg-transparent text-center font-mono text-xs tabular-nums text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
        />
        <button
          type="button"
          tabIndex={-1}
          aria-hidden
          disabled={value >= spec.max}
          onClick={() => step(1)}
          className="inline-flex h-7 w-6 items-center justify-center text-muted-foreground hover:text-foreground disabled:opacity-40"
        >
          <Plus className="h-3 w-3" />
        </button>
      </span>
    </label>
  );
}

/**
 * Settings of one indicator instance (TradingView's "gear"): parameters apply
 * live, then colour, visibility, defaults and removal.
 */
export function IndicatorSettingsPanel({
  view,
  onChange,
  onRemove,
}: {
  view: IndicatorView;
  onChange: (next: IndicatorConfig) => void;
  onRemove: () => void;
}) {
  const { t, locale } = useChartI18n();
  const { config, def } = view;
  const setParam = (key: string, value: number) =>
    onChange({ ...config, params: sanitizeParams(config.kind, { ...config.params, [key]: value }) });
  return (
    <div className="w-64 space-y-3 p-3">
      <div>
        <p className="text-[13px] font-semibold text-foreground">{localize(def.name, locale)}</p>
        <p className="mt-0.5 text-[11px] leading-4 text-muted-foreground">{localize(def.description, locale)}</p>
      </div>
      {def.params.length > 0 ? (
        <div className="space-y-2">
          {def.params.map((spec) => (
            <ParamField
              key={spec.key}
              spec={spec}
              label={localize(spec.label, locale) ?? spec.key}
              value={config.params[spec.key] ?? spec.default}
              onChange={(value) => setParam(spec.key, value)}
            />
          ))}
        </div>
      ) : null}
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs text-muted-foreground">{t("ind.color")}</span>
        <span role="radiogroup" aria-label={t("ind.color")} className="flex items-center gap-1.5">
          {SERIES_CSS_VAR.map((color, slot) => (
            <button
              key={color}
              type="button"
              role="radio"
              aria-checked={config.color === slot}
              aria-label={`${t("ind.color")} ${slot + 1}`}
              onClick={() => onChange({ ...config, color: slot })}
              className={cn(
                "h-4 w-4 rounded-[3px] outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
                config.color === slot ? "ring-2 ring-foreground/70 ring-offset-1 ring-offset-popover" : "hover:ring-1 hover:ring-border",
              )}
              style={{ background: color }}
            />
          ))}
        </span>
      </div>
      <div className="flex items-center gap-1 border-t border-border pt-2">
        <ToolButton label={config.hidden ? t("ind.show") : t("ind.hide")} onClick={() => onChange({ ...config, hidden: !config.hidden })}>
          {config.hidden ? <EyeOff /> : <Eye />}
        </ToolButton>
        <ToolButton
          label={t("ind.defaults")}
          onClick={() => onChange({ ...config, params: defaultParams(config.kind) })}
        >
          <RotateCcw />
        </ToolButton>
        <button
          type="button"
          onClick={onRemove}
          className="ml-auto inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-[11px] font-medium text-down outline-none hover:bg-down/10 focus-visible:ring-2 focus-visible:ring-ring/60"
        >
          <Trash2 className="h-3.5 w-3.5" />
          {t("ind.remove")}
        </button>
      </div>
    </div>
  );
}

/** A trigger (legend label) that opens the indicator's settings. */
export function IndicatorSettingsPopover({
  view,
  onChange,
  onRemove,
  children,
  triggerClassName,
}: {
  view: IndicatorView;
  onChange: (next: IndicatorConfig) => void;
  onRemove: () => void;
  children: ReactNode;
  triggerClassName?: string;
}) {
  const { t } = useChartI18n();
  const [open, setOpen] = useState(false);
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        aria-label={t("ind.settings", { name: view.label })}
        title={t("ind.settings", { name: view.label })}
        className={cn(
          "inline-flex items-baseline gap-1 rounded-sm px-0.5 outline-none hover:bg-muted/70 focus-visible:ring-2 focus-visible:ring-ring/60 data-[popup-open]:bg-muted",
          triggerClassName,
        )}
      >
        {children}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="bottom" align="start" sideOffset={6} collisionPadding={12} className="z-[90]">
          <Popover.Popup className={POPUP_CLASS}>
            <IndicatorSettingsPanel
              view={view}
              onChange={onChange}
              onRemove={() => {
                setOpen(false);
                onRemove();
              }}
            />
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
