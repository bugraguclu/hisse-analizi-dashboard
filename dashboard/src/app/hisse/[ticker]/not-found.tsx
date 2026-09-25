"use client";

import { useParams } from "next/navigation";
import { StockNotFound } from "@/components/stock/StockShell";

/** Rendered (HTTP 404) when the ticker in the URL can never be a valid BIST symbol. */
export default function NotFound() {
  const params = useParams<{ ticker?: string }>();
  let ticker: string | null = typeof params?.ticker === "string" ? params.ticker : null;
  try {
    ticker = ticker ? decodeURIComponent(ticker) : null;
  } catch {
    // keep the raw segment
  }
  return <StockNotFound ticker={ticker} />;
}
