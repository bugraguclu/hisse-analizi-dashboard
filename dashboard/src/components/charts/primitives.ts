/*
 * Series primitives drawn into the price pane of FinancialChart: the fill
 * between two band lines, session separators on multi-day intraday charts and
 * the event badges on the time axis. Pattern after the Apache-2.0 plugin
 * examples of TradingView Lightweight Charts™ (bands-indicator, vertical-line).
 */

import type {
  IChartApi,
  IPrimitivePaneRenderer,
  IPrimitivePaneView,
  ISeriesApi,
  ISeriesPrimitive,
  Logical,
  PrimitiveHoveredItem,
  PrimitivePaneViewZOrder,
  SeriesAttachedParameter,
  SeriesType,
  Time,
} from "lightweight-charts";
import type { IndicatorSeries } from "./indicators";
import type { ChartEventKind } from "./types";

type Target = Parameters<IPrimitivePaneRenderer["draw"]>[0];

interface Attached {
  chart: IChartApi;
  series: ISeriesApi<SeriesType>;
  requestUpdate: () => void;
}

/** Bars [first, last] around the visible logical range, one bar of slack on each side. */
function visibleIndices(chart: IChartApi, count: number): [number, number] | null {
  const range = chart.timeScale().getVisibleLogicalRange();
  if (!range || count === 0) return null;
  const first = Math.max(0, Math.floor(range.from) - 1);
  const last = Math.min(count - 1, Math.ceil(range.to) + 1);
  return first <= last ? [first, last] : null;
}

abstract class BasePrimitive implements ISeriesPrimitive<Time> {
  protected host: Attached | null = null;
  private readonly views: readonly IPrimitivePaneView[];

  constructor(zOrder: PrimitivePaneViewZOrder) {
    const renderer: IPrimitivePaneRenderer = {
      draw: (target) => {
        if (zOrder !== "bottom") this.render(target);
      },
      drawBackground: (target) => {
        if (zOrder === "bottom") this.render(target);
      },
    };
    this.views = [{ zOrder: () => zOrder, renderer: () => renderer }];
  }

  attached(param: SeriesAttachedParameter<Time>): void {
    this.host = { chart: param.chart as IChartApi, series: param.series, requestUpdate: param.requestUpdate };
  }

  detached(): void {
    this.host = null;
  }

  paneViews(): readonly IPrimitivePaneView[] {
    return this.views;
  }

  protected update(): void {
    this.host?.requestUpdate();
  }

  protected abstract render(target: Target): void;
}

// ---------------------------------------------------------------------------
// Band fill
// ---------------------------------------------------------------------------

/** Translucent area between two lines (Bollinger bands), under the series. */
export class BandFillPrimitive extends BasePrimitive {
  constructor(
    private readonly upper: IndicatorSeries,
    private readonly lower: IndicatorSeries,
    private readonly color: string,
  ) {
    super("bottom");
  }

  protected render(target: Target): void {
    const host = this.host;
    if (!host) return;
    const span = visibleIndices(host.chart, this.upper.length);
    if (!span) return;
    const timeScale = host.chart.timeScale();
    target.useMediaCoordinateSpace(({ context }) => {
      context.fillStyle = this.color;
      let run: Array<[number, number, number]> = [];
      const flush = () => {
        if (run.length > 1) {
          context.beginPath();
          run.forEach(([x, top], i) => (i === 0 ? context.moveTo(x, top) : context.lineTo(x, top)));
          for (let i = run.length - 1; i >= 0; i -= 1) context.lineTo(run[i][0], run[i][2]);
          context.closePath();
          context.fill();
        }
        run = [];
      };
      for (let i = span[0]; i <= span[1]; i += 1) {
        const hi = this.upper[i];
        const lo = this.lower[i];
        const x = timeScale.logicalToCoordinate(i as Logical);
        const top = hi === null ? null : host.series.priceToCoordinate(hi);
        const bottom = lo === null ? null : host.series.priceToCoordinate(lo);
        if (x === null || top === null || bottom === null) {
          flush();
          continue;
        }
        run.push([x, top, bottom]);
      }
      flush();
    });
  }
}

// ---------------------------------------------------------------------------
// Session breaks
// ---------------------------------------------------------------------------

/** Faint vertical rule between trading days of a multi-day intraday chart (5G). */
export class SessionBreaksPrimitive extends BasePrimitive {
  constructor(
    /** Indices of the first bar of every session after the first. */
    private readonly starts: readonly number[],
    private readonly color: string,
  ) {
    super("bottom");
  }

  protected render(target: Target): void {
    const host = this.host;
    if (!host || this.starts.length === 0) return;
    const timeScale = host.chart.timeScale();
    target.useBitmapCoordinateSpace(({ context, bitmapSize, horizontalPixelRatio, verticalPixelRatio }) => {
      context.strokeStyle = this.color;
      context.lineWidth = Math.max(1, Math.floor(horizontalPixelRatio));
      context.setLineDash([3 * verticalPixelRatio, 3 * verticalPixelRatio]);
      for (const index of this.starts) {
        const a = timeScale.logicalToCoordinate((index - 1) as Logical);
        const b = timeScale.logicalToCoordinate(index as Logical);
        if (a === null || b === null) continue;
        const x = Math.round(((a + b) / 2) * horizontalPixelRatio) + 0.5;
        if (x < 0 || x > bitmapSize.width) continue;
        context.beginPath();
        context.moveTo(x, 0);
        context.lineTo(x, bitmapSize.height);
        context.stroke();
      }
      context.setLineDash([]);
    });
  }
}

// ---------------------------------------------------------------------------
// Event badges
// ---------------------------------------------------------------------------

export interface EventBadge {
  id: string;
  kind: ChartEventKind;
  /** Bar index the event falls on. */
  index: number;
  letter: string;
  color: string;
}

export interface EventBadgeStyle {
  card: string;
  font: string;
}

const BADGE_RADIUS = 7;
const BADGE_GAP = 2;
/** Badges on one bar beyond this collapse into a "+n" badge. */
const BADGE_STACK = 3;
const HIT_SLOP = 3;

interface PlacedBadge {
  badge: EventBadge;
  x: number;
  y: number;
  label: string;
  extra: number;
}

/**
 * Small lettered discs along the bottom of the price pane (dividend, report,
 * capital, disclosure), stacked per bar. Hit-testable: the chart reports the
 * hovered badge as `hoveredInfo.objectId` = "event:<id>".
 */
export class EventBadgesPrimitive extends BasePrimitive {
  private badges: readonly EventBadge[] = [];
  private placed: PlacedBadge[] = [];
  private active: string | null = null;

  constructor(private style: EventBadgeStyle) {
    super("top");
  }

  setBadges(badges: readonly EventBadge[]): void {
    this.badges = badges;
    this.update();
  }

  setActive(id: string | null): void {
    if (this.active === id) return;
    this.active = id;
    this.update();
  }

  /** Centre of a badge in media coordinates of the pane (tooltip anchor). */
  positionOf(id: string): { x: number; y: number } | null {
    const hit = this.placed.find((placed) => placed.badge.id === id);
    return hit ? { x: hit.x, y: hit.y } : null;
  }

  /** Ids of the events stacked on the badge (a "+n" badge stands for the rest of its bar). */
  groupOf(id: string): string[] {
    const hit = this.placed.find((placed) => placed.badge.id === id);
    if (!hit) return [];
    if (hit.extra === 0) return [id];
    return this.badges.filter((badge) => badge.index === hit.badge.index).slice(BADGE_STACK - 1).map((badge) => badge.id);
  }

  hitTest(x: number, y: number): PrimitiveHoveredItem | null {
    for (const placed of this.placed) {
      if (Math.hypot(placed.x - x, placed.y - y) <= BADGE_RADIUS + HIT_SLOP) {
        return { externalId: `event:${placed.badge.id}`, zOrder: "top", cursorStyle: "pointer", itemType: "marker", hitTestPriority: 2 };
      }
    }
    return null;
  }

  protected render(target: Target): void {
    const host = this.host;
    this.placed = [];
    if (!host || this.badges.length === 0) return;
    const timeScale = host.chart.timeScale();
    target.useMediaCoordinateSpace(({ context, mediaSize }) => {
      const byIndex = new Map<number, EventBadge[]>();
      for (const badge of this.badges) {
        const list = byIndex.get(badge.index);
        if (list) list.push(badge);
        else byIndex.set(badge.index, [badge]);
      }
      const baseY = mediaSize.height - BADGE_RADIUS - 4;
      for (const [index, list] of byIndex) {
        const x = timeScale.logicalToCoordinate(index as Logical);
        if (x === null || x < -BADGE_RADIUS || x > mediaSize.width + BADGE_RADIUS) continue;
        const shown = list.length > BADGE_STACK ? list.slice(0, BADGE_STACK - 1) : list;
        shown.forEach((badge, i) => this.placed.push({ badge, x, y: baseY - i * (2 * BADGE_RADIUS + BADGE_GAP), label: badge.letter, extra: 0 }));
        if (list.length > BADGE_STACK) {
          const first = list[BADGE_STACK - 1];
          this.placed.push({
            badge: first,
            x,
            y: baseY - (BADGE_STACK - 1) * (2 * BADGE_RADIUS + BADGE_GAP),
            label: `+${list.length - (BADGE_STACK - 1)}`,
            extra: list.length - (BADGE_STACK - 1),
          });
        }
      }
      context.textAlign = "center";
      context.textBaseline = "middle";
      for (const placed of this.placed) {
        const active = placed.badge.id === this.active;
        context.beginPath();
        context.arc(placed.x, placed.y, BADGE_RADIUS, 0, Math.PI * 2);
        context.fillStyle = active ? placed.badge.color : this.style.card;
        context.fill();
        context.lineWidth = active ? 1.5 : 1.25;
        context.strokeStyle = placed.badge.color;
        context.stroke();
        context.fillStyle = active ? this.style.card : placed.badge.color;
        context.font = `600 ${placed.label.length > 1 ? 8 : 9}px ${this.style.font}`;
        context.fillText(placed.label, placed.x, placed.y + 0.5);
      }
    });
  }
}
