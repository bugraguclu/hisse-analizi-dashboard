import { buildLayout, railRow, row, type Layout } from "./model";

/**
 * The site's own page layouts, as widget layouts. A visitor who never
 * customises a page sees exactly these; "Reset to default" returns to them.
 * They keep the order the hand-built pages had: what an investor needs first
 * at the top, in a pair the more important card on the left (first on phones).
 */

export type BuiltInPage = "home" | "stock.overview" | "stock.fundamental" | "stock.technical" | "stock.combined" | "macro";

const heading = (preset: string, anchor?: string, style?: "caps") => ({
  type: "general.heading",
  options: { preset, ...(anchor ? { anchor } : {}), ...(style ? { style } : {}) },
});

export const DEFAULT_LAYOUTS: Readonly<Record<BuiltInPage, Layout>> = {
  /**
   * Home: the BIST 100 with the latest KAP disclosures under it, beside the
   * visitor's watchlist over market breadth (phones: chart, watchlist,
   * breadth, disclosures).
   */
  home: buildLayout("home", [railRow([8, "market.index", "market.events"], [4, "market.watchlist", "market.breadth"])]),

  /**
   * /hisse — key figures and the chart, the verdicts (scorecard, analysts),
   * what is new (KAP, news), ratios and signals, the stock against its sector,
   * dividends and the report calendar, then the statements.
   */
  "stock.overview": buildLayout("overview", [
    row([12, "stock.quote"]),
    row([12, "stock.chart"]),
    row([6, "stock.scorecard"], [6, "stock.analysts"]),
    row([6, "stock.kap"], [6, "stock.news"]),
    row([6, "stock.ratios"], [6, "stock.signals"]),
    row([12, "stock.sector"]),
    row([6, "stock.dividends"], [6, "stock.earnings"]),
    row([12, "stock.statements"]),
  ]),

  /**
   * /temel — the scorecard over the ratios behind it beside the analysts over
   * the company profile, the sector, dividends beside ownership and the report
   * calendar, then the statements.
   */
  "stock.fundamental": buildLayout("fundamental", [
    row([6, "stock.scorecard", "stock.ratios"], [6, "stock.analysts", "stock.profile"]),
    row([12, "stock.sector"]),
    row([6, "stock.dividends"], [6, "stock.holders", "stock.earnings"]),
    row([12, "stock.statements"]),
  ]),

  /** /teknik — the daily verdict and the chart, moving averages beside the per-timeframe verdicts, oscillators, pivots. */
  "stock.technical": buildLayout("technical", [
    row([12, "stock.technicalSummary"]),
    row([12, { type: "stock.chart", options: { view: "technical" } }]),
    row([6, "stock.movingAverages"], [6, "stock.signals"]),
    row([12, "stock.indicators"]),
    row([12, "stock.pivots"]),
  ]),

  /** /analiz — fundamental and technical summaries side by side, each column opening with its verdicts. */
  "stock.combined": buildLayout("combined", [
    row(
      [
        6,
        heading("fundamental", undefined, "caps"),
        "stock.scorecard",
        "stock.analysts",
        "stock.ratios",
        { type: "stock.sector", options: { compact: true } },
        "stock.profile",
        "stock.holders",
      ],
      [
        6,
        heading("technical", undefined, "caps"),
        "stock.technicalSummary",
        "stock.signals",
        { type: "stock.indicators", options: { compact: true } },
        { type: "stock.pivots", options: { lazy: true } },
      ],
    ),
  ]),

  /**
   * /makro — the policy rate and inflation drive valuations, markets and the
   * release calendar move every day, growth and the external balance change
   * slowly. Headings carry the anchors the section links jump to.
   */
  macro: buildLayout("macro", [
    row([12, "macro.kpis"]),
    row([12, heading("monetary", "para-politikasi")]),
    row([4, "macro.corridor"], [8, "macro.policyInflation"]),
    row([12, heading("inflation", "enflasyon")]),
    row([12, "macro.inflationTiles"]),
    row([8, "macro.inflationTrend"], [4, "macro.monthlyCpi"]),
    row([12, heading("markets", "piyasalar")]),
    row([12, "macro.markets"]),
    row([12, "macro.fxBulletin"]),
    row([12, heading("calendar", "takvim")]),
    row([12, "macro.calendar"]),
    row([12, heading("activity", "buyume")]),
    row([12, "macro.activity"]),
    row([12, heading("external", "dis-denge")]),
    row([12, "macro.external"]),
  ]),
};

export type TemplateId = "overview" | "fundamental" | "technical" | "dividend" | "home" | "macro";

/** Starting points for a custom page (the built-in pages, plus a dividend/statements one). */
export const TEMPLATES: ReadonlyArray<{ id: TemplateId; layout: Layout }> = [
  { id: "overview", layout: DEFAULT_LAYOUTS["stock.overview"] },
  { id: "fundamental", layout: DEFAULT_LAYOUTS["stock.fundamental"] },
  { id: "technical", layout: DEFAULT_LAYOUTS["stock.technical"] },
  {
    id: "dividend",
    layout: buildLayout("dividend", [
      row([12, "stock.quote"]),
      row([6, "stock.dividends"], [6, "stock.earnings", "stock.holders"]),
      row([12, "stock.statements"]),
    ]),
  },
  { id: "home", layout: DEFAULT_LAYOUTS.home },
  { id: "macro", layout: DEFAULT_LAYOUTS.macro },
];
