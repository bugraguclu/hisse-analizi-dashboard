"use client";

import { useId, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatPrice } from "@/lib/format";
import { useLocale } from "@/lib/locale-context";
import {
  ALERT_KINDS,
  alertInputFromForm,
  type AlertDirection,
  type AlertFormError,
  type AlertFormValues,
  type AlertKind,
  type AlertRuleInput,
} from "@/lib/alerts/model";

const SELECT_CLASS =
  "h-8 w-full rounded-md border border-input bg-card px-2 text-base outline-none focus-visible:border-foreground/40 focus-visible:ring-2 focus-visible:ring-ring/25 md:text-[13px]";
const LABEL_CLASS = "text-xs font-medium text-foreground";

/**
 * One form for creating and editing alert rules (Alarmlar page and the stock page
 * quick action). Validation mirrors the API; errors are tied to their field.
 */
export function AlertRuleForm({
  initial,
  lockTicker = false,
  currentPrice = null,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial: AlertFormValues;
  lockTicker?: boolean;
  currentPrice?: number | null;
  submitLabel: string;
  onSubmit: (input: AlertRuleInput) => Promise<void>;
  onCancel?: () => void;
}) {
  const { t } = useLocale();
  const id = useId();
  const [values, setValues] = useState<AlertFormValues>(initial);
  const [error, setError] = useState<AlertFormError | null>(null);
  const [busy, setBusy] = useState(false);

  const set = <K extends keyof AlertFormValues>(key: K, value: AlertFormValues[K]) => {
    setValues((current) => ({ ...current, [key]: value }));
    setError(null);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const parsed = alertInputFromForm(values);
    if (!parsed.ok) {
      setError(parsed.error);
      document.getElementById(`${id}-${parsed.error === "ticker" ? "ticker" : "threshold"}`)?.focus();
      return;
    }
    setBusy(true);
    try {
      await onSubmit(parsed.input);
    } finally {
      setBusy(false);
    }
  };

  const isPrice = values.kind === "price_above" || values.kind === "price_below";
  const errorId = `${id}-error`;

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <label htmlFor={`${id}-ticker`} className={LABEL_CLASS}>
            {t("alerts.fieldTicker")}
          </label>
          <Input
            id={`${id}-ticker`}
            value={values.ticker}
            readOnly={lockTicker}
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
            maxLength={10}
            onChange={(event) => set("ticker", event.target.value.toUpperCase())}
            aria-invalid={error === "ticker" || undefined}
            aria-describedby={error === "ticker" ? errorId : undefined}
            className="font-mono uppercase"
          />
        </div>
        <div className="space-y-1">
          <label htmlFor={`${id}-kind`} className={LABEL_CLASS}>
            {t("alerts.fieldKind")}
          </label>
          <select id={`${id}-kind`} value={values.kind} onChange={(event) => set("kind", event.target.value as AlertKind)} className={SELECT_CLASS}>
            {ALERT_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {t(`alerts.kind.${kind}`)}
              </option>
            ))}
          </select>
        </div>
      </div>

      {values.kind !== "kap" ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <label htmlFor={`${id}-threshold`} className={LABEL_CLASS}>
              {isPrice ? t("alerts.fieldPrice") : t("alerts.fieldChange")}
            </label>
            <Input
              id={`${id}-threshold`}
              inputMode="decimal"
              autoComplete="off"
              value={values.threshold}
              onChange={(event) => set("threshold", event.target.value)}
              aria-invalid={error === "threshold-price" || error === "threshold-change" || undefined}
              aria-describedby={[error && error !== "ticker" ? errorId : null, isPrice ? `${id}-price-hint` : null].filter(Boolean).join(" ") || undefined}
              className="font-mono"
            />
            {isPrice ? (
              <p id={`${id}-price-hint`} className="text-[11px] leading-snug text-muted-foreground">
                {currentPrice !== null ? `${t("alerts.currentPrice", { price: formatPrice(currentPrice) })} ` : null}
                {t("alerts.crossingHint")}
              </p>
            ) : null}
          </div>
          {values.kind === "change_pct" ? (
            <div className="space-y-1">
              <label htmlFor={`${id}-direction`} className={LABEL_CLASS}>
                {t("alerts.fieldDirection")}
              </label>
              <select
                id={`${id}-direction`}
                value={values.direction}
                onChange={(event) => set("direction", event.target.value as AlertDirection)}
                className={SELECT_CLASS}
              >
                {(["both", "up", "down"] as const).map((direction) => (
                  <option key={direction} value={direction}>
                    {t(`alerts.direction.${direction}`)}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <div className="flex items-start gap-2 self-center pt-4 sm:pt-5">
              <input
                id={`${id}-rearm`}
                type="checkbox"
                checked={values.rearm}
                onChange={(event) => set("rearm", event.target.checked)}
                aria-describedby={`${id}-rearm-hint`}
                className="mt-0.5 h-4 w-4 accent-foreground"
              />
              <div>
                <label htmlFor={`${id}-rearm`} className="text-[13px] text-foreground">
                  {t("alerts.fieldRearm")}
                </label>
                <p id={`${id}-rearm-hint`} className="text-[11px] text-muted-foreground">
                  {t("alerts.rearmHint")}
                </p>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-1 sm:w-1/2 sm:pr-1.5">
          <label htmlFor={`${id}-severity`} className={LABEL_CLASS}>
            {t("alerts.fieldSeverity")}
          </label>
          <select
            id={`${id}-severity`}
            value={values.minSeverity}
            onChange={(event) => set("minSeverity", event.target.value as AlertFormValues["minSeverity"])}
            className={SELECT_CLASS}
          >
            {(["ALL", "WATCH", "HIGH"] as const).map((severity) => (
              <option key={severity} value={severity}>
                {t(`alerts.severity.${severity}`)}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="flex items-center gap-2">
        <input
          id={`${id}-enabled`}
          type="checkbox"
          checked={values.enabled}
          onChange={(event) => set("enabled", event.target.checked)}
          className="h-4 w-4 accent-foreground"
        />
        <label htmlFor={`${id}-enabled`} className="text-[13px] text-foreground">
          {t("alerts.fieldEnabled")}
        </label>
      </div>

      {error ? (
        <p id={errorId} role="alert" className="text-xs text-destructive">
          {t(`alerts.error.${error}`)}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={busy}>
          {submitLabel}
        </Button>
        {onCancel ? (
          <Button type="button" variant="outline" onClick={onCancel} disabled={busy}>
            {t("alerts.cancel")}
          </Button>
        ) : null}
      </div>
    </form>
  );
}
