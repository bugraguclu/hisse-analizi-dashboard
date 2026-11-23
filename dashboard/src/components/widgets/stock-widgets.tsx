"use client";

import { AllTimeframeSignals } from "@/components/stock/AllTimeframeSignals";
import { AnalystRecommendations } from "@/components/stock/AnalystRecommendations";
import { CompanyProfileCard } from "@/components/stock/CompanyProfileCard";
import { DividendHistory } from "@/components/stock/DividendHistory";
import { EarningsCalendar } from "@/components/stock/EarningsCalendar";
import { FinancialHealthScorecard } from "@/components/stock/FinancialHealthScorecard";
import { FinancialStatements } from "@/components/stock/FinancialStatements";
import { HoldersCard } from "@/components/stock/HoldersCard";
import { IndicatorPanel } from "@/components/stock/IndicatorPanel";
import { KapEventsCard } from "@/components/stock/KapEventsCard";
import { MovingAveragesTable, PivotsCard } from "@/components/stock/MovingAveragesTable";
import { NewsCard } from "@/components/stock/NewsCard";
import { PriceChartCard } from "@/components/stock/PriceChartCard";
import { QuoteStats } from "@/components/stock/QuoteStats";
import { RatiosCard } from "@/components/stock/RatiosCard";
import { SectorComparisonCard } from "@/components/stock/SectorComparisonCard";
import { SimilarCompaniesCard } from "@/components/stock/SimilarCompaniesCard";
import { TechnicalSummary } from "@/components/stock/TechnicalSummary";
import type { WidgetComponents } from "./types";

/** The stock cards, bundled with the stock pages (rendered on the server like before). */
export const STOCK_WIDGETS: WidgetComponents = {
  "stock.quote": ({ ticker }) => <QuoteStats ticker={ticker} />,
  "stock.chart": ({ ticker, options }) => <PriceChartCard ticker={ticker} variant={options.view === "technical" ? "technical" : "overview"} />,
  "stock.scorecard": ({ ticker }) => <FinancialHealthScorecard ticker={ticker} />,
  "stock.analysts": ({ ticker }) => <AnalystRecommendations ticker={ticker} />,
  "stock.kap": ({ ticker }) => <KapEventsCard ticker={ticker} />,
  "stock.news": ({ ticker }) => <NewsCard ticker={ticker} />,
  "stock.ratios": ({ ticker }) => <RatiosCard ticker={ticker} />,
  "stock.signals": ({ ticker }) => <AllTimeframeSignals ticker={ticker} />,
  "stock.sector": ({ ticker, options }) => <SectorComparisonCard ticker={ticker} compact={options.compact === true} />,
  "stock.similar": ({ ticker, options }) => <SimilarCompaniesCard ticker={ticker} compact={options.compact === true} />,
  "stock.dividends": ({ ticker }) => <DividendHistory ticker={ticker} />,
  "stock.earnings": ({ ticker }) => <EarningsCalendar ticker={ticker} />,
  "stock.statements": ({ ticker }) => <FinancialStatements ticker={ticker} />,
  "stock.profile": ({ ticker }) => <CompanyProfileCard ticker={ticker} />,
  "stock.holders": ({ ticker }) => <HoldersCard ticker={ticker} />,
  "stock.technicalSummary": ({ ticker }) => <TechnicalSummary ticker={ticker} />,
  "stock.movingAverages": ({ ticker }) => <MovingAveragesTable ticker={ticker} />,
  "stock.indicators": ({ ticker, options }) => <IndicatorPanel ticker={ticker} compact={options.compact === true} />,
  "stock.pivots": ({ ticker }) => <PivotsCard ticker={ticker} />,
};
