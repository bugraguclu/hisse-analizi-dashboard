"use client";

import type { ReactNode } from "react";
import { DEFAULT_LAYOUT_ONLY, Tile, TileGroup, Workspace, WorkspaceControls, WorkspaceGrid, type WorkspaceCard } from "@/components/workspace/Workspace";
import { AllTimeframeSignals } from "./AllTimeframeSignals";
import { AnalystRecommendations } from "./AnalystRecommendations";
import { CompanyProfileCard } from "./CompanyProfileCard";
import { DividendHistory } from "./DividendHistory";
import { EarningsCalendar } from "./EarningsCalendar";
import { FinancialHealthScorecard } from "./FinancialHealthScorecard";
import { FinancialStatements } from "./FinancialStatements";
import { HoldersCard } from "./HoldersCard";
import { useStockI18n, type StockKey } from "./i18n";
import { IndicatorPanel } from "./IndicatorPanel";
import { KapEventsCard } from "./KapEventsCard";
import { MovingAveragesTable, PivotsCard } from "./MovingAveragesTable";
import { NewsCard } from "./NewsCard";
import { PriceChartCard } from "./PriceChartCard";
import { QuoteStats } from "./QuoteStats";
import { RatiosCard } from "./RatiosCard";
import { SectorComparisonCard } from "./SectorComparisonCard";
import { SimilarCompaniesCard } from "./SimilarCompaniesCard";
import { StockShell, type StockView } from "./StockShell";
import { TechnicalSummary } from "./TechnicalSummary";
import { SectionHeadingLevel } from "./ui";

/**
 * Every card of the stock pages, by the id its tile uses. The visitor can move
 * and resize them; each view keeps its own layout, shared by all stocks.
 */
const CARDS = {
  /*
   * A fixed set of figures: the card is as tall as they are at the width it is
   * given, so it never scrolls and never has room left over. Wider, the figures
   * spread into more columns and the card gets shorter.
   */
  quote: { title: "quote.sectionLabel", hug: true },
  scorecard: { title: "score.title", hug: true },
  analysts: { title: "analyst.title", hug: true },
  ratios: { title: "ratios.title", hug: true },
  signals: { title: "tf.title", hug: true },
  earnings: { title: "earn.title", hug: true },
  holders: { title: "holders.title", hug: true },
  profile: { title: "profile.title", hug: true },
  summary: { title: "tech.summaryTitle", hug: true },
  averages: { title: "ma.title", hug: true, minW: 3 },
  indicators: { title: "tech.indicatorsTitle", hug: true, minW: 3 },
  pivots: { title: "pivots.title", hug: true },
  // A chart takes any size. Narrower or shorter than this, its controls leave no room for the plot.
  chart: { title: "chart.title", minW: 3, minH: 11 },
  // Lists and tables: the card scrolls when short and stops growing where the list ends.
  kap: { title: "kap.title", minH: 6 },
  news: { title: "news.title", minH: 6 },
  dividends: { title: "div.title", minH: 6 },
  sector: { title: "peers.title", minW: 3, minH: 7 },
  similar: { title: "similar.title", minW: 3, minH: 7 },
  statements: { title: "fin.title", minW: 3, minH: 8 },
} as const satisfies Record<string, Omit<WorkspaceCard, "label"> & { title: StockKey }>;

type CardId = keyof typeof CARDS;

/** The stock frame with a view's cards inside a workspace; the layout controls sit at the end of the tab row. */
function StockWorkspace({
  ticker,
  view,
  cards,
  className,
  children,
}: {
  ticker: string;
  view: StockView;
  cards: readonly CardId[];
  /** The view's default arrangement of its tiles. */
  className: string;
  children: ReactNode;
}) {
  const { t } = useStockI18n();
  const offered: Record<string, WorkspaceCard> = {};
  for (const id of cards) {
    const { title, ...limits } = CARDS[id];
    offered[id] = { ...limits, label: t(title) };
  }
  return (
    <Workspace page={`stock-${view}`} cards={offered}>
      <StockShell ticker={ticker} view={view} actions={<WorkspaceControls compact />}>
        <WorkspaceGrid className={className}>{children}</WorkspaceGrid>
      </StockShell>
    </Workspace>
  );
}

/** A view's tiles and groups, one under the other. */
const PAGE = "space-y-4";

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

/*
 * Every stock page runs top to bottom in the order an investor needs it:
 * summaries and verdicts before the figures behind them, fundamentals before
 * technicals, the full statement tables last. In a pair the left card (first
 * on phones) is the more important one.
 */

/**
 * /hisse/[ticker] — overview: key figures and the chart, the verdicts
 * (scorecard, analysts), what is new (KAP, news), ratios and signals, the
 * stock against its sector and its closest peers, dividends and the report calendar, then the
 * statements. Below-the-fold cards mount when scrolled near.
 */
export function StockOverviewView({ ticker }: { ticker: string }) {
  return (
    <StockWorkspace
      ticker={ticker}
      view="overview"
      className={PAGE}
      cards={["quote", "chart", "scorecard", "analysts", "kap", "news", "ratios", "signals", "sector", "similar", "dividends", "earnings", "statements"]}
    >
      <Tile id="quote">
        <QuoteStats ticker={ticker} />
      </Tile>
      <Tile id="chart">
        <PriceChartCard ticker={ticker} />
      </Tile>
      <TileGroup className={PAIR}>
        <Tile id="scorecard">
          <FinancialHealthScorecard ticker={ticker} />
        </Tile>
        <Tile id="analysts">
          <AnalystRecommendations ticker={ticker} />
        </Tile>
      </TileGroup>
      <TileGroup className={PAIR}>
        <Tile id="kap" lazy placeholderHeight={560}>
          <KapEventsCard ticker={ticker} />
        </Tile>
        <Tile id="news" lazy placeholderHeight={560}>
          <NewsCard ticker={ticker} />
        </Tile>
      </TileGroup>
      <TileGroup className={PAIR}>
        <Tile id="ratios" lazy placeholderHeight={480}>
          <RatiosCard ticker={ticker} />
        </Tile>
        <Tile id="signals" lazy placeholderHeight={480}>
          <AllTimeframeSignals ticker={ticker} />
        </Tile>
      </TileGroup>
      <Tile id="sector" lazy placeholderHeight={420}>
        <SectorComparisonCard ticker={ticker} />
      </Tile>
      <Tile id="similar" lazy placeholderHeight={420}>
        <SimilarCompaniesCard ticker={ticker} />
      </Tile>
      <TileGroup className={PAIR}>
        <Tile id="dividends" lazy placeholderHeight={300}>
          <DividendHistory ticker={ticker} />
        </Tile>
        <Tile id="earnings" lazy placeholderHeight={300}>
          <EarningsCalendar ticker={ticker} />
        </Tile>
      </TileGroup>
      <Tile id="statements" lazy placeholderHeight={480}>
        <FinancialStatements ticker={ticker} />
      </Tile>
    </StockWorkspace>
  );
}

/**
 * /temel/[ticker] — fundamentals: the scorecard over the ratios behind it
 * beside the analysts' view over valuation and the company profile (two
 * columns that end on the same line, so a bank's short ratio list doesn't
 * leave one half-empty card), the stock against its sector, dividends beside
 * ownership and the report calendar, then the statements.
 */
export function StockFundamentalView({ ticker }: { ticker: string }) {
  return (
    <StockWorkspace
      ticker={ticker}
      view="fundamental"
      className={PAGE}
      cards={["scorecard", "ratios", "analysts", "profile", "sector", "similar", "dividends", "holders", "earnings", "statements"]}
    >
      <TileGroup className={PAIR}>
        <TileGroup className={STACK}>
          <Tile id="scorecard">
            <FinancialHealthScorecard ticker={ticker} />
          </Tile>
          <Tile id="ratios">
            <RatiosCard ticker={ticker} />
          </Tile>
        </TileGroup>
        <TileGroup className={STACK}>
          <Tile id="analysts">
            <AnalystRecommendations ticker={ticker} />
          </Tile>
          <Tile id="profile">
            <CompanyProfileCard ticker={ticker} />
          </Tile>
        </TileGroup>
      </TileGroup>
      <Tile id="sector" lazy placeholderHeight={420}>
        <SectorComparisonCard ticker={ticker} />
      </Tile>
      <Tile id="similar" lazy placeholderHeight={420}>
        <SimilarCompaniesCard ticker={ticker} />
      </Tile>
      <TileGroup className={PAIR}>
        <Tile id="dividends" lazy placeholderHeight={440}>
          <DividendHistory ticker={ticker} />
        </Tile>
        <TileGroup className={STACK}>
          <Tile id="holders" lazy placeholderHeight={212}>
            <HoldersCard ticker={ticker} />
          </Tile>
          <Tile id="earnings" lazy placeholderHeight={212}>
            <EarningsCalendar ticker={ticker} />
          </Tile>
        </TileGroup>
      </TileGroup>
      <Tile id="statements" lazy placeholderHeight={480}>
        <FinancialStatements ticker={ticker} />
      </Tile>
    </StockWorkspace>
  );
}

/**
 * /teknik/[ticker] — technical analysis: the daily verdict and the chart, the
 * trend (moving averages) beside the verdict per timeframe, the oscillators,
 * then pivot levels.
 */
export function StockTechnicalView({ ticker }: { ticker: string }) {
  return (
    <StockWorkspace ticker={ticker} view="technical" className={PAGE} cards={["summary", "chart", "averages", "signals", "indicators", "pivots"]}>
      <Tile id="summary">
        <TechnicalSummary ticker={ticker} />
      </Tile>
      <Tile id="chart">
        <PriceChartCard ticker={ticker} variant="technical" />
      </Tile>
      <TileGroup className={PAIR}>
        <Tile id="averages">
          <MovingAveragesTable ticker={ticker} />
        </Tile>
        <Tile id="signals">
          <AllTimeframeSignals ticker={ticker} />
        </Tile>
      </TileGroup>
      <Tile id="indicators">
        <IndicatorPanel ticker={ticker} />
      </Tile>
      <Tile id="pivots" lazy placeholderHeight={240}>
        <PivotsCard ticker={ticker} />
      </Tile>
    </StockWorkspace>
  );
}

/** One side of the combined view: a small caps label over a column of cards (their titles become h3). */
function CombinedColumn({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <TileGroup as="section" aria-labelledby={id} className="flex min-w-0 flex-col gap-3">
      <h2 id={id} {...DEFAULT_LAYOUT_ONLY} className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        {title}
      </h2>
      <SectionHeadingLevel level={3}>
        <TileGroup className={`${STACK} grow`}>{children}</TileGroup>
      </SectionHeadingLevel>
    </TileGroup>
  );
}

/**
 * /analiz/[ticker] — fundamental and technical summaries side by side from xl
 * (below that the two columns stack, fundamentals first, so no card is
 * squeezed into ~450px). Each column opens with its verdicts.
 */
export function StockCombinedView({ ticker }: { ticker: string }) {
  const { t } = useStockI18n();
  return (
    <StockWorkspace
      ticker={ticker}
      view="combined"
      className="grid grid-cols-1 gap-x-4 gap-y-8 xl:grid-cols-2"
      cards={["scorecard", "analysts", "ratios", "sector", "similar", "profile", "holders", "summary", "signals", "indicators", "pivots"]}
    >
      <CombinedColumn id="combined-fundamental" title={t("tabs.fundamental")}>
        <Tile id="scorecard">
          <FinancialHealthScorecard ticker={ticker} />
        </Tile>
        <Tile id="analysts">
          <AnalystRecommendations ticker={ticker} />
        </Tile>
        <Tile id="ratios">
          <RatiosCard ticker={ticker} />
        </Tile>
        <Tile id="sector">
          <SectorComparisonCard ticker={ticker} compact />
        </Tile>
        <Tile id="similar" lazy placeholderHeight={420}>
          <SimilarCompaniesCard ticker={ticker} compact />
        </Tile>
        <Tile id="profile">
          <CompanyProfileCard ticker={ticker} />
        </Tile>
        <Tile id="holders">
          <HoldersCard ticker={ticker} />
        </Tile>
      </CombinedColumn>
      <CombinedColumn id="combined-technical" title={t("tabs.technical")}>
        <Tile id="summary">
          <TechnicalSummary ticker={ticker} />
        </Tile>
        <Tile id="signals">
          <AllTimeframeSignals ticker={ticker} />
        </Tile>
        <Tile id="indicators">
          <IndicatorPanel ticker={ticker} compact />
        </Tile>
        <Tile id="pivots" lazy placeholderHeight={240}>
          <PivotsCard ticker={ticker} />
        </Tile>
      </CombinedColumn>
    </StockWorkspace>
  );
}
