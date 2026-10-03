"use client";

import { useCallback, useMemo } from "react";
import { useQueries, useQuery, type UseQueryResult } from "@tanstack/react-query";
import { inflationQuery, marketHistoryQuery } from "@/components/makro/queries";
import type { ChartPeriod } from "@/types";
import type { ChartSeries, ChartUnit } from "./types";
import {
  convertSeries,
  effectiveUnit,
  isDerivedUnit,
  mergeRatePoints,
  parseCpiIndex,
  parseRatePoints,
  RATE_KEY,
  rateFactor,
  rateHistoryPeriods,
  realFactor,
  type RatePoint,
  type UnitFactor,
} from "./units";

export interface UnitConversion {
  /** The unit shown: the chosen one, or lira on a period it doesn't cover. */
  unit: ChartUnit;
  /** A derived unit's rates or CPI are still loading (the lira bars stand in meanwhile). */
  pending: boolean;
  /** A derived unit's rates or CPI failed: `convert` gives nothing until `retry` succeeds. */
  error: boolean;
  retry: () => void;
  /** A series fetched in lira, in `unit`; TRY/USD series and stand-ins pass through unchanged. Stable while the data is. */
  convert: (series: ChartSeries | undefined) => ChartSeries | undefined;
  /** Real lira: the CPI month the prices are expressed in ("2026-08"); null otherwise. */
  baseMonth: string | null;
}

interface RateState {
  points: RatePoint[];
  pending: boolean;
  error: boolean;
  refetch: () => void;
}

/** Module level, so `useQueries` keeps the result while the queries don't change. */
function combineRates(results: Array<UseQueryResult<RatePoint[]>>): RateState {
  const [newest, older] = results.length === 2 ? results : [undefined, results[0]];
  return {
    points: mergeRatePoints(newest?.data ?? [], older?.data ?? []),
    pending: results.some((result) => result.isPending),
    error: results.some((result) => result.isError),
    refetch: () => results.forEach((result) => void result.refetch()),
  };
}

/**
 * What a chart needs to show `chosen` on `period`: euros and gold read the macro page's
 * EUR/TRY and gram-gold histories (the same cache entries), real lira its CPI history.
 */
export function useUnitConversion(chosen: ChartUnit, period: ChartPeriod): UnitConversion {
  const unit = effectiveUnit(chosen, period);
  const rateKey = unit === "EUR" || unit === "GOLD" ? RATE_KEY[unit] : null;
  const rates = useQueries({
    queries: rateKey ? rateHistoryPeriods(period).map((history) => ({ ...marketHistoryQuery(rateKey, history), select: parseRatePoints })) : [],
    combine: combineRates,
  });
  const cpiQ = useQuery({ ...inflationQuery(), select: parseCpiIndex, enabled: unit === "REAL" });
  const cpi = cpiQ.data ?? null;

  const factor = useMemo<UnitFactor | null>(() => {
    if (rateKey) return rates.points.length > 0 ? rateFactor(rates.points) : null;
    if (unit === "REAL") return cpi ? realFactor(cpi) : null;
    return null;
  }, [rateKey, rates.points, unit, cpi]);

  const derived = isDerivedUnit(unit);
  const error = derived && factor === null && (rateKey ? rates.error : cpiQ.isError);
  const pending = derived && factor === null && !error;

  const convert = useCallback(
    (series: ChartSeries | undefined) => {
      // A dollar placeholder (unit just switched) stays labelled as what it is.
      if (!series || !isDerivedUnit(unit) || series.currency !== "TRY") return series;
      if (factor) return convertSeries(series, unit, factor);
      return error ? undefined : series;
    },
    [unit, factor, error],
  );

  const refetchRates = rates.refetch;
  const refetchCpi = cpiQ.refetch;
  const retry = useCallback(() => {
    refetchRates();
    if (unit === "REAL") void refetchCpi();
  }, [refetchRates, refetchCpi, unit]);

  return { unit, pending, error, retry, convert, baseMonth: unit === "REAL" ? (cpi?.latest ?? null) : null };
}
