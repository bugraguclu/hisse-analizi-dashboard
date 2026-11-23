/**
 * Alert rule types (mirror of src/schemas/alerts.py) and pure form helpers.
 */

export type AlertKind = "price_above" | "price_below" | "change_pct" | "kap";
export type AlertRepeat = "once" | "rearm";
export type AlertDirection = "up" | "down" | "both";
export type AlertSeverity = "INFO" | "WATCH" | "HIGH";
export type AlertState = "active" | "pending" | "armed" | "waiting_reset" | "cooldown" | "done" | "disabled";

export const ALERT_KINDS: readonly AlertKind[] = ["price_above", "price_below", "change_pct", "kap"];

export interface AlertRule {
  id: string;
  ticker: string;
  company_name?: string | null;
  kind: AlertKind;
  threshold: number | null;
  direction: AlertDirection | null;
  repeat: AlertRepeat;
  hysteresis_pct: number;
  min_severity: AlertSeverity | null;
  enabled: boolean;
  state: AlertState;
  trigger_count: number;
  last_triggered_at: string | null;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface AlertDelivery {
  id: string;
  rule_id: string | null;
  kind: string;
  ticker: string | null;
  title: string;
  body: string;
  url: string;
  status: "pending" | "processing" | "sent" | "failed" | "skipped";
  sent_count: number;
  created_at: string;
  sent_at: string | null;
}

/** Body of POST /me/alerts and PUT /me/alerts/{id} (without `id`/`version`). */
export interface AlertRuleInput {
  ticker: string;
  kind: AlertKind;
  threshold: number | null;
  direction: AlertDirection | null;
  repeat: AlertRepeat;
  hysteresis_pct: number;
  min_severity: AlertSeverity | null;
  enabled: boolean;
}

export interface AlertFormValues {
  ticker: string;
  kind: AlertKind;
  /** Raw text from the input: Turkish users type "312,50". */
  threshold: string;
  direction: AlertDirection;
  rearm: boolean;
  minSeverity: AlertSeverity | "ALL";
  enabled: boolean;
}

export type AlertFormError = "ticker" | "threshold-price" | "threshold-change";

const TICKER_RE = /^[A-Z0-9]{2,10}$/;

/** "1.234,50" / "1234.5" / "1 234,5" → number; null when it is not a plain decimal. */
export function parseDecimalInput(raw: string): number | null {
  const compact = raw.trim().replace(/[\s ]/g, "");
  if (!compact) return null;
  let normalized = compact;
  if (compact.includes(",")) normalized = compact.replace(/\./g, "").replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(normalized)) return null;
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

export function emptyAlertForm(ticker = "", kind: AlertKind = "price_above"): AlertFormValues {
  return { ticker, kind, threshold: "", direction: "both", rearm: false, minSeverity: "ALL", enabled: true };
}

export function formFromRule(rule: AlertRule, decimalComma = true): AlertFormValues {
  const threshold = rule.threshold === null ? "" : decimalComma ? String(rule.threshold).replace(".", ",") : String(rule.threshold);
  return {
    ticker: rule.ticker,
    kind: rule.kind,
    threshold,
    direction: rule.direction ?? "both",
    rearm: rule.repeat === "rearm",
    minSeverity: rule.min_severity ?? "ALL",
    enabled: rule.enabled,
  };
}

/** Validated API body, or the first field error (the server validates again). */
export function alertInputFromForm(values: AlertFormValues): { ok: true; input: AlertRuleInput } | { ok: false; error: AlertFormError } {
  const ticker = values.ticker.trim().toLocaleUpperCase("tr-TR").replace(/İ/g, "I");
  if (!TICKER_RE.test(ticker)) return { ok: false, error: "ticker" };
  const base = { ticker, kind: values.kind, hysteresis_pct: 1, enabled: values.enabled };
  if (values.kind === "price_above" || values.kind === "price_below") {
    const threshold = parseDecimalInput(values.threshold);
    if (threshold === null || threshold <= 0 || threshold >= 1_000_000) return { ok: false, error: "threshold-price" };
    return {
      ok: true,
      input: { ...base, threshold, direction: null, repeat: values.rearm ? "rearm" : "once", min_severity: null },
    };
  }
  if (values.kind === "change_pct") {
    const threshold = parseDecimalInput(values.threshold);
    if (threshold === null || threshold < 0.1 || threshold > 50) return { ok: false, error: "threshold-change" };
    return { ok: true, input: { ...base, threshold, direction: values.direction, repeat: "rearm", min_severity: null } };
  }
  return {
    ok: true,
    input: {
      ...base,
      threshold: null,
      direction: null,
      repeat: "rearm",
      min_severity: values.minSeverity === "ALL" ? null : values.minSeverity,
    },
  };
}

/** Optimistic local copy of a rule before the server has answered (offline creation/edit). */
export function provisionalRule(id: string, input: AlertRuleInput, previous: AlertRule | null, nowIso: string): AlertRule {
  return {
    id,
    ticker: input.ticker,
    company_name: previous?.ticker === input.ticker ? previous.company_name ?? null : null,
    kind: input.kind,
    threshold: input.threshold,
    direction: input.direction,
    repeat: input.repeat,
    hysteresis_pct: input.hysteresis_pct,
    min_severity: input.min_severity,
    enabled: input.enabled,
    state: !input.enabled ? "disabled" : input.kind === "kap" || input.kind === "change_pct" ? "active" : "pending",
    trigger_count: 0,
    last_triggered_at: null,
    version: previous?.version ?? 0,
    created_at: previous?.created_at ?? nowIso,
    updated_at: nowIso,
  };
}
