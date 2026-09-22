import type { Metadata } from "next";
import { resolveTicker, stockMetadata } from "@/components/stock/route";
import { StockFundamentalView } from "@/components/stock/views";

type Props = { params: Promise<{ ticker: string }> };

export function generateMetadata({ params }: Props): Promise<Metadata> {
  return stockMetadata(params, "meta.fundamental");
}

export default async function Page({ params }: Props) {
  const ticker = await resolveTicker(params, "/temel");
  return <StockFundamentalView ticker={ticker} />;
}
