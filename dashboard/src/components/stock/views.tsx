"use client";

import { Building2, TrendingUp } from "lucide-react";
import { AllTimeframeSignals } from "./AllTimeframeSignals";
import { AnalystRecommendations } from "./AnalystRecommendations";
import { CompanyProfileCard } from "./CompanyProfileCard";
import { DividendHistory } from "./DividendHistory";
import { EarningsCalendar } from "./EarningsCalendar";
import { FinancialHealthScorecard } from "./FinancialHealthScorecard";
import { FinancialStatements } from "./FinancialStatements";
import { HoldersCard } from "./HoldersCard";
import { useStockI18n } from "./i18n";
import { IndicatorPanel } from "./IndicatorPanel";
import { KapEventsCard } from "./KapEventsCard";
import { MovingAveragesTable, PivotsCard } from "./MovingAveragesTable";
import { NewsCard } from "./NewsCard";
import { PriceChartCard } from "./PriceChartCard";
import { QuoteStats } from "./QuoteStats";
import { RatiosCard } from "./RatiosCard";
import { StockShell } from "./StockShell";
import { TechnicalSummary } from "./TechnicalSummary";
import { LazySection } from "./ui";

const TWO_COLUMNS = "grid grid-cols-1 gap-4 lg:grid-cols-2";

/** /hisse/[ticker] — overview. Below-the-fold sections mount when scrolled near. */
export function StockOverviewView({ ticker }: { ticker: string }) {
  return (
    <StockShell ticker={ticker} view="overview">
      <QuoteStats ticker={ticker} />
      <PriceChartCard ticker={ticker} />
      <div className={TWO_COLUMNS}>
        <RatiosCard ticker={ticker} />
        <FinancialHealthScorecard ticker={ticker} />
      </div>
      <LazySection>
        <div className={TWO_COLUMNS}>
          <KapEventsCard ticker={ticker} />
          <NewsCard ticker={ticker} />
        </div>
      </LazySection>
      <LazySection>
        <div className={TWO_COLUMNS}>
          <AnalystRecommendations ticker={ticker} />
          <AllTimeframeSignals ticker={ticker} />
        </div>
      </LazySection>
      <LazySection minHeight={420}>
        <FinancialStatements ticker={ticker} />
      </LazySection>
      <LazySection>
        <div className={TWO_COLUMNS}>
          <DividendHistory ticker={ticker} />
          <EarningsCalendar ticker={ticker} />
        </div>
      </LazySection>
    </StockShell>
  );
}

/** /teknik/[ticker] — technical analysis. */
export function StockTechnicalView({ ticker }: { ticker: string }) {
  return (
    <StockShell ticker={ticker} view="technical">
      <TechnicalSummary ticker={ticker} />
      <IndicatorPanel ticker={ticker} />
      <div className={TWO_COLUMNS}>
        <MovingAveragesTable ticker={ticker} />
        <AllTimeframeSignals ticker={ticker} />
      </div>
      <LazySection minHeight={220}>
        <PivotsCard ticker={ticker} />
      </LazySection>
    </StockShell>
  );
}

/** /temel/[ticker] — fundamentals. */
export function StockFundamentalView({ ticker }: { ticker: string }) {
  return (
    <StockShell ticker={ticker} view="fundamental">
      <div className={TWO_COLUMNS}>
        <CompanyProfileCard ticker={ticker} />
        <RatiosCard ticker={ticker} />
      </div>
      <div className={TWO_COLUMNS}>
        <AnalystRecommendations ticker={ticker} />
        <FinancialHealthScorecard ticker={ticker} />
      </div>
      <LazySection minHeight={420}>
        <FinancialStatements ticker={ticker} />
      </LazySection>
      <LazySection>
        <div className={TWO_COLUMNS}>
          <HoldersCard ticker={ticker} />
          <DividendHistory ticker={ticker} />
        </div>
      </LazySection>
      <LazySection minHeight={200}>
        <EarningsCalendar ticker={ticker} />
      </LazySection>
    </StockShell>
  );
}

/** /analiz/[ticker] — technical and fundamental summaries side by side. */
export function StockCombinedView({ ticker }: { ticker: string }) {
  const { t } = useStockI18n();
  return (
    <StockShell ticker={ticker} view="combined">
      <div className={TWO_COLUMNS}>
        <section aria-labelledby="combined-technical" className="min-w-0 space-y-4">
          <h2 id="combined-technical" className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <TrendingUp aria-hidden className="h-4 w-4 text-primary" /> {t("tabs.technical")}
          </h2>
          <TechnicalSummary ticker={ticker} />
          <IndicatorPanel ticker={ticker} compact />
          <AllTimeframeSignals ticker={ticker} />
        </section>
        <section aria-labelledby="combined-fundamental" className="min-w-0 space-y-4">
          <h2 id="combined-fundamental" className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <Building2 aria-hidden className="h-4 w-4 text-primary" /> {t("tabs.fundamental")}
          </h2>
          <CompanyProfileCard ticker={ticker} />
          <RatiosCard ticker={ticker} />
          <AnalystRecommendations ticker={ticker} />
          <HoldersCard ticker={ticker} />
        </section>
      </div>
    </StockShell>
  );
}
