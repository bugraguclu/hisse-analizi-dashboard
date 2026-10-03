import {
  Activity,
  ArrowLeftRight,
  BarChart3,
  Building2,
  CalendarClock,
  CalendarDays,
  ChartCandlestick,
  ChartLine,
  ChartNoAxesColumn,
  ClipboardCheck,
  Coins,
  Crosshair,
  Gauge,
  Globe,
  Heading,
  Landmark,
  Layers,
  ListOrdered,
  Megaphone,
  Newspaper,
  Percent,
  PieChart,
  Scale,
  Signal,
  Star,
  StickyNote,
  Table2,
  Thermometer,
  TrendingUp,
  Waves,
  type LucideIcon,
} from "lucide-react";
import type { WidgetKey } from "./i18n-dict";
import type { OptionValue } from "./model";

/**
 * The widget catalogue: what can be put on a page, its name and description,
 * the width it starts with and its settings. Components live in
 * components.tsx (loaded on demand); this module stays light so storage
 * validation and the gallery don't pull every card in.
 */

export type WidgetCategory = "stock" | "market" | "macro" | "general";

export const CATEGORIES: readonly WidgetCategory[] = ["stock", "market", "macro", "general"];

export type WidgetOption =
  | { key: string; kind: "select"; label: WidgetKey; choices: ReadonlyArray<{ value: string; label: WidgetKey }>; default: string }
  | { key: string; kind: "toggle"; label: WidgetKey; default: boolean }
  | { key: string; kind: "text"; label: WidgetKey; multiline?: boolean; maxLength: number; placeholder?: WidgetKey };

export interface WidgetMeta {
  type: string;
  category: WidgetCategory;
  icon: LucideIcon;
  name: WidgetKey;
  description: WidgetKey;
  /** Columns (of 12) it takes when added. */
  defaultWidth: number;
  /** Placeholder height (px) while it waits to mount below the fold. */
  estimatedHeight: number;
  /** Shows one stock: follows the page's ticker unless given its own. */
  stock?: boolean;
  /** Keeps its own height in a stack instead of sharing the column's extra height (headings). */
  rigid?: boolean;
  /**
   * Share of a stack's extra height (default 1). 0 = only when nothing else in
   * the stack can take it (the watchlist stays compact above market breadth).
   */
  grow?: number;
  options?: readonly WidgetOption[];
}

const VIEW_OPTION: WidgetOption = {
  key: "view",
  kind: "select",
  label: "opt.view",
  choices: [
    { value: "overview", label: "opt.view.overview" },
    { value: "technical", label: "opt.view.technical" },
  ],
  default: "overview",
};

const COMPACT_OPTION: WidgetOption = { key: "compact", kind: "toggle", label: "opt.compact", default: false };

const HEADING_OPTIONS: readonly WidgetOption[] = [
  { key: "text", kind: "text", label: "opt.text", maxLength: 120, placeholder: "heading.placeholder" },
  {
    key: "style",
    kind: "select",
    label: "opt.style",
    choices: [
      { value: "section", label: "opt.style.section" },
      { value: "caps", label: "opt.style.caps" },
    ],
    default: "section",
  },
];

const NOTE_OPTIONS: readonly WidgetOption[] = [
  { key: "title", kind: "text", label: "opt.title", maxLength: 80, placeholder: "note.title" },
  { key: "text", kind: "text", label: "opt.text", multiline: true, maxLength: 4000 },
];

function stock(type: string, icon: LucideIcon, defaultWidth: number, estimatedHeight: number, options?: readonly WidgetOption[]): WidgetMeta {
  const key = type.slice("stock.".length);
  return {
    type,
    category: "stock",
    icon,
    name: `w.stock.${key}` as WidgetKey,
    description: `w.stock.${key}.desc` as WidgetKey,
    defaultWidth,
    estimatedHeight,
    stock: true,
    options,
  };
}

function plain(category: Exclude<WidgetCategory, "stock">, type: string, icon: LucideIcon, defaultWidth: number, estimatedHeight: number, options?: readonly WidgetOption[]): WidgetMeta {
  return { type, category, icon, name: `w.${type}` as WidgetKey, description: `w.${type}.desc` as WidgetKey, defaultWidth, estimatedHeight, options };
}

export const WIDGETS: readonly WidgetMeta[] = [
  stock("stock.quote", Gauge, 12, 140),
  stock("stock.chart", ChartCandlestick, 12, 560, [VIEW_OPTION]),
  stock("stock.scorecard", ClipboardCheck, 6, 420),
  stock("stock.analysts", Star, 6, 420),
  stock("stock.kap", Megaphone, 6, 560),
  stock("stock.news", Newspaper, 6, 560),
  stock("stock.ratios", Percent, 6, 480),
  stock("stock.signals", Signal, 6, 480),
  stock("stock.sector", Scale, 12, 420, [COMPACT_OPTION]),
  stock("stock.dividends", Coins, 6, 360),
  stock("stock.earnings", CalendarClock, 6, 300),
  stock("stock.statements", Table2, 12, 520),
  stock("stock.profile", Building2, 6, 360),
  stock("stock.holders", PieChart, 6, 320),
  stock("stock.technicalSummary", Activity, 12, 220),
  stock("stock.movingAverages", Waves, 6, 480),
  stock("stock.indicators", ChartLine, 12, 420, [COMPACT_OPTION]),
  stock("stock.pivots", Crosshair, 12, 260),

  plain("market", "market.index", TrendingUp, 8, 420),
  { ...plain("market", "market.watchlist", ListOrdered, 4, 360), grow: 0 },
  plain("market", "market.breadth", BarChart3, 4, 420),
  plain("market", "market.events", Newspaper, 8, 480),

  plain("macro", "macro.kpis", Gauge, 12, 140),
  plain("macro", "macro.corridor", Landmark, 4, 360),
  plain("macro", "macro.policyInflation", ChartLine, 8, 360),
  plain("macro", "macro.inflationTiles", Thermometer, 12, 140),
  plain("macro", "macro.inflationTrend", TrendingUp, 8, 360),
  plain("macro", "macro.monthlyCpi", ChartNoAxesColumn, 4, 360),
  plain("macro", "macro.markets", ArrowLeftRight, 12, 620),
  plain("macro", "macro.fxBulletin", Coins, 12, 420),
  plain("macro", "macro.calendar", CalendarDays, 12, 640),
  plain("macro", "macro.activity", Layers, 12, 300),
  plain("macro", "macro.external", Globe, 12, 300),

  { ...plain("general", "general.heading", Heading, 12, 48, HEADING_OPTIONS), rigid: true },
  plain("general", "general.note", StickyNote, 4, 200, NOTE_OPTIONS),
];

const BY_TYPE = new Map(WIDGETS.map((meta) => [meta.type, meta]));

export function widgetMeta(type: string): WidgetMeta | undefined {
  return BY_TYPE.get(type);
}

export function isWidgetType(type: string): boolean {
  return BY_TYPE.has(type);
}

/** The widget's options with defaults filled in. */
export function resolveOptions(meta: WidgetMeta, options: Record<string, OptionValue> | undefined): Record<string, OptionValue> {
  const resolved: Record<string, OptionValue> = {};
  for (const option of meta.options ?? []) {
    const value = options?.[option.key];
    if (option.kind === "select") resolved[option.key] = typeof value === "string" && option.choices.some((c) => c.value === value) ? value : option.default;
    else if (option.kind === "toggle") resolved[option.key] = typeof value === "boolean" ? value : option.default;
    else resolved[option.key] = typeof value === "string" ? value.slice(0, option.maxLength) : "";
  }
  // Hidden options set by default layouts (heading presets, anchors) pass through.
  for (const [key, value] of Object.entries(options ?? {})) if (!(key in resolved)) resolved[key] = value;
  return resolved;
}
