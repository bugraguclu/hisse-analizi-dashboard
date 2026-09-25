"use client";

import type { ReactNode } from "react";
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
import { LazySection, SectionHeadingLevel } from "./ui";

/** Two cards side by side from lg; both stretch to the taller one, so headers and footers line up. */
const PAIR = "grid grid-cols-1 gap-4 lg:grid-cols-2";

/**
 * A column of cards that fills its grid cell: when the column next to it is
 * taller, the extra height is shared by all of its cards (each grows from its
 * content height, footers stay at the bottom), so the two columns end on the
 * same line without one half-empty card or a hole under the shorter column.
 * Cards never shrink — their overflow is hidden, a squeezed card would clip.
 */
const STACK = "flex min-w-0 flex-col gap-4 [&>*]:shrink-0 [&>*]:grow";

/** A LazySection inside a STACK: the mounted card fills the (growing) wrapper. */
const STACK_ITEM = "flex flex-col [&>*]:grow";

/** /hisse/[ticker] — overview. Below-the-fold sections mount when scrolled near. */
export function StockOverviewView({ ticker }: { ticker: string }) {
  return (
    <StockShell ticker={ticker} view="overview">
      <QuoteStats ticker={ticker} />
      <PriceChartCard ticker={ticker} />
      <div className={PAIR}>
        <RatiosCard ticker={ticker} />
        <FinancialHealthScorecard ticker={ticker} />
      </div>
      <LazySection columns={2} minHeight={560}>
        <div className={PAIR}>
          <KapEventsCard ticker={ticker} />
          <NewsCard ticker={ticker} />
        </div>
      </LazySection>
      <LazySection columns={2} minHeight={400}>
        <div className={PAIR}>
          <AnalystRecommendations ticker={ticker} />
          <AllTimeframeSignals ticker={ticker} />
        </div>
      </LazySection>
      <LazySection minHeight={480}>
        <FinancialStatements ticker={ticker} />
      </LazySection>
      <LazySection columns={2} minHeight={300}>
        <div className={PAIR}>
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
      <PriceChartCard ticker={ticker} variant="technical" />
      <IndicatorPanel ticker={ticker} />
      <div className={PAIR}>
        <MovingAveragesTable ticker={ticker} />
        <AllTimeframeSignals ticker={ticker} />
      </div>
      <LazySection minHeight={240}>
        <PivotsCard ticker={ticker} />
      </LazySection>
    </StockShell>
  );
}

/**
 * /temel/[ticker] — fundamentals. The first block is two columns (company +
 * ownership | ratios + scorecard) that end on the same line.
 */
export function StockFundamentalView({ ticker }: { ticker: string }) {
  return (
    <StockShell ticker={ticker} view="fundamental">
      <div className={PAIR}>
        <div className={STACK}>
          <CompanyProfileCard ticker={ticker} />
          <HoldersCard ticker={ticker} />
        </div>
        <div className={STACK}>
          <RatiosCard ticker={ticker} />
          <FinancialHealthScorecard ticker={ticker} />
        </div>
      </div>
      <LazySection columns={2} minHeight={340}>
        <div className={PAIR}>
          <AnalystRecommendations ticker={ticker} />
          <DividendHistory ticker={ticker} />
        </div>
      </LazySection>
      <LazySection minHeight={480}>
        <FinancialStatements ticker={ticker} />
      </LazySection>
      <LazySection minHeight={200}>
        <EarningsCalendar ticker={ticker} />
      </LazySection>
    </StockShell>
  );
}

/** One side of the combined view: a small caps label over a column of cards (their titles become h3). */
function CombinedColumn({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="flex min-w-0 flex-col gap-3">
      <h2 id={id} className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        {title}
      </h2>
      <SectionHeadingLevel level={3}>
        <div className={`${STACK} grow`}>{children}</div>
      </SectionHeadingLevel>
    </section>
  );
}

/**
 * /analiz/[ticker] — technical and fundamental summaries side by side from xl
 * (below that the two columns stack, so no card is squeezed into ~450px).
 */
export function StockCombinedView({ ticker }: { ticker: string }) {
  const { t } = useStockI18n();
  return (
    <StockShell ticker={ticker} view="combined">
      <div className="grid grid-cols-1 gap-x-4 gap-y-8 xl:grid-cols-2">
        <CombinedColumn id="combined-technical" title={t("tabs.technical")}>
          <TechnicalSummary ticker={ticker} />
          <IndicatorPanel ticker={ticker} compact />
          <AllTimeframeSignals ticker={ticker} />
          <LazySection minHeight={240} className={STACK_ITEM}>
            <PivotsCard ticker={ticker} />
          </LazySection>
        </CombinedColumn>
        <CombinedColumn id="combined-fundamental" title={t("tabs.fundamental")}>
          <AnalystRecommendations ticker={ticker} />
          <FinancialHealthScorecard ticker={ticker} />
          <CompanyProfileCard ticker={ticker} />
          <RatiosCard ticker={ticker} />
          <HoldersCard ticker={ticker} />
        </CombinedColumn>
      </div>
    </StockShell>
  );
}
