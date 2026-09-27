/**
 * One lightweight-charts series primitive that renders every drawing of a
 * chart: shapes, the placement preview, hover/selection handles and their
 * price/time axis labels. The pointer layer (use-drawing-layer.ts) feeds it
 * state and uses its coordinate helpers, so rendering, hit testing and
 * gestures share one projection.
 *
 * Coordinates are pane-local CSS px ("media"); lines are stroked in bitmap
 * space so 1-px horizontals stay crisp at any devicePixelRatio. Prices go
 * through the series (priceToCoordinate respects log/percent scales).
 */

import type {
  IChartApiBase,
  IPrimitivePaneRenderer,
  IPrimitivePaneView,
  ISeriesApi,
  ISeriesPrimitive,
  ISeriesPrimitiveAxisView,
  Logical,
  PrimitiveHoveredItem,
  SeriesAttachedParameter,
  SeriesType,
  Time,
  UTCTimestamp,
} from "lightweight-charts";
import { getIntlLocale } from "@/lib/format";
import type { Locale } from "@/lib/i18n";
import { rgba, type ChartPalette, type Rgb } from "../colors";
import { formatBarTime } from "../time";
import type { ChartBar, IntervalKind } from "../types";
import {
  clipRay,
  clipSegment,
  createBarTimeMap,
  distanceToSegment,
  FIB_LEVELS,
  fibPrice,
  indexToX,
  pointInRect,
  snapPrice,
  xToIndex,
  type BarAxis,
  type BarTimeMap,
  type Box,
  type Segment,
} from "./geometry";
import type { Drawing, DrawingKind, DrawingPoint } from "./types";

type RenderTarget = Parameters<IPrimitivePaneRenderer["draw"]>[0];
type BitmapScope = Parameters<Parameters<RenderTarget["useBitmapCoordinateSpace"]>[0]>[0];
type MediaScope = Parameters<Parameters<RenderTarget["useMediaCoordinateSpace"]>[0]>[0];
type AnySeries = ISeriesApi<SeriesType, Time>;

/** What the pointer can do: nothing (measure tool), pick/drag drawings, or place a new one. */
export type DrawingInteraction = "none" | "select" | "place";

/** Everything the primitive draws with, except the drawings themselves (`setDrawings`). */
export interface DrawingSceneInput {
  bars: readonly ChartBar[];
  times: readonly UTCTimestamp[];
  interval: IntervalKind;
  intervalMinutes: number | null;
  palette: ChartPalette | null;
  visible: boolean;
  format: (value: number) => string;
  locale: Locale;
  selectedId: string | null;
  interaction: DrawingInteraction;
  /** Touch-first device: larger handles. */
  coarse: boolean;
}

export interface DrawingHover {
  id: string;
  handle: number | null;
}

export interface DrawingHit {
  id: string;
  kind: DrawingKind;
  /** Handle index, or null for the body. */
  handle: number | null;
  distance: number;
}

/** Where the edit bar of a drawing goes (pane px). */
export interface DrawingAnchor {
  x: number;
  top: number;
  bottom: number;
  paneWidth: number;
  paneHeight: number;
}

export interface PanePoint {
  x: number;
  y: number;
  /** Over the main pane's plot area (not an axis or an indicator pane). */
  inside: boolean;
}

export interface ProjectedPoint {
  /** Fractional bar position. */
  index: number;
  x: number;
  y: number;
}

/** Pointer hit radius around lines, in CSS px. */
export const HIT_RADIUS = { mouse: 6, touch: 12 } as const;

const PLACEMENT_ID = "drawing-placement";
const HANDLE_RADIUS = { mouse: 4, touch: 6 } as const;
/** Canvases clip anyway; the margin keeps line caps and handles at the very edge. */
const CLIP_MARGIN = 8;
const LABEL_FONT_SIZE = 10;
/** Distance between label centres before a lower-priority level label is dropped. */
const LABEL_MIN_GAP = 11;
/** Space between a retracement and its level labels. */
const LABEL_OFFSET = 6;
/** Fibonacci labels win space in this order when levels crowd together. */
const FIB_LABEL_PRIORITY: readonly number[] = [0, 1, 0.5, 0.618, 0.382, 0.236, 0.786];

interface TextLabel {
  x: number;
  y: number;
  text: string;
  align: CanvasTextAlign;
  baseline: CanvasTextBaseline;
}

interface Fill {
  left: number;
  top: number;
  right: number;
  bottom: number;
  alpha: number;
}

interface ShapeLayout {
  id: string;
  kind: DrawingKind;
  rgb: Rgb;
  dashed: boolean;
  /** 0 idle, 1 hovered, 2 selected / being edited. */
  emphasis: 0 | 1 | 2;
  lines: Segment[];
  /** Faint dashed diagonal of a Fibonacci retracement. */
  guide: Segment | null;
  fill: Fill | null;
  texts: TextLabel[];
  handles: { x: number; y: number }[];
  showHandles: boolean;
  /** Inside of a selected rectangle / retracement: grabbing it moves the drawing. */
  area: Fill | null;
}

interface LabelSpec {
  coordinate: number;
  text: string;
  color: string;
  background: string;
}

const EMPTY_INPUT: DrawingSceneInput = {
  bars: [],
  times: [],
  interval: "daily",
  intervalMinutes: null,
  palette: null,
  visible: true,
  format: (value) => String(value),
  locale: "tr",
  selectedId: null,
  interaction: "none",
  coarse: false,
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function colorOf(slot: number, palette: ChartPalette): Rgb {
  return slot >= 0 && slot < palette.series.length ? palette.series[slot] : palette.foreground;
}

const ratioFormats = new Map<string, Intl.NumberFormat>();
let measureContext: CanvasRenderingContext2D | null | undefined;

/** Width of `text` in the canvas label font (CSS px). */
function textWidth(text: string, font: string): number {
  measureContext ??= document.createElement("canvas").getContext("2d");
  if (!measureContext) return text.length * LABEL_FONT_SIZE * 0.6;
  measureContext.font = font;
  return measureContext.measureText(text).width;
}

function labelFont(palette: ChartPalette): string {
  return `${LABEL_FONT_SIZE}px ${palette.monoFamily}`;
}

/** 0.618 → "0,618" (tr) / "0.618" (en); 0.5 → "0,5". */
function formatRatio(value: number): string {
  const locale = getIntlLocale();
  let formatter = ratioFormats.get(locale);
  if (!formatter) {
    formatter = new Intl.NumberFormat(locale, { maximumFractionDigits: 3 });
    ratioFormats.set(locale, formatter);
  }
  return formatter.format(value);
}

/** Axis label whose values are refreshed in place (the library re-reads them on every paint). */
class AxisLabel implements ISeriesPrimitiveAxisView {
  private position = 0;
  private label = "";
  private foreground = "#fff";
  private background = "#000";

  set(spec: LabelSpec) {
    this.position = spec.coordinate;
    this.label = spec.text;
    this.foreground = spec.color;
    this.background = spec.background;
  }

  coordinate(): number {
    return this.position;
  }

  text(): string {
    return this.label;
  }

  textColor(): string {
    return this.foreground;
  }

  backColor(): string {
    return this.background;
  }
}

/** Same array while the number of labels is unchanged (the library caches views by array reference). */
function syncLabels(pool: AxisLabel[], current: readonly AxisLabel[], specs: readonly LabelSpec[]): readonly AxisLabel[] {
  while (pool.length < specs.length) pool.push(new AxisLabel());
  specs.forEach((spec, i) => pool[i].set(spec));
  return current.length === specs.length ? current : pool.slice(0, specs.length);
}

/** Crisp horizontal/vertical strokes: odd widths are centred on a pixel, even ones on a pixel edge. */
function strokeSegment(context: CanvasRenderingContext2D, segment: Segment, hr: number, vr: number, width: number) {
  let x1 = segment.x1 * hr;
  let y1 = segment.y1 * vr;
  let x2 = segment.x2 * hr;
  let y2 = segment.y2 * vr;
  const offset = width % 2 === 1 ? 0.5 : 0;
  if (segment.y1 === segment.y2) {
    y1 = Math.round(y1) + offset;
    y2 = y1;
  }
  if (segment.x1 === segment.x2) {
    x1 = Math.round(x1) + offset;
    x2 = x1;
  }
  context.beginPath();
  context.moveTo(x1, y1);
  context.lineTo(x2, y2);
  context.stroke();
}

function drawShapes({ context, horizontalPixelRatio: hr, verticalPixelRatio: vr }: BitmapScope, shapes: readonly ShapeLayout[]) {
  const base = Math.max(1, Math.floor(1.5 * hr));
  const strong = Math.max(base + 1, Math.round(2 * hr));
  context.save();
  context.lineCap = "butt";
  for (const shape of shapes) {
    if (shape.fill) {
      const left = Math.round(shape.fill.left * hr);
      const top = Math.round(shape.fill.top * vr);
      context.fillStyle = rgba(shape.rgb, shape.fill.alpha);
      context.fillRect(left, top, Math.round(shape.fill.right * hr) - left, Math.round(shape.fill.bottom * vr) - top);
    }
    const width = shape.emphasis > 0 ? strong : base;
    context.strokeStyle = rgba(shape.rgb);
    context.lineWidth = width;
    context.setLineDash(shape.dashed ? [5 * hr, 4 * hr] : []);
    for (const line of shape.lines) strokeSegment(context, line, hr, vr, width);
    if (shape.guide) {
      context.strokeStyle = rgba(shape.rgb, 0.55);
      context.lineWidth = base;
      context.setLineDash([3 * hr, 3 * hr]);
      strokeSegment(context, shape.guide, hr, vr, base);
    }
  }
  context.restore();
}

function drawTexts({ context }: MediaScope, shapes: readonly ShapeLayout[], palette: ChartPalette) {
  context.save();
  context.font = labelFont(palette);
  context.lineJoin = "round";
  context.lineWidth = 3;
  // A card-coloured halo keeps level labels legible over candles.
  context.strokeStyle = rgba(palette.card, 0.85);
  for (const shape of shapes) {
    if (shape.texts.length === 0) continue;
    context.fillStyle = rgba(shape.rgb);
    for (const label of shape.texts) {
      context.textAlign = label.align;
      context.textBaseline = label.baseline;
      context.strokeText(label.text, label.x, label.y);
      context.fillText(label.text, label.x, label.y);
    }
  }
  context.restore();
}

function drawHandles(
  { context, horizontalPixelRatio: hr, verticalPixelRatio: vr }: BitmapScope,
  shapes: readonly ShapeLayout[],
  palette: ChartPalette,
  radius: number,
) {
  context.save();
  context.setLineDash([]);
  context.lineWidth = Math.max(1, Math.round(1.5 * hr));
  context.fillStyle = rgba(palette.card);
  for (const shape of shapes) {
    if (!shape.showHandles) continue;
    context.strokeStyle = rgba(shape.rgb);
    for (const handle of shape.handles) {
      context.beginPath();
      context.arc(handle.x * hr, handle.y * vr, radius * hr, 0, Math.PI * 2);
      context.fill();
      context.stroke();
    }
  }
  context.restore();
}

function lineDistance(shape: ShapeLayout, x: number, y: number): number {
  let best = Infinity;
  for (const line of shape.lines) best = Math.min(best, distanceToSegment(x, y, line.x1, line.y1, line.x2, line.y2));
  if (shape.guide) best = Math.min(best, distanceToSegment(x, y, shape.guide.x1, shape.guide.y1, shape.guide.x2, shape.guide.y2));
  return best;
}

function cursorFor(hit: DrawingHit): string {
  if (hit.handle !== null) return "pointer";
  if (hit.kind === "hline") return "ns-resize";
  if (hit.kind === "vline") return "ew-resize";
  return "move";
}

/**
 * The drawing layer's series primitive (lightweight-charts v5 plugin API).
 * Attach with `series.attachPrimitive(primitive)`; re-attach to every new main
 * series. All state setters are cheap no-ops when nothing changed.
 */
export class DrawingPrimitive implements ISeriesPrimitive<Time> {
  private chart: IChartApiBase<Time> | null = null;
  private series: AnySeries | null = null;
  private requestRedraw: (() => void) | null = null;

  private input: DrawingSceneInput = EMPTY_INPUT;
  private drawings: readonly Drawing[] = [];
  private timeMap: BarTimeMap = createBarTimeMap([]);
  private transient: Drawing | null = null;
  private hover: DrawingHover | null = null;

  private dirty = true;
  private shapes: ShapeLayout[] = [];
  private paneWidth = 0;
  private paneHeight = 0;

  private readonly views: readonly IPrimitivePaneView[];
  private readonly pricePool: AxisLabel[] = [];
  private readonly timePool: AxisLabel[] = [];
  private priceLabels: readonly AxisLabel[] = [];
  private timeLabels: readonly AxisLabel[] = [];
  private layoutListener: (() => void) | null = null;

  constructor() {
    const renderer: IPrimitivePaneRenderer = { draw: (target) => this.draw(target) };
    // "top": above every series and indicator, repainted with the crosshair layer.
    this.views = [{ zOrder: () => "top", renderer: () => (this.shapes.length > 0 ? renderer : null) }];
  }

  // -------------------------------------------------------------------------
  // lightweight-charts lifecycle
  // -------------------------------------------------------------------------

  attached({ chart, series, requestUpdate }: SeriesAttachedParameter<Time>): void {
    this.chart = chart;
    this.series = series;
    this.requestRedraw = requestUpdate;
    // Attaching alone does not repaint the chart.
    this.invalidate();
  }

  detached(): void {
    this.chart = null;
    this.series = null;
    this.requestRedraw = null;
    this.shapes = [];
    this.priceLabels = [];
    this.timeLabels = [];
  }

  updateAllViews(): void {
    this.layout();
    this.layoutListener?.();
  }

  paneViews(): readonly IPrimitivePaneView[] {
    return this.views;
  }

  priceAxisViews(): readonly ISeriesPrimitiveAxisView[] {
    return this.priceLabels;
  }

  timeAxisViews(): readonly ISeriesPrimitiveAxisView[] {
    return this.timeLabels;
  }

  hitTest(x: number, y: number): PrimitiveHoveredItem | null {
    const { interaction, visible, palette } = this.input;
    if (!visible || !palette || !this.series) return null;
    if (interaction === "place") return { cursorStyle: "crosshair", externalId: PLACEMENT_ID, zOrder: "top" };
    if (interaction !== "select") return null;
    const hit = this.hit(x, y, HIT_RADIUS.mouse);
    if (!hit) return null;
    return {
      cursorStyle: cursorFor(hit),
      externalId: hit.id,
      zOrder: "top",
      distance: hit.distance,
      hitTestPriority: hit.handle !== null ? 2 : 1,
    };
  }

  // -------------------------------------------------------------------------
  // State (fed by the pointer layer)
  // -------------------------------------------------------------------------

  setScene(next: DrawingSceneInput): void {
    const previous = this.input;
    const keys = Object.keys(next) as (keyof DrawingSceneInput)[];
    if (keys.every((key) => previous[key] === next[key])) return;
    if (previous.bars !== next.bars || previous.intervalMinutes !== next.intervalMinutes || previous.interval !== next.interval) {
      const minutes = next.interval === "intraday" && next.intervalMinutes ? next.intervalMinutes * 60_000 : null;
      this.timeMap = createBarTimeMap(next.bars, minutes);
    }
    this.input = next;
    this.invalidate();
  }

  /** Stored drawings (from the store, or optimistically right after a commit). */
  setDrawings(drawings: readonly Drawing[]): void {
    if (this.drawings === drawings) return;
    this.drawings = drawings;
    this.invalidate();
  }

  /** The drawing being dragged or placed; replaces the stored one with the same id. */
  setTransient(drawing: Drawing | null): void {
    if (this.transient === drawing) return;
    this.transient = drawing;
    this.invalidate();
  }

  setHover(hover: DrawingHover | null): void {
    const current = this.hover;
    if (current === hover || (current && hover && current.id === hover.id && current.handle === hover.handle)) return;
    this.hover = hover;
    this.invalidate();
  }

  /** Called after every layout pass (viewport, data or state change). */
  setLayoutListener(listener: (() => void) | null): void {
    this.layoutListener = listener;
  }

  // -------------------------------------------------------------------------
  // Coordinates (pane-local CSS px)
  // -------------------------------------------------------------------------

  /** Pane-local position of a client (viewport) position. */
  clientToPane(clientX: number, clientY: number): PanePoint | null {
    const { chart, series } = this;
    if (!chart || !series) return null;
    try {
      const pane = series.getPane();
      const element = pane.getHTMLElement();
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      const x = clientX - rect.left - chart.priceScale("left", pane.paneIndex()).width();
      const y = clientY - rect.top;
      const inside = x >= 0 && x <= chart.timeScale().width() && y >= 0 && y <= pane.getHeight();
      return { x, y, inside };
    } catch {
      // The series was removed by a rebuild and the layer has not re-attached yet.
      return null;
    }
  }

  /**
   * Drawing point under pane position (x, y): on a whole bar (extrapolated past
   * the data), price optionally magnet-snapped to the bar's open/high/low/close.
   */
  pointAt(x: number, y: number, snap: boolean): { point: DrawingPoint; index: number } | null {
    const series = this.series;
    const axis = this.axis();
    if (!series || !axis) return null;
    try {
      const raw = xToIndex(axis, x);
      const price = series.coordinateToPrice(y);
      if (raw === null || price === null || !Number.isFinite(price)) return null;
      const index = Math.round(raw);
      const time = this.timeMap.toTime(index);
      if (time === null) return null;
      const bar = this.input.bars[index];
      const snapped = snap && bar ? snapPrice(bar, y, (value) => series.priceToCoordinate(value)) : null;
      return { point: { time, price: snapped ?? price }, index };
    } catch {
      return null;
    }
  }

  /** Whole bar position under pane x. */
  indexAt(x: number): number | null {
    const axis = this.axis();
    if (!axis) return null;
    const raw = xToIndex(axis, x);
    return raw === null ? null : Math.round(raw);
  }

  /** Price at pane y (log/percent aware). */
  priceAt(y: number): number | null {
    try {
      const price = this.series?.coordinateToPrice(y) ?? null;
      return price !== null && Number.isFinite(price) ? price : null;
    } catch {
      return null;
    }
  }

  /** Instant at a (fractional) bar position. */
  timeAt(index: number): number | null {
    return this.timeMap.toTime(index);
  }

  /** Where a stored point is drawn. */
  project(point: DrawingPoint): ProjectedPoint | null {
    const series = this.series;
    const axis = this.axis();
    if (!series || !axis) return null;
    try {
      const index = this.timeMap.toIndex(point.time);
      if (index === null) return null;
      const x = indexToX(axis, index);
      const y = series.priceToCoordinate(point.price);
      return x === null || y === null ? null : { index, x, y };
    } catch {
      return null;
    }
  }

  /** Put the crosshair on `price` at the bar nearest to `index`; returns that bar (null when unavailable). */
  showCrosshair(price: number, index: number): number | null {
    const { chart, series } = this;
    const count = Math.min(this.input.times.length, this.input.bars.length);
    if (!chart || !series || count === 0) return null;
    const bar = clamp(Math.round(index), 0, count - 1);
    try {
      chart.setCrosshairPosition(price, this.input.times[bar], series);
      return bar;
    } catch {
      return null;
    }
  }

  clearCrosshair(): void {
    try {
      this.chart?.clearCrosshairPosition();
    } catch {
      // Chart already disposed.
    }
  }

  // -------------------------------------------------------------------------
  // Hit testing
  // -------------------------------------------------------------------------

  /** Handle radius in CSS px. */
  handleRadius(): number {
    return this.input.coarse ? HANDLE_RADIUS.touch : HANDLE_RADIUS.mouse;
  }

  /**
   * Topmost drawing under (x, y): handles first (any drawing; the selected one
   * wins ties), then lines within `radius`, then the inside of the selected
   * rectangle / retracement.
   */
  hit(x: number, y: number, radius: number): DrawingHit | null {
    this.ensureLayout();
    if (!this.input.visible) return null;
    const selectedId = this.input.selectedId;
    const handleReach = Math.max(radius, this.handleRadius() + 3);
    let best: DrawingHit | null = null;
    let bestScore = Infinity;
    for (let s = this.shapes.length - 1; s >= 0; s -= 1) {
      const shape = this.shapes[s];
      const bias = shape.id === selectedId ? 2 : 0;
      for (let i = 0; i < shape.handles.length; i += 1) {
        const distance = Math.hypot(x - shape.handles[i].x, y - shape.handles[i].y);
        if (distance <= handleReach && distance - bias < bestScore) {
          best = { id: shape.id, kind: shape.kind, handle: i, distance };
          bestScore = distance - bias;
        }
      }
    }
    if (best) return best;
    for (let s = this.shapes.length - 1; s >= 0; s -= 1) {
      const shape = this.shapes[s];
      const distance = lineDistance(shape, x, y);
      const score = distance - (shape.id === selectedId ? 2 : 0);
      if (distance <= radius && score < bestScore) {
        best = { id: shape.id, kind: shape.kind, handle: null, distance };
        bestScore = score;
      }
    }
    if (best) return best;
    const selected = this.shapes.find((shape) => shape.id === selectedId);
    if (selected?.area && pointInRect(x, y, selected.area.left, selected.area.top, selected.area.right, selected.area.bottom)) {
      return { id: selected.id, kind: selected.kind, handle: null, distance: radius };
    }
    return null;
  }

  /** Box around the visible part of a drawing, for its edit bar; null when off screen. */
  anchorOf(id: string | null): DrawingAnchor | null {
    if (!id) return null;
    this.ensureLayout();
    const shape = this.shapes.find((candidate) => candidate.id === id);
    const width = this.paneWidth;
    const height = this.paneHeight;
    if (!shape || width <= 0 || height <= 0) return null;
    let points = shape.handles.filter((p) => p.x >= 0 && p.x <= width && p.y >= 0 && p.y <= height);
    if (points.length === 0) {
      points = shape.lines.flatMap((line) => [
        { x: line.x1, y: line.y1 },
        { x: line.x2, y: line.y2 },
      ]);
    }
    if (points.length === 0) return null;
    const xs = points.map((p) => clamp(p.x, 0, width));
    const ys = points.map((p) => clamp(p.y, 0, height));
    return {
      x: (Math.min(...xs) + Math.max(...xs)) / 2,
      top: Math.min(...ys),
      bottom: Math.max(...ys),
      paneWidth: width,
      paneHeight: height,
    };
  }

  // -------------------------------------------------------------------------
  // Layout
  // -------------------------------------------------------------------------

  private invalidate() {
    this.dirty = true;
    this.requestRedraw?.();
  }

  private ensureLayout() {
    if (this.dirty) this.layout();
  }

  /** Bar centres: read per bar through the time scale, so merged time points (comparison series) stay exact. */
  private axis(): BarAxis | null {
    const chart = this.chart;
    const { bars, times } = this.input;
    if (!chart || bars.length === 0) return null;
    try {
      const timeScale = chart.timeScale();
      const origin = timeScale.logicalToCoordinate(0 as Logical);
      const next = timeScale.logicalToCoordinate(1 as Logical);
      if (origin === null || next === null || !(next > origin)) return null;
      const step = next - origin;
      const byTime = times.length === bars.length && timeScale.timeToCoordinate(times[0]) !== null;
      return {
        count: bars.length,
        step,
        x: byTime ? (i) => timeScale.timeToCoordinate(times[i]) : (i) => origin + i * step,
      };
    } catch {
      return null;
    }
  }

  private layout(): void {
    this.dirty = false;
    const { chart, series } = this;
    const input = this.input;
    const palette = input.palette;
    const shapes: ShapeLayout[] = [];
    const priceSpecs: LabelSpec[] = [];
    const timeSpecs: LabelSpec[] = [];
    this.paneWidth = 0;
    this.paneHeight = 0;
    if (chart && series && palette && input.visible) {
      try {
        const width = chart.timeScale().width();
        const height = series.getPane().getHeight();
        const axis = this.axis();
        if (axis && width > 0 && height > 0) {
          this.paneWidth = width;
          this.paneHeight = height;
          for (const drawing of this.drawList()) {
            const shape = this.buildShape(drawing, axis, series, width, height, palette, priceSpecs, timeSpecs);
            if (shape) shapes.push(shape);
          }
        }
      } catch {
        shapes.length = 0;
        priceSpecs.length = 0;
        timeSpecs.length = 0;
      }
    }
    this.shapes = shapes;
    this.priceLabels = syncLabels(this.pricePool, this.priceLabels, priceSpecs);
    this.timeLabels = syncLabels(this.timePool, this.timeLabels, timeSpecs);
  }

  /** Stored drawings with the transient one swapped in; the selected / edited drawing is drawn last (on top). */
  private drawList(): Drawing[] {
    const transient = this.transient;
    const selectedId = this.input.selectedId;
    const list: Drawing[] = [];
    let selected: Drawing | null = null;
    for (const drawing of this.drawings) {
      if (transient && drawing.id === transient.id) continue;
      if (drawing.id === selectedId) selected = drawing;
      else list.push(drawing);
    }
    if (selected) list.push(selected);
    if (transient) list.push(transient);
    return list;
  }

  private buildShape(
    drawing: Drawing,
    axis: BarAxis,
    series: AnySeries,
    width: number,
    height: number,
    palette: ChartPalette,
    priceSpecs: LabelSpec[],
    timeSpecs: LabelSpec[],
  ): ShapeLayout | null {
    const input = this.input;
    const box: Box = { left: -CLIP_MARGIN, top: -CLIP_MARGIN, right: width + CLIP_MARGIN, bottom: height + CLIP_MARGIN };
    const projected = drawing.points.map((point) => {
      const index = this.timeMap.toIndex(point.time);
      return {
        x: index === null ? null : indexToX(axis, index),
        y: series.priceToCoordinate(point.price),
      };
    });
    const edited = this.transient?.id === drawing.id;
    const active = edited || drawing.id === input.selectedId;
    const hovered = this.hover?.id === drawing.id;
    const rgb = colorOf(drawing.color, palette);
    const shape: ShapeLayout = {
      id: drawing.id,
      kind: drawing.kind,
      rgb,
      dashed: drawing.dashed === true,
      emphasis: active ? 2 : hovered ? 1 : 0,
      lines: [],
      guide: null,
      fill: null,
      texts: [],
      handles: [],
      showHandles: active || hovered,
      area: null,
    };
    const labelColor = rgba(palette.card);
    const background = rgba(rgb);
    const timeStyle = input.interval === "intraday" ? "dayMonthTime" : "date";
    const priceLabel = (y: number, price: number) => {
      if (y >= 0 && y <= height) priceSpecs.push({ coordinate: y, text: input.format(price), color: labelColor, background });
    };
    const timeLabel = (x: number, time: number) => {
      if (x >= 0 && x <= width) timeSpecs.push({ coordinate: x, text: formatBarTime(time, timeStyle), color: labelColor, background });
    };
    const radius = this.handleRadius();

    if (drawing.kind === "hline") {
      const y = projected[0].y;
      if (y === null) return null;
      if (y >= box.top && y <= box.bottom) shape.lines.push({ x1: 0, y1: y, x2: width, y2: y });
      shape.handles.push({ x: clamp(projected[0].x ?? width / 2, radius + 2, width - radius - 2), y });
      priceLabel(y, drawing.points[0].price);
      return shape;
    }

    if (drawing.kind === "vline") {
      const x = projected[0].x;
      if (x === null) return null;
      if (x >= box.left && x <= box.right) shape.lines.push({ x1: x, y1: 0, x2: x, y2: height });
      shape.handles.push({ x, y: clamp(projected[0].y ?? height / 2, radius + 2, height - radius - 2) });
      timeLabel(x, drawing.points[0].time);
      return shape;
    }

    const [a, b] = projected;
    if (a.x === null || a.y === null || b.x === null || b.y === null) return null;
    const p1 = { x: a.x, y: a.y };
    const p2 = { x: b.x, y: b.y };
    shape.handles.push(p1, p2);
    if (active) {
      drawing.points.forEach((point, i) => {
        priceLabel(projected[i].y ?? -1, point.price);
        timeLabel(projected[i].x ?? -1, point.time);
      });
    }

    switch (drawing.kind) {
      case "trend": {
        const line = clipSegment(p1.x, p1.y, p2.x, p2.y, box);
        if (line) shape.lines.push(line);
        break;
      }
      case "ray": {
        const line = clipRay(p1.x, p1.y, p2.x, p2.y, box);
        if (line) shape.lines.push(line);
        break;
      }
      case "rect": {
        // Handles 2 and 3: the corners (first time, second price) and (second time, first price).
        shape.handles.push({ x: p1.x, y: p2.y }, { x: p2.x, y: p1.y });
        const corners: [number, number, number, number][] = [
          [p1.x, p1.y, p2.x, p1.y],
          [p2.x, p1.y, p2.x, p2.y],
          [p2.x, p2.y, p1.x, p2.y],
          [p1.x, p2.y, p1.x, p1.y],
        ];
        for (const [x1, y1, x2, y2] of corners) {
          const line = clipSegment(x1, y1, x2, y2, box);
          if (line) shape.lines.push(line);
        }
        const area = this.clippedArea(p1.x, p1.y, p2.x, p2.y, box, palette.dark ? 0.14 : 0.1);
        shape.fill = area;
        if (active) shape.area = area;
        break;
      }
      case "fib": {
        const left = Math.min(p1.x, p2.x);
        const right = Math.max(p1.x, p2.x);
        const from = Math.max(left, box.left);
        const to = Math.min(right, box.right);
        const levels: { level: number; y: number; price: number }[] = [];
        for (const level of FIB_LEVELS) {
          const price = fibPrice(drawing.points[0].price, drawing.points[1].price, level);
          const y = series.priceToCoordinate(price);
          if (y === null) continue;
          levels.push({ level, y, price });
          if (to > from && y >= box.top && y <= box.bottom) shape.lines.push({ x1: from, y1: y, x2: to, y2: y });
        }
        shape.guide = clipSegment(p1.x, p1.y, p2.x, p2.y, box);
        const area = this.clippedArea(left, p1.y, right, p2.y, box, palette.dark ? 0.08 : 0.06);
        shape.fill = area;
        if (active) shape.area = area;
        shape.texts = this.fibLabels(levels, left, right, width, height, palette);
        break;
      }
    }
    return shape;
  }

  private clippedArea(x1: number, y1: number, x2: number, y2: number, box: Box, alpha: number): Fill | null {
    const left = Math.max(Math.min(x1, x2), box.left);
    const right = Math.min(Math.max(x1, x2), box.right);
    const top = Math.max(Math.min(y1, y2), box.top);
    const bottom = Math.min(Math.max(y1, y2), box.bottom);
    return right > left && bottom > top ? { left, top, right, bottom, alpha } : null;
  }

  /**
   * "0,618 (301,25)" per level, centred on its line left of the retracement
   * (TradingView's default); on the right when the left edge is too close,
   * above the lines inside when neither side has room. Crowded levels keep the
   * most telling ratios.
   */
  private fibLabels(
    levels: readonly { level: number; y: number; price: number }[],
    left: number,
    right: number,
    width: number,
    height: number,
    palette: ChartPalette,
  ): TextLabel[] {
    if (right < 0 || left > width || levels.length === 0) return [];
    const font = labelFont(palette);
    const texts = levels.map((entry) => `${formatRatio(entry.level)} (${this.input.format(entry.price)})`);
    const widest = Math.max(...texts.map((text) => textWidth(text, font)));
    let x: number;
    let align: CanvasTextAlign = "left";
    let baseline: CanvasTextBaseline = "middle";
    let lift = 0;
    if (left - LABEL_OFFSET - widest >= 2) {
      x = left - LABEL_OFFSET;
      align = "right";
    } else if (right + LABEL_OFFSET + widest <= width - 2) {
      x = right + LABEL_OFFSET;
    } else {
      x = Math.max(left, 0) + LABEL_OFFSET;
      baseline = "bottom";
      lift = 3;
    }
    const half = LABEL_FONT_SIZE / 2;
    const placed: TextLabel[] = [];
    const taken: number[] = [];
    const order = levels
      .map((entry, i) => ({ ...entry, text: texts[i] }))
      .sort((p, q) => FIB_LABEL_PRIORITY.indexOf(p.level) - FIB_LABEL_PRIORITY.indexOf(q.level));
    for (const { y, text } of order) {
      const at = y - lift;
      const centre = baseline === "middle" ? at : at - half;
      if (centre < half + 1 || centre > height - half - 1) continue;
      if (taken.some((other) => Math.abs(other - centre) < LABEL_MIN_GAP)) continue;
      taken.push(centre);
      placed.push({ x, y: at, text, align, baseline });
    }
    return placed;
  }

  private draw(target: RenderTarget): void {
    const palette = this.input.palette;
    const shapes = this.shapes;
    if (!palette || shapes.length === 0) return;
    target.useBitmapCoordinateSpace((scope) => drawShapes(scope, shapes));
    target.useMediaCoordinateSpace((scope) => drawTexts(scope, shapes, palette));
    target.useBitmapCoordinateSpace((scope) => drawHandles(scope, shapes, palette, this.handleRadius()));
  }
}
