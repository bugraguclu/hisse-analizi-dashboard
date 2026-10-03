/** Query parameter that opens one instrument's chart in the markets section: `/makro?piyasa=usdtry`. */
export const MARKET_PARAM = "piyasa";

/** Link to an instrument's chart on /makro (the market strip links there). */
export function marketHref(key: string): string {
  return `/makro?${MARKET_PARAM}=${encodeURIComponent(key)}`;
}
