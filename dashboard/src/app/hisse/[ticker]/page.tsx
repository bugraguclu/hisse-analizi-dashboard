import type { Metadata } from "next";
import { resolveTicker, stockMetadata } from "@/components/stock/route";
import { demoTickerStaticParams } from "@/lib/demo";
import { StockOverviewView } from "@/components/stock/views";

type Props = { params: Promise<{ ticker: string }> };

/** Static demo only (lib/demo.ts): the recorded stocks; undefined, so dynamic, in the server build. */
export const generateStaticParams = demoTickerStaticParams;

export function generateMetadata({ params }: Props): Promise<Metadata> {
  return stockMetadata(params, "meta.overview");
}

export default async function Page({ params }: Props) {
  const ticker = await resolveTicker(params, "/hisse");
  return <StockOverviewView ticker={ticker} />;
}
