import { useMemo } from "react";
import { mobileApi } from "./api";
import type { ScreenerStockRow } from "./screener";
import { useResource } from "./useResource";

/**
 * The screener universe doubles as the app's quote board: one request gives the
 * last price, daily change and liquidity for every BIST share.
 */
export function useMarketUniverse(enabled = true) {
  const resource = useResource({
    key: "screener:universe",
    cacheKey: "screener_universe",
    enabled,
    fetcher: (signal) => mobileApi.screenerUniverse(signal),
    isEmpty: (data) => !data.rows || data.rows.length === 0,
  });

  const bySymbol = useMemo(() => {
    const map = new Map<string, ScreenerStockRow>();
    for (const row of (resource.data?.rows ?? []) as ScreenerStockRow[]) map.set(row.symbol, row);
    return map;
  }, [resource.data?.rows]);

  return { ...resource, bySymbol };
}

export interface MarketMovers {
  gainers: ScreenerStockRow[];
  losers: ScreenerStockRow[];
  active: ScreenerStockRow[];
  breadth: { up: number; down: number; flat: number };
}

/** Liquidity floor keeps thinly traded names out of the movers lists. */
const MIN_TURNOVER_TRY = 20_000_000;

export function computeMovers(rows: readonly ScreenerStockRow[], limit = 5): MarketMovers {
  const priced = rows.filter(
    (r) => typeof r.change_pct === "number" && Number.isFinite(r.change_pct) && typeof r.close === "number",
  );
  const liquid = priced.filter((r) => (r.turnover ?? r.avg_turnover ?? 0) >= MIN_TURNOVER_TRY);
  const pool = liquid.length >= limit * 2 ? liquid : priced;
  const byChange = [...pool].sort((a, b) => (b.change_pct ?? 0) - (a.change_pct ?? 0));
  const active = [...priced]
    .filter((r) => typeof r.turnover === "number")
    .sort((a, b) => (b.turnover ?? 0) - (a.turnover ?? 0));
  let up = 0;
  let down = 0;
  let flat = 0;
  for (const r of priced) {
    const c = r.change_pct ?? 0;
    if (c > 0.005) up += 1;
    else if (c < -0.005) down += 1;
    else flat += 1;
  }
  return {
    gainers: byChange.slice(0, limit),
    losers: byChange.slice(-limit).reverse(),
    active: active.slice(0, limit),
    breadth: { up, down, flat },
  };
}
