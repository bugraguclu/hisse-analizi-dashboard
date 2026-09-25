import { monthEnd, monthKey } from "./format";
import type { InflationRow, PolicyRateChange } from "./types";

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** "2026-08" + n months → "YYYY-MM". */
export function addMonths(key: string, n: number): string {
  const [y, m] = key.split("-").map(Number);
  const index = y * 12 + (m - 1) + n;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
}

export interface MonthlyInflation {
  month: string;
  yearly: number | null;
  monthly: number | null;
}

/** Oldest-first monthly series from the newest-first TÜFE/ÜFE rows (one row per month). */
export function inflationSeries(rows: readonly InflationRow[] | undefined): MonthlyInflation[] {
  const byMonth = new Map<string, MonthlyInflation>();
  for (const row of rows ?? []) {
    const month = monthKey(row.Date);
    if (!month || byMonth.has(month)) continue;
    byMonth.set(month, { month, yearly: finite(row.YearlyInflation), monthly: finite(row.MonthlyInflation) });
  }
  return [...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month));
}

/** Policy rate in force on `day` ("YYYY-MM-DD"); `changes` ascending by effective date. */
export function policyAt(changes: readonly PolicyRateChange[], day: string): number | null {
  let rate: number | null = null;
  for (const change of changes) {
    if (change.date > day) break;
    rate = change.rate;
  }
  return rate;
}

export interface PolicyInflationPoint {
  month: string;
  policy: number | null;
  cpi: number | null;
  /** Ex-post real rate: policy − annual CPI, percentage points. */
  real: number | null;
}

/**
 * Month-end policy rate next to annual CPI, from the first policy-rate month up
 * to the current month (the current month uses today's rate; its CPI is usually
 * not released yet, so the CPI line stops a month earlier).
 */
export function policyInflationSeries(
  changes: readonly PolicyRateChange[] | undefined,
  cpi: readonly MonthlyInflation[],
  today: string,
): PolicyInflationPoint[] {
  const ordered = [...(changes ?? [])].filter((c) => c.date && Number.isFinite(c.rate)).sort((a, b) => a.date.localeCompare(b.date));
  if (ordered.length === 0) return [];
  const cpiByMonth = new Map(cpi.map((row) => [row.month, row.yearly]));
  const first = monthKey(ordered[0].date);
  const todayMonth = monthKey(today);
  const lastCpiMonth = cpi.length > 0 ? cpi[cpi.length - 1].month : null;
  if (!first || !todayMonth) return [];
  const last = lastCpiMonth && lastCpiMonth > todayMonth ? lastCpiMonth : todayMonth;

  const points: PolicyInflationPoint[] = [];
  for (let month = first; month <= last; month = addMonths(month, 1)) {
    const day = month === todayMonth ? today : monthEnd(month);
    const policy = policyAt(ordered, day);
    const inflation = cpiByMonth.get(month) ?? null;
    points.push({
      month,
      policy,
      cpi: inflation,
      real: policy !== null && inflation !== null ? round2(policy - inflation) : null,
    });
  }
  return points;
}

/** Keep the last `months` + 1 points (same month a year earlier included); null keeps everything. */
export function lastMonths<T extends { month: string }>(points: readonly T[], months: number | null): T[] {
  if (months === null || points.length === 0) return [...points];
  const cutoff = addMonths(points[points.length - 1].month, -months);
  return points.filter((point) => point.month >= cutoff);
}
