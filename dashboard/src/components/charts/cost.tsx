"use client";

import { useCallback, useId, useState, useSyncExternalStore } from "react";
import { Wallet, X } from "lucide-react";
import { parseDecimal } from "@/components/tarama/model";
import { formatNumber } from "@/lib/format";
import { useChartI18n } from "./i18n";

/** The viewer's average cost per symbol, in lira, kept in this browser only. */
const listeners = new Set<() => void>();

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  window.addEventListener("storage", onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

export function useCostPref(symbol: string): [number | null, (cost: number | null) => void] {
  const key = `hisse.chart.cost.${symbol}`;
  const read = useCallback(() => {
    try {
      const raw = window.localStorage.getItem(key);
      const value = raw === null ? NaN : Number(raw);
      return Number.isFinite(value) && value > 0 ? value : null;
    } catch {
      return null;
    }
  }, [key]);
  const cost = useSyncExternalStore(subscribe, read, () => null);
  const write = useCallback(
    (next: number | null) => {
      try {
        if (next === null) window.localStorage.removeItem(key);
        else window.localStorage.setItem(key, String(next));
      } catch {
        // Storage blocked (private mode): the line simply isn't remembered.
      }
      listeners.forEach((listener) => listener());
    },
    [key],
  );
  return [cost, write];
}

/** Row under the toolbar: "Ortalama maliyetiniz (TL) [____] Kaydet · Kaldır". */
export function CostEditor({ cost, onSave, onClose }: { cost: number | null; onSave: (cost: number | null) => void; onClose: () => void }) {
  const { t } = useChartI18n();
  const inputId = useId();
  const [text, setText] = useState(cost !== null ? formatNumber(cost) : "");
  const [invalid, setInvalid] = useState(false);
  return (
    <form
      className="-mt-1 flex flex-wrap items-center gap-2 rounded-md border border-border px-2.5 py-1.5 text-[11px]"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          onClose();
        }
      }}
      onSubmit={(event) => {
        event.preventDefault();
        const value = parseDecimal(text);
        if (value === null || !(value > 0)) {
          setInvalid(true);
          return;
        }
        onSave(value);
        onClose();
      }}
    >
      <Wallet aria-hidden className="h-3.5 w-3.5 text-muted-foreground" />
      <label htmlFor={inputId} className="text-muted-foreground">
        {t("cost.prompt")}
      </label>
      <input
        id={inputId}
        autoFocus
        inputMode="decimal"
        autoComplete="off"
        value={text}
        aria-invalid={invalid || undefined}
        aria-describedby={invalid ? `${inputId}-error` : undefined}
        onChange={(event) => {
          setText(event.target.value);
          setInvalid(false);
        }}
        className="h-6 w-24 rounded-sm border border-border bg-transparent px-1.5 font-mono text-[12px] text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/60 aria-[invalid=true]:border-down"
      />
      <button type="submit" className="h-6 rounded-sm border border-border px-2 font-medium text-foreground hover:bg-muted">
        {t("cost.save")}
      </button>
      {cost !== null ? (
        <button
          type="button"
          onClick={() => {
            onSave(null);
            onClose();
          }}
          className="h-6 rounded-sm px-2 text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          {t("cost.clear")}
        </button>
      ) : null}
      {invalid ? (
        <span id={`${inputId}-error`} role="alert" className="text-[10px] text-down">
          {t("cost.invalid")}
        </span>
      ) : (
        <span className="text-[10px] text-muted-foreground">{t("cost.note")}</span>
      )}
      <button type="button" onClick={onClose} aria-label={t("cost.close")} className="ml-auto rounded-sm p-0.5 text-muted-foreground hover:text-foreground">
        <X className="h-3.5 w-3.5" />
      </button>
    </form>
  );
}
