"use client";

import {
  Fragment,
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { Inbox, Plus } from "lucide-react";
import { toast } from "sonner";
import { ChartHeightContext, MIN_CARD_CHART_HEIGHT } from "@/components/charts/chart-height";
import { useMediaQuery } from "@/components/charts/use-coarse-pointer";
import { DEFAULT_TICKER } from "@/components/layout/nav";
import { SectionHeadingLevel } from "@/components/stock/heading-level";
import { StockIdentityScope } from "@/components/stock/identity-context";
import { Skeleton } from "@/components/ui/skeleton";
import { PanelProvider } from "@/components/workspace/panel";
import { beginPointerGesture, gestureResistance } from "@/components/workspace/pointer-gesture";
import { motionScrollBehavior, useMotionAllowed } from "@/hooks/use-motion-allowed";
import { cubicBezier, motionCurve, motionDuration } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { resolveOptions, widgetMeta, type WidgetCategory } from "./catalog";
import { LAZY_WIDGETS } from "./components";
import { hitTest, type DropHit, type MeasuredBoard } from "./drop";
import { EditBar } from "./EditBar";
import { useWidgetI18n } from "./i18n";
import {
  addWidget,
  canMoveStep,
  clampWidgetHeight,
  columnMinWidth,
  findWidget,
  freeWidth,
  GRID_COLUMNS,
  insertWidget,
  isNoopMove,
  MAX_WIDGETS,
  MAX_HEIGHT,
  MIN_WIDTH,
  moveWidget,
  moveWidgetStep,
  removeWidget,
  resizeColumn,
  setWidgetHeight,
  setWidgetWidth,
  updateWidget,
  widgetCount,
  widgetMinHeight,
  widgetsInOrder,
  type Column,
  type DropTarget,
  type Layout,
  type MoveDirection,
  type OptionValue,
  type WidgetInstance,
} from "./model";
import type { WidgetComponents } from "./types";
import type { LayoutEditor } from "./use-layout-editor";
import { WidgetFrame } from "./WidgetFrame";
import { WidgetGallery } from "./WidgetGallery";
import { WidgetScopeCards } from "./WidgetScopeCards";
import { addWidgetInScope, groupWidgetsByScope, rowScopes, type WidgetScope } from "./widget-scope";
import { WidgetSettingsDialog } from "./WidgetSettings";
import styles from "./widget-board.module.css";

/** Gap between rows, columns and stacked cards (gap-4). */
const GAP = 16;
/** Height step of the keyboard height handle. */
const HEIGHT_KEY_STEP = 40;
const MOVE_EASING = cubicBezier(motionCurve.easeOut);
const IGNORE_SPARE = () => {};

export type Breakpoint = "lg" | "xl";

/** Columns sit side by side from this breakpoint; below it every card is full width, in reading order. */
const GRID_CLASS: Record<Breakpoint, string> = { lg: "lg:grid-cols-12", xl: "xl:grid-cols-12" };
const SPAN_CLASS: Record<Breakpoint, string> = {
  lg: "lg:[grid-column:span_var(--span)/span_var(--span)]",
  xl: "xl:[grid-column:span_var(--span)/span_var(--span)]",
};
const RAIL_GRID_CLASS: Record<Breakpoint, string> = {
  lg: "lg:grid-cols-12 lg:grid-rows-[auto_1fr]",
  xl: "xl:grid-cols-12 xl:grid-rows-[auto_1fr]",
};
const RAIL_HEAD_CLASS: Record<Breakpoint, string> = {
  lg: "lg:[grid-column:1/span_var(--span)] lg:row-start-1 lg:row-span-1",
  xl: "xl:[grid-column:1/span_var(--span)] xl:row-start-1 xl:row-span-1",
};
const RAIL_SIDE_CLASS: Record<Breakpoint, string> = {
  lg: "lg:[grid-column:var(--start)/span_var(--span)] lg:row-start-1 lg:row-span-2",
  xl: "xl:[grid-column:var(--start)/span_var(--span)] xl:row-start-1 xl:row-span-2",
};
const RAIL_TAIL_CLASS: Record<Breakpoint, string> = {
  lg: "lg:[grid-column:1/span_var(--span)] lg:row-start-2 lg:row-span-1 lg:self-start",
  xl: "xl:[grid-column:1/span_var(--span)] xl:row-start-2 xl:row-span-1 xl:self-start",
};
const RAIL_FREE_CLASS: Record<Breakpoint, string> = {
  lg: "lg:[grid-column:var(--start)/span_var(--span)] lg:row-start-1 lg:row-span-2",
  xl: "xl:[grid-column:var(--start)/span_var(--span)] xl:row-start-1 xl:row-span-2",
};
const WIDE_QUERY: Record<Breakpoint, string> = { lg: "(min-width: 64rem)", xl: "(min-width: 80rem)" };

export interface BoardContext {
  /** Stock widgets without a ticker of their own show this one. */
  ticker?: string | null;
  /** Custom pages: a stock widget may follow its own ticker (settings, and a label on the card). */
  tickerOverrides?: boolean;
}

function spanStyle(span: number): CSSProperties {
  return { "--span": span } as CSSProperties;
}

function shallowEqual(a: Record<string, OptionValue> | undefined, b: Record<string, OptionValue> | undefined): boolean {
  if (a === b) return true;
  const keysA = Object.keys(a ?? {});
  const keysB = Object.keys(b ?? {});
  return keysA.length === keysB.length && keysA.every((key) => a?.[key] === b?.[key]);
}

// ---------------------------------------------------------------------------
// Widget content
// ---------------------------------------------------------------------------

function UnknownWidget() {
  const { t } = useWidgetI18n();
  return (
    <div className="card-surface flex min-h-24 items-center justify-center gap-2 p-4 text-[13px] text-muted-foreground">
      <Inbox aria-hidden className="size-4" />
      {t("widget.unknown")}
    </div>
  );
}

/** The card itself. Memoised: moving or resizing other widgets doesn't re-render it. */
const WidgetBody = memo(
  function WidgetBody({
    type,
    ticker,
    options,
    components,
  }: {
    type: string;
    ticker: string;
    options: Record<string, OptionValue> | undefined;
    components: WidgetComponents | undefined;
  }) {
    const meta = widgetMeta(type);
    const Component = components?.[type] ?? LAZY_WIDGETS[type];
    const resolved = useMemo(() => (meta ? resolveOptions(meta, options) : {}), [meta, options]);
    if (!meta || !Component) return <UnknownWidget />;
    const content = <Component ticker={ticker} options={resolved} />;
    return meta.stock ? <StockIdentityScope ticker={ticker}>{content}</StockIdentityScope> : content;
  },
  (a, b) => a.type === b.type && (a.ticker === b.ticker || !widgetMeta(a.type)?.stock) && a.components === b.components && shallowEqual(a.options, b.options),
);

/** Card-shaped stand-in for a widget below the fold that hasn't mounted yet. */
function LazyPlaceholder({ minHeight }: { minHeight: number }) {
  return (
    <div aria-hidden className="card-surface flex flex-col overflow-hidden" style={{ minHeight }}>
      <div className="flex h-12 shrink-0 items-center border-b border-border px-4">
        <Skeleton className="h-3 w-32" />
      </div>
      <div className="space-y-3.5 p-4">
        {[46, 62, 38, 56].map((width) => (
          <div key={width} className="flex items-center justify-between gap-6">
            <Skeleton className="h-3" style={{ width: `${width}%` }} />
            <Skeleton className="h-3 w-14 shrink-0" />
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Mounts a below-the-fold widget once it nears the viewport, so slow
 * fundamentals endpoints don't compete with the cards on screen (as the
 * stock pages' LazySection did).
 */
function LazyMount({
  minHeight,
  eager = false,
  emptyLabel,
  children,
}: {
  minHeight: number;
  eager?: boolean;
  emptyLabel?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const shown = visible || eager;

  useEffect(() => {
    const element = ref.current;
    if (!element || visible) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "600px 0px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [visible]);

  return (
    <div ref={ref} className="flex min-w-0 grow flex-col [&>*]:grow">
      {shown ? (
        <div
          data-widget-body
          data-empty-label={emptyLabel}
          className="flex min-w-0 grow flex-col [&>*]:grow empty:flex empty:min-h-12 empty:items-center empty:justify-center empty:text-xs empty:text-muted-foreground [&:empty:after]:content-[attr(data-empty-label)]"
        >
          {children}
        </div>
      ) : (
        <LazyPlaceholder minHeight={minHeight} />
      )}
    </div>
  );
}

/**
 * A chart card given a fixed height: measures the card's content at its
 * current plot height, and sets the plot to what fills the height exactly
 * (chrome = content − plot, so one step settles it), taller or shorter. At
 * the smallest plot the card scrolls.
 */
function FittedChart({
  height,
  basePlot,
  inert,
  children,
}: {
  height: number | null;
  basePlot: number;
  inert: boolean;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [plot, setPlot] = useState<number | null>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element || height === null) return;
    const observer = new ResizeObserver(() => {
      const natural = element.offsetHeight;
      setPlot((current) => {
        const shown = current ?? basePlot;
        const next = Math.max(MIN_CARD_CHART_HEIGHT, Math.round(height - (natural - shown)));
        return Math.abs(next - shown) <= 1 ? current : next;
      });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [height, basePlot]);

  return (
    // With a fixed height the wrapper keeps its content's own height (stretched,
    // it would always measure the slot and a taller slot could never grow the plot).
    <div ref={ref} inert={inert} className={cn("flex min-w-0 shrink-0 flex-col", height === null && "grow [&>*:last-child]:grow")}>
      <ChartHeightContext.Provider value={height === null ? null : plot}>{children}</ChartHeightContext.Provider>
    </div>
  );
}

type WidgetPanelProps = {
  type: string;
  ticker: string;
  options: Record<string, OptionValue> | undefined;
  components: WidgetComponents | undefined;
  height: number | undefined;
  columnWidth: number;
  slotted: boolean;
  wide: boolean;
  nested: boolean;
  eager: boolean;
  editing: boolean;
  emptyLabel: string | undefined;
};

/** A drop indicator or another card's resize never updates this card's context. */
const WidgetPanel = memo(function WidgetPanel({
  type, ticker, options, components, height, columnWidth, slotted, wide, nested, eager, editing, emptyLabel,
}: WidgetPanelProps) {
  const meta = widgetMeta(type);
  const fixed = height !== undefined;
  const body = <WidgetBody type={type} ticker={ticker} options={options} components={components} />;
  const inner = type === "general.heading" ? body : (
    <LazyMount eager={eager} minHeight={meta?.estimatedHeight ?? 240} emptyLabel={emptyLabel}>{body}</LazyMount>
  );
  const content = <SectionHeadingLevel level={nested ? 3 : 2}>{inner}</SectionHeadingLevel>;
  return (
    <div className={cn("flex min-w-0 grow flex-col", fixed && "min-h-0 overflow-y-auto rounded-2xl scrollbar-thin")}>
      <PanelProvider value={{
        fill: fixed && !meta?.plotHeight,
        columns: slotted ? (wide ? columnWidth / 2 : 6) : 0,
        rows: fixed ? Math.round((height + GAP) / 32) : 0,
        reportSpare: IGNORE_SPARE,
      }}>
        {meta?.plotHeight ? (
          <FittedChart height={height ?? null} basePlot={meta.plotHeight(resolveOptions(meta, options))} inert={editing}>
            {content}
          </FittedChart>
        ) : (
          <div inert={editing} className={cn("flex min-w-0 grow flex-col [&>*:last-child]:grow", fixed ? "min-h-0" : "shrink-0")}>
            {content}
          </div>
        )}
      </PanelProvider>
    </div>
  );
}, (a, b) => a.type === b.type && (a.ticker === b.ticker || !widgetMeta(a.type)?.stock) &&
  shallowEqual(a.options, b.options) && a.components === b.components && a.height === b.height &&
  a.columnWidth === b.columnWidth && a.slotted === b.slotted && a.wide === b.wide &&
  a.nested === b.nested && a.eager === b.eager && a.editing === b.editing && a.emptyLabel === b.emptyLabel);

// ---------------------------------------------------------------------------
// Board
// ---------------------------------------------------------------------------

interface DragView {
  widgetId: string;
  /** Pointer, viewport coordinates. */
  x: number;
  y: number;
  hit: DropHit | null;
  /** The board's top-left in page coordinates (drop lines are drawn relative to it). */
  origin: { left: number; top: number };
}

type ResizeView = { kind: "width"; columnId: string; width: number } | { kind: "height"; widgetId: string; height: number };

function measure(board: HTMLElement): MeasuredBoard {
  const sx = window.scrollX;
  const sy = window.scrollY;
  const box = (element: Element) => {
    const rect = element.getBoundingClientRect();
    return { top: rect.top + sy, bottom: rect.bottom + sy, left: rect.left + sx, right: rect.right + sx };
  };
  return {
    box: box(board),
    rows: Array.from(board.querySelectorAll<HTMLElement>(":scope > [data-row-id]")).map((row) => {
      const rawCols = Array.from(row.querySelectorAll<HTMLElement>(":scope > [data-col-id]")).map((column) => ({
        id: column.dataset.colId ?? "",
        box: box(column),
        widgets: Array.from(column.querySelectorAll<HTMLElement>(":scope > [data-widget-id]")).map((widget) => ({
          id: widget.dataset.widgetId ?? "",
          box: box(widget),
        })),
      }));
      const colMap = new Map<string, { id: string; box: ReturnType<typeof box>; widgets: { id: string; box: ReturnType<typeof box> }[] }>();
      const columns: { id: string; box: ReturnType<typeof box>; widgets: { id: string; box: ReturnType<typeof box> }[] }[] = [];
      for (const col of rawCols) {
        const existing = colMap.get(col.id);
        if (existing) {
          existing.box = {
            top: Math.min(existing.box.top, col.box.top),
            bottom: Math.max(existing.box.bottom, col.box.bottom),
            left: Math.min(existing.box.left, col.box.left),
            right: Math.max(existing.box.right, col.box.right),
          };
          existing.widgets.push(...col.widgets);
        } else {
          const entry = { id: col.id, box: { ...col.box }, widgets: [...col.widgets] };
          colMap.set(col.id, entry);
          columns.push(entry);
        }
      }
      return {
        id: row.dataset.rowId ?? "",
        box: box(row),
        columns,
      };
    }),
  };
}

/** Changing pointer coordinates alone never renders the board again. */
function sameDropHit(a: DropHit | null, b: DropHit | null): boolean {
  return a === b || (a !== null && b !== null &&
    JSON.stringify(a.target) === JSON.stringify(b.target) &&
    a.line.orientation === b.line.orientation && a.line.x === b.line.x &&
    a.line.y === b.line.y && a.line.length === b.line.length);
}

/**
 * Renders a widget layout and, while `editor.editing`, edits it:
 *
 * - drag a card (or its grip) to move it: into a stack, beside a column, or
 *   into a row of its own — a line shows where it lands; the page scrolls
 *   when the pointer nears the top or bottom edge; Escape cancels
 * - drag a column's right edge to change its width (snaps to twelfths), a
 *   card's bottom edge to fix its height (double-click: back to auto)
 * - the card menu does the same from the keyboard or a phone (width presets,
 *   heights, moves), plus settings and remove; the grip moves with the arrows
 * - "+" in a row's free room and at the end add widgets from the gallery
 *
 * Below `stackBelow` every card is full width in reading order; dragging and
 * the edge handles are wide-screen only there, the menu still works.
 */
export function WidgetBoard({
  editor,
  context = {},
  stackBelow = "lg",
  lazyFromRow = 3,
  stackedGap,
  galleryCategories,
  scopeSections = false,
  components,
  className,
}: {
  editor: LayoutEditor;
  /**
   * The page's own cards, imported by the page so they render on the server
   * as before; any other widget loads in the browser on demand.
   */
  components?: WidgetComponents;
  context?: BoardContext;
  stackBelow?: Breakpoint;
  /** Rows from this index mount their widgets when scrolled near. */
  lazyFromRow?: number;
  /** Gap between columns when stacked below breakpoint (e.g. 32). */
  stackedGap?: number;
  /** Gallery categories to list first (the page's own kind of widgets). */
  galleryCategories?: readonly WidgetCategory[];
  /** Personal pages keep stock-specific and general cards beneath permanent headings. */
  scopeSections?: boolean;
  className?: string;
}) {
  const { t } = useWidgetI18n();
  const { layout, editing, commit } = editor;
  const wide = useMediaQuery(WIDE_QUERY[stackBelow]);
  const interactive = editing && wide;
  // Cards arrange themselves by their slot once the page is the visitor's own
  // (custom pages always are). Entering edit mode alone changes nothing, so
  // what is edited is what was shown.
  const slotted = editor.customized || !editor.reset;
  const motionAllowed = useMotionAllowed();
  const pageTicker = context.ticker ?? DEFAULT_TICKER;

  const boardRef = useRef<HTMLDivElement>(null);
  const layoutRef = useRef(layout);
  const previousPositions = useRef<Map<string, DOMRect> | null>(null);
  const moves = useRef(new Map<HTMLElement, Animation>());
  const removalRef = useRef<{ toastId: string | number; json: string } | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  const focusAfterRef = useRef<string | null>(null);

  const [preview, setPreview] = useState<Layout | null>(null);
  const [drag, setDrag] = useState<DragView | null>(null);
  const [resize, setResize] = useState<ResizeView | null>(null);
  const [gallery, setGallery] = useState<{ open: boolean; target: DropTarget | null; width: number | null }>({ open: false, target: null, width: null });
  const [galleryScope, setGalleryScope] = useState<WidgetScope | "all">("all");
  const [settingsFor, setSettingsFor] = useState<string | null>(null);
  const [highlight, setHighlight] = useState<string | null>(null);
  // A counter, so the same message twice in a row is still read out.
  const [announcement, setAnnouncement] = useState({ text: "", n: 0 });
  const announce = useCallback((text: string) => setAnnouncement((previous) => ({ text, n: previous.n + 1 })), []);

  const shown = preview ?? layout;

  useEffect(() => {
    layoutRef.current = layout;
  }, [layout]);

  useEffect(() => {
    if (removalRef.current && JSON.stringify(layout) !== removalRef.current.json) {
      toast.dismiss(removalRef.current.toastId);
      removalRef.current = null;
    }
  }, [layout]);

  // Leaving edit mode (or unmounting) ends any drag or resize in progress.
  useEffect(() => {
    if (interactive) return;
    cleanupRef.current?.();
    cleanupRef.current = null;
  }, [interactive]);
  useEffect(() => () => cleanupRef.current?.(), []);

  const cancelMoves = useCallback(() => {
    for (const animation of moves.current.values()) animation.cancel();
    moves.current.clear();
  }, []);

  // Personal pages keep each scope's rows under its heading. Every change is
  // settled there before it is compared or saved, so a move that would only
  // cross into the other section is no move at all.
  const settle = useCallback((next: Layout) => (scopeSections ? groupWidgetsByScope(next, widgetMeta) : next), [scopeSections]);
  const commitLayout = useCallback((next: Layout) => commit(settle(next)), [commit, settle]);
  const changes = useCallback((next: Layout) => {
    const settled = settle(next);
    return settled !== layout && JSON.stringify(settled) !== JSON.stringify(layout);
  }, [layout, settle]);

  const commitMove = useCallback((next: Layout) => {
    const board = boardRef.current;
    if (board && motionAllowed && wide) {
      previousPositions.current = new Map(
        Array.from(board.querySelectorAll<HTMLElement>("[data-widget-id]"), (card) => [
          card.dataset.widgetId!,
          card.getBoundingClientRect(),
        ]),
      );
    }
    commitLayout(next);
  }, [commitLayout, motionAllowed, wide]);

  useLayoutEffect(() => {
    const before = previousPositions.current;
    previousPositions.current = null;
    if (!before && motionAllowed && wide) return;
    cancelMoves();
    if (!motionAllowed || !wide || !before) return;
    const cards = boardRef.current?.querySelectorAll<HTMLElement>("[data-widget-id]") ?? [];
    for (const card of cards) {
      const previous = before.get(card.dataset.widgetId!);
      if (!previous) continue;
      const current = card.getBoundingClientRect();
      const x = previous.left - current.left;
      const y = previous.top - current.top;
      if (Math.abs(x) < 0.5 && Math.abs(y) < 0.5) continue;
      const animation = card.animate(
        [{ translate: `${x}px ${y}px` }, { translate: "0px 0px" }],
        { duration: motionDuration.move, easing: MOVE_EASING },
      );
      moves.current.set(card, animation);
      animation.onfinish = () => moves.current.delete(card);
    }
  }, [cancelMoves, layout, motionAllowed, wide]);

  useEffect(() => cancelMoves, [cancelMoves]);

  // After a move, a removal or an undo the card re-mounts elsewhere (or is
  // gone): the grip named here gets the focus, and its card is scrolled into
  // view once it has glided to its new place.
  useEffect(() => {
    const id = focusAfterRef.current;
    if (!id) return;
    focusAfterRef.current = null;
    const grip = boardRef.current?.querySelector<HTMLElement>(`[data-grip="${CSS.escape(id)}"]`);
    if (!grip) return;
    grip.focus({ preventScroll: true });
    const card = grip.closest<HTMLElement>("[data-widget-id]");
    if (!card) return;
    const reveal = () => card.scrollIntoView({ block: "nearest", behavior: motionScrollBehavior() });
    const glide = moves.current.get(card);
    if (glide) glide.finished.then(reveal, () => {});
    else reveal();
  }, [layout]);

  // A widget just added: bring it into view and flash it.
  useEffect(() => {
    if (!highlight) return;
    boardRef.current?.querySelector(`[data-widget-id="${CSS.escape(highlight)}"]`)?.scrollIntoView({ behavior: motionScrollBehavior(), block: "center" });
    const timer = window.setTimeout(() => setHighlight(null), 1800);
    return () => window.clearTimeout(timer);
  }, [highlight]);

  const nameOf = useCallback(
    (widget: WidgetInstance | undefined) => {
      const meta = widget ? widgetMeta(widget.type) : undefined;
      return meta ? t(meta.name) : "";
    },
    [t],
  );

  // -------------------------------------------------------------------------
  // Drag to move
  // -------------------------------------------------------------------------

  const startDrag = useCallback(
    (event: ReactPointerEvent<HTMLElement>, widgetId: string, fromGrip: boolean) => {
      if (!interactive || !event.isPrimary || event.button !== 0 || !boardRef.current) return;
      // Touch drags only from the grip, so a finger on a card still scrolls the page.
      if (event.pointerType === "touch" && !fromGrip) return;
      if (event.pointerType !== "touch") event.preventDefault();
      if (fromGrip) event.currentTarget.focus({ preventScroll: true });
      cleanupRef.current?.();
      const board = boardRef.current;
      const base = layoutRef.current;
      const cell = board.querySelector<HTMLElement>(`[data-widget-id="${CSS.escape(widgetId)}"]`);
      if (!cell) return;
      const cellBox = cell.getBoundingClientRect();
      const boardBox = board.getBoundingClientRect();
      let measured: MeasuredBoard | null = null;
      let needsMeasure = true;
      let hit: DropHit | null = null;
      let observer: ResizeObserver | null = null;
      // On personal pages a line is only offered where the card would really land.
      const verdicts = new Map<string, boolean>();
      const lands = (target: DropTarget) => {
        if (!scopeSections) return true;
        const key = JSON.stringify(target);
        let verdict = verdicts.get(key);
        if (verdict === undefined) {
          const moved = moveWidget(base, widgetId, target);
          verdict = settle(moved) === moved;
          verdicts.set(key, verdict);
        }
        return verdict;
      };
      cleanupRef.current = beginPointerGesture(event, {
        mediaQuery: WIDE_QUERY[stackBelow],
        cursor: "grabbing",
        onStart: () => {
          cancelMoves();
          // Observe the boxes used for hit testing; late-loaded cards can resize
          // inside a row without changing the board's total height.
          observer = new ResizeObserver(() => { needsMeasure = true; });
          observer.observe(board);
          for (const element of board.querySelectorAll<HTMLElement>("[data-row-id], [data-col-id], [data-widget-id]")) observer.observe(element);
        },
        onFrame: ({ clientX, clientY, deltaX, deltaY }) => {
          if (needsMeasure || !measured) {
            // Transforms follow the pointer, but drop targets stay in their
            // original slots. Measure those slots even during a late resize.
            const previousX = cell.style.getPropertyValue("--drag-x");
            const previousY = cell.style.getPropertyValue("--drag-y");
            cell.style.removeProperty("--drag-x");
            cell.style.removeProperty("--drag-y");
            measured = measure(board);
            cell.style.setProperty("--drag-x", previousX);
            cell.style.setProperty("--drag-y", previousY);
            needsMeasure = false;
          }
          const next = hitTest(measured, clientX + window.scrollX, clientY + window.scrollY, GAP);
          hit = next && !isNoopMove(base, widgetId, next.target) && lands(next.target) ? next : null;
          cell.style.setProperty("--drag-x", `${gestureResistance(deltaX, boardBox.left - cellBox.left, boardBox.right - cellBox.right)}px`);
          cell.style.setProperty("--drag-y", `${gestureResistance(deltaY, boardBox.top - cellBox.top, boardBox.bottom - cellBox.top)}px`);
          const origin = { left: measured.box.left, top: measured.box.top };
          setDrag((shown) => shown?.widgetId === widgetId && sameDropHit(shown.hit, hit) &&
            shown.origin.left === origin.left && shown.origin.top === origin.top
            ? shown : { widgetId, x: clientX, y: clientY, hit, origin });
        },
        onFinish: (apply, started) => {
          observer?.disconnect();
          cleanupRef.current = null;
          setDrag(null);
          if (apply && started && hit) {
            const current = layoutRef.current;
            const next = moveWidget(current, widgetId, hit.target);
            if (next !== current) {
              if (fromGrip) focusAfterRef.current = widgetId;
              commitMove(next);
              announce(t("announce.moved", { name: nameOf(findWidget(current, widgetId)?.widget) }));
            }
          }
          // The glide (if any) has measured the dropped position: the card can let go of the pointer.
          cell.style.removeProperty("--drag-x");
          cell.style.removeProperty("--drag-y");
        },
      });
    },
    [announce, cancelMoves, commitMove, interactive, nameOf, scopeSections, settle, stackBelow, t],
  );

  // -------------------------------------------------------------------------
  // Resize handles — the same frame loop used by the page's Customize editor.
  // -------------------------------------------------------------------------

  const startColumnResize = useCallback(
    (event: ReactPointerEvent<HTMLElement>, column: Column) => {
      if (!interactive || !event.isPrimary || event.button !== 0 || !boardRef.current) return;
      event.preventDefault();
      event.stopPropagation();
      cleanupRef.current?.();
      const pitch = (boardRef.current.clientWidth + GAP) / GRID_COLUMNS;
      const base = layoutRef.current;
      let next = base;
      let previousWidth = column.width;
      cleanupRef.current = beginPointerGesture(event, {
        mediaQuery: WIDE_QUERY[stackBelow],
        cursor: "col-resize",
        autoScroll: false,
        onStart: () => {
          cancelMoves();
          setResize({ kind: "width", columnId: column.id, width: column.width });
        },
        onFrame: ({ deltaX }) => {
          const wanted = column.width + Math.round(deltaX / pitch);
          // Many pointer frames stay inside the same column: don't clone or
          // rerender the layout (and all its charts) for those frames.
          if (wanted === previousWidth) return;
          previousWidth = wanted;
          const candidate = resizeColumn(base, column.id, wanted);
          const width = candidate.rows.flatMap((row) => row.columns).find((c) => c.id === column.id)?.width ?? column.width;
          if (width === (next.rows.flatMap((row) => row.columns).find((c) => c.id === column.id)?.width ?? column.width)) return;
          next = candidate;
          setPreview(next === base ? null : next);
          setResize({ kind: "width", columnId: column.id, width });
        },
        onFinish: (apply) => {
          cleanupRef.current = null;
          setPreview(null);
          setResize(null);
          if (apply && next !== base) commitLayout(next);
        },
      });
    },
    [cancelMoves, commitLayout, interactive, stackBelow],
  );

  const startHeightResize = useCallback(
    (event: ReactPointerEvent<HTMLElement>, widgetId: string) => {
      if (!interactive || !event.isPrimary || event.button !== 0 || !boardRef.current) return;
      const cell = boardRef.current.querySelector<HTMLElement>(`[data-widget-id="${CSS.escape(widgetId)}"]`);
      if (!cell) return;
      event.preventDefault();
      event.stopPropagation();
      cleanupRef.current?.();
      const base = layoutRef.current;
      const startHeight = cell.getBoundingClientRect().height;
      let previousHeight = startHeight;
      let rawHeight = startHeight;
      let moved = false;
      let next = base;
      const widget = findWidget(base, widgetId)?.widget;
      if (!widget) return;
      const lowest = widgetMinHeight(widget);
      cleanupRef.current = beginPointerGesture(event, {
        mediaQuery: WIDE_QUERY[stackBelow],
        cursor: "row-resize",
        scrollRoom: () => ({ up: rawHeight > lowest, down: rawHeight < MAX_HEIGHT }),
        onStart: cancelMoves,
        onFrame: ({ deltaY }) => {
          if (!moved && Math.abs(deltaY) < 3) return;
          moved = true;
          rawHeight = startHeight + deltaY;
          const height = clampWidgetHeight(widget, rawHeight);
          if (height === previousHeight) return;
          previousHeight = height;
          next = setWidgetHeight(base, widgetId, height);
          setPreview(next === base ? null : next);
          setResize({ kind: "height", widgetId, height });
        },
        onFinish: (apply) => {
          cleanupRef.current = null;
          setPreview(null);
          setResize(null);
          if (apply && next !== base) commitLayout(next);
        },
      });
    },
    [cancelMoves, commitLayout, interactive, stackBelow],
  );

  // -------------------------------------------------------------------------
  // Commands (menu, keyboard, gallery)
  // -------------------------------------------------------------------------

  const canMove = useCallback(
    (widgetId: string, direction: MoveDirection) => canMoveStep(layout, widgetId, direction) && changes(moveWidgetStep(layout, widgetId, direction)),
    [changes, layout],
  );

  const moveStep = useCallback(
    (widgetId: string, direction: MoveDirection) => {
      const next = moveWidgetStep(layout, widgetId, direction);
      if (!changes(next)) return;
      focusAfterRef.current = widgetId;
      commitMove(next);
      announce(t("announce.moved", { name: nameOf(findWidget(layout, widgetId)?.widget) }));
    },
    [announce, changes, commitMove, layout, nameOf, t],
  );

  const setWidth = useCallback(
    (widgetId: string, width: number) => {
      const next = setWidgetWidth(layout, widgetId, width);
      if (!changes(next)) return;
      const before = findWidget(layout, widgetId);
      const after = findWidget(next, widgetId);
      // A width with no room beside the others moves the card to a row of its own.
      if (after && after.column.id !== before?.column.id) focusAfterRef.current = widgetId;
      commitMove(next);
      announce(t("announce.width", { name: nameOf(before?.widget), span: after?.column.width ?? width }));
    },
    [announce, changes, commitMove, layout, nameOf, t],
  );

  const setHeight = useCallback(
    (widgetId: string, height: number | null) => {
      const next = setWidgetHeight(layout, widgetId, height);
      if (next === layout) return;
      commitLayout(next);
      const value = findWidget(next, widgetId)?.widget.height;
      announce(t("announce.height", { name: nameOf(findWidget(layout, widgetId)?.widget), height: value === undefined ? t("height.autoShort") : t("height.px", { px: value }) }));
    },
    [announce, commitLayout, layout, nameOf, t],
  );

  const remove = useCallback(
    (widgetId: string) => {
      const name = nameOf(findWidget(layout, widgetId)?.widget);
      const next = removeWidget(layout, widgetId);
      // Focus goes on to the next card (or back to the previous one), not to the page.
      const order = widgetsInOrder(layout);
      const index = order.findIndex((widget) => widget.id === widgetId);
      focusAfterRef.current = (order[index + 1] ?? order[index - 1])?.id ?? null;
      commitLayout(next);
      const nextJson = JSON.stringify(next);
      if (removalRef.current) {
        toast.dismiss(removalRef.current.toastId);
      }
      const toastId = toast(t("widget.removed", { name }), {
        action: {
          label: t("edit.undo"),
          onClick: () => {
            if (JSON.stringify(layoutRef.current) === nextJson) {
              focusAfterRef.current = widgetId;
              editor.undo();
            }
          },
        },
      });
      removalRef.current = { toastId, json: nextJson };
    },
    [commitLayout, editor, layout, nameOf, t],
  );

  const onColumnKey = useCallback(
    (event: ReactKeyboardEvent<HTMLElement>, column: Column) => {
      const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
      if (!step) return;
      event.preventDefault();
      const next = resizeColumn(layout, column.id, column.width + step);
      if (next === layout) return;
      commitLayout(next);
      const width = next.rows.flatMap((row) => row.columns).find((c) => c.id === column.id)?.width ?? column.width;
      announce(t("announce.width", { name: nameOf(column.widgets[0]), span: width }));
    },
    [announce, commitLayout, layout, nameOf, t],
  );

  const onHeightKey = useCallback(
    (event: ReactKeyboardEvent<HTMLElement>, widget: WidgetInstance) => {
      if (event.key === "Home" || event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        setHeight(widget.id, null);
        return;
      }
      const step = event.key === "ArrowDown" ? HEIGHT_KEY_STEP : event.key === "ArrowUp" ? -HEIGHT_KEY_STEP : 0;
      if (!step) return;
      event.preventDefault();
      const cell = boardRef.current?.querySelector<HTMLElement>(`[data-widget-id="${CSS.escape(widget.id)}"]`);
      const current = widget.height ?? cell?.getBoundingClientRect().height ?? 400;
      setHeight(widget.id, current + step);
    },
    [setHeight],
  );

  const openGallery = useCallback((target: DropTarget | null = null, width: number | null = null, scope: WidgetScope | "all" = "all") => {
    setGalleryScope(scope);
    setGallery({ open: true, target, width });
  }, []);

  const pick = useCallback(
    (type: string) => {
      const meta = widgetMeta(type);
      if (!meta) return;
      if (widgetCount(layout) >= MAX_WIDGETS) {
        toast.error(t("gallery.full", { max: MAX_WIDGETS }));
        return;
      }
      const { target, width } = gallery;
      const added = target ? insertWidget(layout, { type }, width ?? meta.defaultWidth, target)
        : scopeSections ? addWidgetInScope(layout, { type }, meta.defaultWidth, widgetMeta, galleryScope === "all" ? undefined : galleryScope)
        : addWidget(layout, { type }, meta.defaultWidth);
      commitLayout(added.layout);
      setGallery({ open: false, target: null, width: null });
      setHighlight(added.id);
      announce(t("gallery.added", { name: t(meta.name) }));
    },
    [announce, commitLayout, gallery, galleryScope, layout, scopeSections, t],
  );

  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const widget of widgetsInOrder(layout)) map.set(widget.type, (map.get(widget.type) ?? 0) + 1);
    return map;
  }, [layout]);

  // Personal pages: the section each row is drawn under.
  const scopes = scopeSections ? rowScopes(shown, widgetMeta) : null;

  const settingsWidget = settingsFor ? (findWidget(layout, settingsFor)?.widget ?? null) : null;
  const total = widgetCount(shown);

  if (editor.pending) {
    return (
      <div className={cn("space-y-4", className)} aria-busy="true">
        <div>
          <LazyPlaceholder minHeight={360} />
        </div>
        <div className={cn("grid grid-cols-1 gap-4", GRID_CLASS[stackBelow])}>
          <div style={spanStyle(6)} className={SPAN_CLASS[stackBelow]}>
            <LazyPlaceholder minHeight={280} />
          </div>
          <div style={spanStyle(6)} className={SPAN_CLASS[stackBelow]}>
            <LazyPlaceholder minHeight={280} />
          </div>
        </div>
      </div>
    );
  }

  const weight = (widget: WidgetInstance) => {
    const meta = widgetMeta(widget.type);
    return widget.height !== undefined || meta?.rigid ? null : (meta?.grow ?? 1);
  };

  const renderColHandle = (column: Column) => {
    if (!interactive) return null;
    return (
      <>
        <div
          role="separator"
          aria-orientation="vertical"
          tabIndex={0}
          aria-label={t("resize.width", { name: nameOf(column.widgets[0]) })}
          aria-valuenow={column.width}
          aria-valuemin={columnMinWidth(column)}
          aria-valuemax={GRID_COLUMNS}
          aria-valuetext={t("width.value", { span: column.width })}
          onPointerDown={(event) => startColumnResize(event, column)}
          onKeyDown={(event) => onColumnKey(event, column)}
          className="group/handle absolute -right-[14px] bottom-0 top-0 z-20 flex w-3 cursor-col-resize touch-none items-center justify-center outline-none"
        >
          <span className="h-12 w-1 rounded-full bg-primary/35 transition-colors group-hover/handle:h-20 group-hover/handle:bg-primary group-focus-visible/handle:h-20 group-focus-visible/handle:bg-primary" />
        </div>
        {resize?.kind === "width" && resize.columnId === column.id ? (
          <span className="pointer-events-none absolute right-3 top-1/2 z-30 -translate-y-1/2 rounded-md bg-foreground px-2 py-0.5 font-mono text-[11px] font-medium tabular-nums text-background">
            {t("width.value", { span: resize.width })}
          </span>
        ) : null}
      </>
    );
  };

  const renderCard = (
    widget: WidgetInstance,
    grow: number,
    column: Column,
    nested: boolean,
    rowIndex: number,
  ) => {
    const meta = widgetMeta(widget.type);
    const ticker = (context.tickerOverrides ? widget.ticker : undefined) ?? pageTicker;
    const fixed = widget.height !== undefined;
    const name = nameOf(widget);
    const Icon = meta?.icon;
    const eager = rowIndex < lazyFromRow && widget.options?.lazy !== true;
    return (
      <div
        key={widget.id}
        data-widget-id={widget.id}
        data-dragging={drag?.widgetId === widget.id ? "" : undefined}
        style={{
          ...(fixed ? { height: widget.height } : { flexGrow: grow }),
          containerName: slotted ? "tile" : undefined,
          containerType: slotted ? (fixed ? "size" : "inline-size") : undefined,
        }}
        // While editing, room for the toolbar even on a one-line heading.
        className={cn(
          styles.card,
          "relative flex min-w-0 shrink-0 flex-col",
          editing ? "min-h-12 justify-end" : "[&:has([data-widget-body]:empty)]:hidden",
          meta?.snug && !editing && "-mb-1",
        )}
      >
        {meta?.stock && (context.ticker == null || ticker !== context.ticker) ? (
          <span className="pointer-events-none absolute left-3 top-0 z-[1] -translate-y-1/2 bg-background px-1 font-mono text-[10px] font-semibold tracking-wide text-muted-foreground">
            {t("board.stockFor", { ticker })}
          </span>
        ) : null}
        <WidgetPanel
          type={widget.type}
          ticker={ticker}
          options={widget.options}
          components={components}
          height={widget.height}
          columnWidth={column.width}
          slotted={slotted}
          wide={wide}
          // On a custom page every card sits under its section's heading.
          nested={nested || scopeSections}
          eager={eager}
          editing={editing}
          emptyLabel={editing ? t("board.noData") : undefined}
        />

        {editing ? (
          <WidgetFrame
            widgetId={widget.id}
            name={name}
            icon={Icon ? <Icon /> : null}
            columnWidth={column.width}
            height={widget.height}
            interactive={interactive}
            dragging={drag?.widgetId === widget.id}
            highlighted={highlight === widget.id}
            minWidth={columnMinWidth(column)}
            minHeight={widgetMinHeight(widget)}
            canMove={(direction) => canMove(widget.id, direction)}
            hasSettings={!!meta && ((meta.options?.length ?? 0) > 0 || (!!meta.stock && !!context.tickerOverrides))}
            onPointerDownSurface={(event) => startDrag(event, widget.id, false)}
            onPointerDownGrip={(event) => (interactive ? startDrag(event, widget.id, true) : undefined)}
            onMove={(direction) => moveStep(widget.id, direction)}
            onWidth={(width) => setWidth(widget.id, width)}
            onHeight={(height) => setHeight(widget.id, height)}
            onSettings={() => setSettingsFor(widget.id)}
            onRemove={() => remove(widget.id)}
          />
        ) : highlight === widget.id ? (
          <div aria-hidden className="pointer-events-none absolute inset-0 rounded-2xl ring-2 ring-primary" />
        ) : null}

        {interactive ? (
          <div
            role="separator"
            aria-orientation="horizontal"
            tabIndex={0}
            aria-label={t("resize.height", { name })}
            aria-valuenow={widget.height}
            aria-valuemin={widgetMinHeight(widget)}
            aria-valuemax={MAX_HEIGHT}
            aria-valuetext={fixed ? t("height.px", { px: widget.height ?? 0 }) : t("height.autoShort")}
            onPointerDown={(event) => startHeightResize(event, widget.id)}
            onDoubleClick={() => setHeight(widget.id, null)}
            onKeyDown={(event) => onHeightKey(event, widget)}
            className="group/handle absolute inset-x-0 -bottom-[14px] z-20 flex h-3 cursor-row-resize touch-none items-center justify-center outline-none"
          >
            <span className="h-1 w-12 rounded-full bg-primary/35 transition-colors group-hover/handle:w-20 group-hover/handle:bg-primary group-focus-visible/handle:w-20 group-focus-visible/handle:bg-primary" />
            {resize?.kind === "height" && resize.widgetId === widget.id ? (
              <span className="absolute -top-8 rounded-md bg-foreground px-2 py-0.5 font-mono text-[11px] font-medium tabular-nums text-background">
                {t("height.px", { px: resize.height })}
              </span>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  };

  const renderRows = (rows: Layout["rows"]) => rows.map((row) => {
    const rowIndex = shown.rows.indexOf(row);
    const free = freeWidth(row);
    const isRail = !!row.rail && row.columns.length === 2 && row.columns[0].widgets.length >= 2;

    if (isRail) {
      const [main, rail] = row.columns;
      let underHeadingRail = false;
      const anyGrowsRail = rail.widgets.some((widget) => (weight(widget) ?? 0) > 0);
      let underHeadingTail = main.widgets[0].type === "general.heading";
      return (
        <div key={row.id} data-row-id={row.id} className={cn("grid grid-cols-1 gap-4", RAIL_GRID_CLASS[stackBelow])}>
          <div
            key={`${main.id}-head`}
            data-col-id={main.id}
            style={spanStyle(main.width)}
            className={cn("relative flex min-w-0 flex-col gap-4", RAIL_HEAD_CLASS[stackBelow])}
          >
            {renderCard(main.widgets[0], 0, main, false, rowIndex)}
            {renderColHandle(main)}
          </div>

          <div
            key={rail.id}
            data-col-id={rail.id}
            style={{ ...spanStyle(rail.width), "--start": main.width + 1 } as CSSProperties}
            className={cn("relative flex min-w-0 flex-col gap-4", RAIL_SIDE_CLASS[stackBelow])}
          >
            {rail.widgets.map((widget) => {
              const isHeading = widget.type === "general.heading";
              const nested = underHeadingRail && !isHeading;
              if (isHeading) underHeadingRail = true;
              const share = weight(widget);
              const grow = share === null ? 0 : anyGrowsRail ? share : 1;
              return renderCard(widget, grow, rail, nested, rowIndex);
            })}
            {renderColHandle(rail)}
          </div>

          <div
            key={`${main.id}-tail`}
            data-col-id={main.id}
            style={spanStyle(main.width)}
            className={cn("relative flex min-w-0 flex-col gap-4", RAIL_TAIL_CLASS[stackBelow])}
          >
            {main.widgets.slice(1).map((widget) => {
              const isHeading = widget.type === "general.heading";
              const nested = underHeadingTail && !isHeading;
              if (isHeading) underHeadingTail = true;
              return renderCard(widget, 0, main, nested, rowIndex);
            })}
            {renderColHandle(main)}
          </div>

          {interactive && free >= MIN_WIDTH ? (
            <button
              type="button"
              style={{ ...spanStyle(free), "--start": main.width + rail.width + 1 } as CSSProperties}
              onClick={() => openGallery({ kind: "column", rowId: row.id, beforeColumnId: null }, free, scopes?.[rowIndex] ?? "all")}
              className={cn(
                "flex min-h-24 items-center justify-center gap-1.5 rounded-2xl border border-dashed border-border text-[12px] font-medium text-muted-foreground transition-colors hover:border-primary/60 hover:bg-primary/[0.04] hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring",
                RAIL_FREE_CLASS[stackBelow],
              )}
            >
              <Plus aria-hidden className="size-4" />
              {t("slot.add")}
            </button>
          ) : null}
        </div>
      );
    }

    const rowGapClass =
      stackedGap === 32
        ? stackBelow === "xl"
          ? "gap-x-4 gap-y-8 xl:gap-y-4"
          : "gap-x-4 gap-y-8 lg:gap-y-4"
        : "gap-4";

    return (
      <div key={row.id} data-row-id={row.id} className={cn("grid grid-cols-1", rowGapClass, GRID_CLASS[stackBelow])}>
        {row.columns.map((column) => {
          let underHeading = false;
          const anyGrows = column.widgets.some((widget) => (weight(widget) ?? 0) > 0);
          return (
            <div
              key={column.id}
              data-col-id={column.id}
              style={spanStyle(column.width)}
              className={cn("relative flex min-w-0 flex-col gap-4", SPAN_CLASS[stackBelow])}
            >
              {column.widgets.map((widget) => {
                const isHeading = widget.type === "general.heading";
                const nested = underHeading && !isHeading;
                if (isHeading) underHeading = true;
                const share = weight(widget);
                const grow = share === null ? 0 : anyGrows ? share : 1;
                return renderCard(widget, grow, column, nested, rowIndex);
              })}
              {renderColHandle(column)}
            </div>
          );
        })}

        {interactive && free >= MIN_WIDTH ? (
          <button
            type="button"
            style={spanStyle(free)}
            onClick={() => openGallery({ kind: "column", rowId: row.id, beforeColumnId: null }, free, scopes?.[rowIndex] ?? "all")}
            className={cn(
              "flex min-h-24 items-center justify-center gap-1.5 rounded-2xl border border-dashed border-border text-[12px] font-medium text-muted-foreground transition-colors hover:border-primary/60 hover:bg-primary/[0.04] hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring",
              SPAN_CLASS[stackBelow],
            )}
          >
            <Plus aria-hidden className="size-4" />
            {t("slot.add")}
          </button>
        ) : null}
      </div>
    );
  });

  return (
    <>
      <div ref={boardRef} className={cn("relative space-y-4", editing && "pb-28", className)} data-editing={editing ? "" : undefined}>
        {scopeSections ? (
          <>
            {shown.rows.length === 0 ? <WidgetScopeCards /> : null}
            {(["stock", "general"] as const).map((scope) => {
              const rows = shown.rows.filter((_, index) => scopes?.[index] === scope);
              return (
                <Fragment key={scope}>
                  <h2 data-scope-heading={scope} className="border-b border-border pb-2 pt-3 text-[15px] font-semibold tracking-tight text-foreground">
                    {t(`scope.${scope}`)}
                  </h2>
                  {renderRows(rows)}
                  {editing || rows.length === 0 ? (
                    <button
                      type="button"
                      onClick={() => {
                        editor.setEditing(true);
                        setGalleryScope(scope);
                        setGallery({ open: true, target: null, width: null });
                      }}
                      className="flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-border py-7 text-[13px] font-medium text-muted-foreground transition-colors hover:border-primary/60 hover:bg-primary/[0.04] hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
                    >
                      <Plus aria-hidden className="size-4" />
                      {t(`scope.${scope}Add`)}
                    </button>
                  ) : null}
                </Fragment>
              );
            })}
          </>
        ) : renderRows(shown.rows)}

        {!scopeSections && shown.rows.length === 0 && !editing ? (
          <div className="card-surface flex flex-col items-center gap-1.5 px-6 py-12 text-center">
            <Inbox aria-hidden className="size-5 text-muted-foreground" />
            <p className="text-[14px] font-medium text-foreground">{t("board.empty")}</p>
            <p className="max-w-sm text-[13px] text-muted-foreground">{t("board.emptyHint")}</p>
          </div>
        ) : null}

        {!scopeSections && editing && shown.rows.length === 0 ? (
          <WidgetScopeCards onPick={(scope) => {
            setGalleryScope(scope);
            setGallery({ open: true, target: null, width: null });
          }} />
        ) : null}

        {!scopeSections && editing ? (
          <button
            type="button"
            onClick={() => openGallery()}
            className="flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-border py-7 text-[13px] font-medium text-muted-foreground transition-colors hover:border-primary/60 hover:bg-primary/[0.04] hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
          >
            <Plus aria-hidden className="size-4" />
            {shown.rows.length === 0 ? t("board.emptyHint") : t("edit.add")}
          </button>
        ) : null}

        {drag?.hit ? <DropIndicator hit={drag.hit} origin={drag.origin} label={t("drop.newRow")} /> : null}

        <p className="sr-only" aria-live="polite">
          {announcement.text}
          {announcement.n % 2 ? "\u00a0" : ""}
        </p>
      </div>



      {editing ? <EditBar editor={editor} widgets={total} onAdd={() => openGallery()} hint={wide ? t("edit.hint") : t("edit.hintMobile")} /> : null}

      <WidgetGallery
        open={gallery.open}
        onClose={() => setGallery({ open: false, target: null, width: null })}
        onPick={pick}
        counts={counts}
        categories={galleryCategories}
        initialScope={galleryScope}
      />
      <WidgetSettingsDialog
        widget={settingsWidget}
        meta={settingsWidget ? widgetMeta(settingsWidget.type) : undefined}
        pageTicker={pageTicker}
        pageHasTicker={context.ticker != null}
        tickerOverrides={!!context.tickerOverrides}
        onSave={(patch) => settingsFor && commitLayout(updateWidget(layout, settingsFor, patch))}
        onClose={() => setSettingsFor(null)}
      />
    </>
  );
}

/** The line that shows where a dragged widget will land. */
function DropIndicator({ hit, origin, label }: { hit: DropHit; origin: { left: number; top: number }; label: string }) {
  const { line } = hit;
  const horizontal = line.orientation === "horizontal";
  const style: CSSProperties = horizontal
    ? { left: line.x - origin.left, top: line.y - origin.top - 2, width: line.length, height: 4 }
    : { left: line.x - origin.left - 2, top: line.y - origin.top, width: 4, height: line.length };
  return (
    <div aria-hidden className="pointer-events-none absolute z-30 rounded-full bg-primary" style={style}>
      {hit.target.kind === "row" ? (
        <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-md bg-primary px-2 py-0.5 text-[11px] font-semibold text-primary-foreground">
          {label}
        </span>
      ) : null}
    </div>
  );
}
