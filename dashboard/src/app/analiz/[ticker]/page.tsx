import type { Metadata } from "next";
import { resolveTicker, stockMetadata } from "@/components/stock/route";
import { StockCombinedView } from "@/components/stock/views";

type Props = { params: Promise<{ ticker: string }> };

export function generateMetadata({ params }: Props): Promise<Metadata> {
  return stockMetadata(params, "meta.combined");
}

export default async function Page({ params }: Props) {
  const ticker = await resolveTicker(params, "/analiz");
  return <StockCombinedView ticker={ticker} />;
}
