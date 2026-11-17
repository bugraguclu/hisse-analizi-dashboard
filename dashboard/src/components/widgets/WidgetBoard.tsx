"use client";

import {
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
  clampHeight,
  findWidget,
  freeWidth,
  GRID_COLUMNS,
  insertWidget,
  isNoopMove,
  MAX_WIDGETS,
  MIN_WIDTH,
  moveWidget,
  moveWidgetStep,
  removeWidget,
  resizeColumn,
  setWidgetHeight,
  setWidgetWidth,
  updateWidget,
  widgetCount,
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
import { WidgetSettingsDialog } from "./WidgetSettings";

/** Gap between rows, columns and stacked cards (gap-4). */
const GAP = 16;
/** Height step of the keyboard height handle. */
const HEIGHT_KEY_STEP = 40;
/** Distance from the viewport edge (px) where a drag scrolls the page. */
const SCROLL_EDGE = 72;
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
  (a, b) => a.type === b.type && a.ticker === b.ticker && a.components === b.components && shallowEqual(a.options, b.options),
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
 * A chart card given a fixed height: measures the card at its current plot
 * height, and sets the plot to what fills the height exactly (chrome = card −
 * plot, so one step settles it). At the smallest plot the card scrolls.
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
    <div ref={ref} inert={inert} className="flex min-w-0 shrink-0 grow flex-col [&>*:last-child]:grow">
      <ChartHeightContext.Provider value={height === null ? null : plot}>{children}</ChartHeightContext.Provider>
    </div>
  );
}

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

function lockCursor(cursor: string): () => void {
  const { style } = document.body;
  const previous = { cursor: style.cursor, userSelect: style.userSelect };
  style.cursor = cursor;
  style.userSelect = "none";
  return () => {
    style.cursor = previous.cursor;
    style.userSelect = previous.userSelect;
  };
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
  className?: string;
}) {
  const { t } = useWidgetI18n();
  const { layout, editing, commit } = editor;
  const wide = useMediaQuery(WIDE_QUERY[stackBelow]);
  const interactive = editing && wide;
  const slotted = editing || editor.customized || !editor.reset;
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
  const [settingsFor, setSettingsFor] = useState<string | null>(null);
  const [highlight, setHighlight] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");

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
    if (editing) return;
    cleanupRef.current?.();
    cleanupRef.current = null;
  }, [editing]);
  useEffect(() => () => cleanupRef.current?.(), []);

  const cancelMoves = useCallback(() => {
    for (const animation of moves.current.values()) animation.cancel();
    moves.current.clear();
  }, []);

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
    commit(next);
  }, [commit, motionAllowed, wide]);

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

  // After a keyboard move the widget re-mounts elsewhere: give its grip the focus back.
  useEffect(() => {
    const id = focusAfterRef.current;
    if (!id) return;
    focusAfterRef.current = null;
    boardRef.current?.querySelector<HTMLElement>(`[data-grip="${CSS.escape(id)}"]`)?.focus();
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
      if (event.button !== 0 || !boardRef.current) return;
      // Touch drags only from the grip, so a finger on a card still scrolls the page.
      if (event.pointerType === "touch" && !fromGrip) return;
      if (event.pointerType !== "touch") event.preventDefault();
      cleanupRef.current?.();

      const board = boardRef.current;
      const pointerId = event.pointerId;
      const startX = event.clientX;
      const startY = event.clientY;
      let pointerX = startX;
      let pointerY = startY;
      let started = false;
      let measured: MeasuredBoard | null = null;
      let hit: DropHit | null = null;
      let frame = 0;
      let unlock: (() => void) | null = null;
      let resizeObserver: ResizeObserver | null = null;

      const update = () => {
        if (!measured) return;
        const next = hitTest(measured, pointerX + window.scrollX, pointerY + window.scrollY, GAP);
        hit = next && !isNoopMove(layoutRef.current, widgetId, next.target) ? next : null;
        setDrag({ widgetId, x: pointerX, y: pointerY, hit, origin: { left: measured.box.left, top: measured.box.top } });
      };

      const onScroll = () => {
        update();
      };

      const autoScroll = () => {
        const height = window.innerHeight;
        const speed = pointerY < SCROLL_EDGE ? -(SCROLL_EDGE - pointerY) : pointerY > height - SCROLL_EDGE ? pointerY - (height - SCROLL_EDGE) : 0;
        if (speed !== 0) {
          window.scrollBy(0, Math.round(speed / 3));
          update();
        }
        frame = window.requestAnimationFrame(autoScroll);
      };

      const onMove = (move: PointerEvent) => {
        if (move.pointerId !== pointerId) return;
        if (move.buttons === 0) {
          finish(false);
          return;
        }
        pointerX = move.clientX;
        pointerY = move.clientY;
        if (!started) {
          if (Math.hypot(pointerX - startX, pointerY - startY) < 5) return;
          started = true;
          cancelMoves();
          measured = measure(board);
          resizeObserver = new ResizeObserver(() => {
            measured = measure(board);
            update();
          });
          resizeObserver.observe(board);
          window.addEventListener("scroll", onScroll, { passive: true });
          unlock = lockCursor("grabbing");
          frame = window.requestAnimationFrame(autoScroll);
        }
        move.preventDefault();
        update();
      };

      const finish = (drop: boolean) => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onCancel);
        window.removeEventListener("keydown", onKey, true);
        window.removeEventListener("blur", onBlur);
        window.removeEventListener("scroll", onScroll);
        resizeObserver?.disconnect();
        window.cancelAnimationFrame(frame);
        unlock?.();
        cleanupRef.current = null;
        setDrag(null);
        if (drop && started && hit) {
          const current = layoutRef.current;
          const next = moveWidget(current, widgetId, hit.target);
          if (next !== current) {
            commitMove(next);
            setAnnouncement(t("announce.moved", { name: nameOf(findWidget(current, widgetId)?.widget) }));
          }
        }
      };
      const onUp = (up: PointerEvent) => {
        if (up.pointerId === pointerId) finish(true);
      };
      const onCancel = (cancel: PointerEvent) => {
        if (cancel.pointerId === pointerId) finish(false);
      };
      const onKey = (key: KeyboardEvent) => {
        if (key.key !== "Escape") return;
        key.preventDefault();
        key.stopPropagation();
        finish(false);
      };
      const onBlur = () => finish(false);

      window.addEventListener("pointermove", onMove, { passive: false });
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onCancel);
      window.addEventListener("keydown", onKey, true);
      window.addEventListener("blur", onBlur);
      cleanupRef.current = () => finish(false);
    },
    [cancelMoves, commitMove, nameOf, t],
  );

  // -------------------------------------------------------------------------
  // Resize handles
  // -------------------------------------------------------------------------

  const startColumnResize = useCallback(
    (event: ReactPointerEvent<HTMLElement>, column: Column) => {
      if (event.button !== 0 || !boardRef.current) return;
      event.preventDefault();
      event.stopPropagation();
      cleanupRef.current?.();
      const pitch = (boardRef.current.clientWidth + GAP) / GRID_COLUMNS;
      const base = layoutRef.current;
      const pointerId = event.pointerId;
      const startX = event.clientX;
      let next = base;
      const unlock = lockCursor("col-resize");
      setResize({ kind: "width", columnId: column.id, width: column.width });

      const onMove = (move: PointerEvent) => {
        if (move.pointerId !== pointerId) return;
        if (move.buttons === 0) {
          finish(false);
          return;
        }
        next = resizeColumn(base, column.id, column.width + Math.round((move.clientX - startX) / pitch));
        setPreview(next === base ? null : next);
        const width = next.rows.flatMap((row) => row.columns).find((c) => c.id === column.id)?.width ?? column.width;
        setResize({ kind: "width", columnId: column.id, width });
      };
      const finish = (apply: boolean) => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onCancel);
        window.removeEventListener("keydown", onKey, true);
        window.removeEventListener("blur", onBlur);
        unlock();
        cleanupRef.current = null;
        setPreview(null);
        setResize(null);
        if (apply && next !== base) commit(next);
      };
      const onUp = (up: PointerEvent) => {
        if (up.pointerId === pointerId) finish(true);
      };
      const onCancel = (cancel: PointerEvent) => {
        if (cancel.pointerId === pointerId) finish(false);
      };
      const onKey = (key: KeyboardEvent) => {
        if (key.key !== "Escape") return;
        key.preventDefault();
        key.stopPropagation();
        finish(false);
      };
      const onBlur = () => finish(false);

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onCancel);
      window.addEventListener("keydown", onKey, true);
      window.addEventListener("blur", onBlur);
      cleanupRef.current = () => finish(false);
    },
    [commit],
  );

  const startHeightResize = useCallback(
    (event: ReactPointerEvent<HTMLElement>, widgetId: string) => {
      if (event.button !== 0 || !boardRef.current) return;
      const cell = boardRef.current.querySelector<HTMLElement>(`[data-widget-id="${CSS.escape(widgetId)}"]`);
      if (!cell) return;
      event.preventDefault();
      event.stopPropagation();
      cleanupRef.current?.();
      const base = layoutRef.current;
      const pointerId = event.pointerId;
      const startY = event.clientY;
      const startHeight = cell.getBoundingClientRect().height;
      let next = base;
      let moved = false;
      const unlock = lockCursor("row-resize");

      const onMove = (move: PointerEvent) => {
        if (move.pointerId !== pointerId) return;
        if (move.buttons === 0) {
          finish(false);
          return;
        }
        if (!moved && Math.abs(move.clientY - startY) < 3) return;
        moved = true;
        const height = clampHeight(startHeight + move.clientY - startY);
        next = setWidgetHeight(base, widgetId, height);
        setPreview(next);
        setResize({ kind: "height", widgetId, height });
      };
      const finish = (apply: boolean) => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onCancel);
        window.removeEventListener("keydown", onKey, true);
        window.removeEventListener("blur", onBlur);
        unlock();
        cleanupRef.current = null;
        setPreview(null);
        setResize(null);
        if (apply && moved && next !== base) commit(next);
      };
      const onUp = (up: PointerEvent) => {
        if (up.pointerId === pointerId) finish(true);
      };
      const onCancel = (cancel: PointerEvent) => {
        if (cancel.pointerId === pointerId) finish(false);
      };
      const onKey = (key: KeyboardEvent) => {
        if (key.key !== "Escape") return;
        key.preventDefault();
        key.stopPropagation();
        finish(false);
      };
      const onBlur = () => finish(false);

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onCancel);
      window.addEventListener("keydown", onKey, true);
      window.addEventListener("blur", onBlur);
      cleanupRef.current = () => finish(false);
    },
    [commit],
  );

  // -------------------------------------------------------------------------
  // Commands (menu, keyboard, gallery)
  // -------------------------------------------------------------------------

  const moveStep = useCallback(
    (widgetId: string, direction: MoveDirection) => {
      const next = moveWidgetStep(layout, widgetId, direction);
      if (next === layout) return;
      focusAfterRef.current = widgetId;
      commitMove(next);
      setAnnouncement(t("announce.moved", { name: nameOf(findWidget(layout, widgetId)?.widget) }));
    },
    [commitMove, layout, nameOf, t],
  );

  const setWidth = useCallback(
    (widgetId: string, width: number) => {
      commit(setWidgetWidth(layout, widgetId, width));
      setAnnouncement(t("announce.width", { name: nameOf(findWidget(layout, widgetId)?.widget), span: width }));
    },
    [commit, layout, nameOf, t],
  );

  const setHeight = useCallback(
    (widgetId: string, height: number | null) => {
      const next = setWidgetHeight(layout, widgetId, height);
      commit(next);
      const value = findWidget(next, widgetId)?.widget.height;
      setAnnouncement(t("announce.height", { name: nameOf(findWidget(layout, widgetId)?.widget), height: value === undefined ? t("height.autoShort") : t("height.px", { px: value }) }));
    },
    [commit, layout, nameOf, t],
  );

  const remove = useCallback(
    (widgetId: string) => {
      const name = nameOf(findWidget(layout, widgetId)?.widget);
      const next = removeWidget(layout, widgetId);
      commit(next);
      const nextJson = JSON.stringify(next);
      if (removalRef.current) {
        toast.dismiss(removalRef.current.toastId);
      }
      const toastId = toast(t("widget.removed", { name }), {
        action: {
          label: t("edit.undo"),
          onClick: () => {
            if (JSON.stringify(layoutRef.current) === nextJson) {
              editor.undo();
            }
          },
        },
      });
      removalRef.current = { toastId, json: nextJson };
    },
    [commit, editor, layout, nameOf, t],
  );

  const onColumnKey = useCallback(
    (event: ReactKeyboardEvent<HTMLElement>, column: Column) => {
      const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
      if (!step) return;
      event.preventDefault();
      const next = resizeColumn(layout, column.id, column.width + step);
      if (next === layout) return;
      commit(next);
      const width = next.rows.flatMap((row) => row.columns).find((c) => c.id === column.id)?.width ?? column.width;
      setAnnouncement(t("announce.width", { name: nameOf(column.widgets[0]), span: width }));
    },
    [commit, layout, nameOf, t],
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

  const openGallery = useCallback((target: DropTarget | null = null, width: number | null = null) => setGallery({ open: true, target, width }), []);

  const pick = useCallback(
    (type: string) => {
      const meta = widgetMeta(type);
      if (!meta) return;
      if (widgetCount(layout) >= MAX_WIDGETS) {
        toast.error(t("gallery.full", { max: MAX_WIDGETS }));
        return;
      }
      const { target, width } = gallery;
      const added = target ? insertWidget(layout, { type }, width ?? meta.defaultWidth, target) : addWidget(layout, { type }, meta.defaultWidth);
      commit(added.layout);
      setGallery({ open: false, target: null, width: null });
      setHighlight(added.id);
      setAnnouncement(t("gallery.added", { name: t(meta.name) }));
    },
    [commit, gallery, layout, t],
  );

  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const widget of widgetsInOrder(layout)) map.set(widget.type, (map.get(widget.type) ?? 0) + 1);
    return map;
  }, [layout]);

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
          aria-valuemin={MIN_WIDTH}
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
    const isHeading = widget.type === "general.heading";
    const ticker = (context.tickerOverrides ? widget.ticker : undefined) ?? pageTicker;
    const fixed = widget.height !== undefined;
    const name = nameOf(widget);
    const Icon = meta?.icon;
    const body = <WidgetBody type={widget.type} ticker={ticker} options={widget.options} components={components} />;
    const eager = rowIndex < lazyFromRow && widget.options?.lazy !== true;
    const inner = isHeading ? (
      body
    ) : (
      <LazyMount eager={eager} minHeight={meta?.estimatedHeight ?? 240} emptyLabel={editing ? t("board.noData") : undefined}>
        {body}
      </LazyMount>
    );
    const content = <SectionHeadingLevel level={nested ? 3 : 2}>{inner}</SectionHeadingLevel>;
    return (
      <div
        key={widget.id}
        data-widget-id={widget.id}
        style={{
          ...(fixed ? { height: widget.height } : { flexGrow: grow }),
          containerName: slotted ? "tile" : undefined,
          containerType: slotted ? (fixed ? "size" : "inline-size") : undefined,
        }}
        // While editing, room for the toolbar even on a one-line heading.
        className={cn(
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
        <div className={cn("flex min-w-0 grow flex-col", fixed && "min-h-0 overflow-y-auto rounded-2xl scrollbar-thin")}>
          <PanelProvider
            value={{
              fill: fixed && !meta?.plotHeight,
              columns: slotted ? (wide ? column.width / 2 : 6) : 0,
              rows: fixed ? Math.round((widget.height! + GAP) / 32) : 0,
              reportSpare: IGNORE_SPARE,
            }}
          >
            {meta?.plotHeight ? (
              <FittedChart height={widget.height ?? null} basePlot={meta.plotHeight(resolveOptions(meta, widget.options))} inert={editing}>
                {content}
              </FittedChart>
            ) : (
              <div inert={editing} className={cn("flex min-w-0 grow flex-col [&>*:last-child]:grow", fixed ? "min-h-0" : "shrink-0")}>
                {content}
              </div>
            )}
          </PanelProvider>
        </div>

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
            canMove={(direction) => canMoveStep(layout, widget.id, direction)}
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

  return (
    <>
      <div ref={boardRef} className={cn("relative space-y-4", editing && "pb-28", className)} data-editing={editing ? "" : undefined}>
        {shown.rows.map((row, rowIndex) => {
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
                    onClick={() => openGallery({ kind: "column", rowId: row.id, beforeColumnId: null }, free)}
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
                  onClick={() => openGallery({ kind: "column", rowId: row.id, beforeColumnId: null }, free)}
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
        })}

        {shown.rows.length === 0 && !editing ? (
          <div className="card-surface flex flex-col items-center gap-1.5 px-6 py-12 text-center">
            <Inbox aria-hidden className="size-5 text-muted-foreground" />
            <p className="text-[14px] font-medium text-foreground">{t("board.empty")}</p>
            <p className="max-w-sm text-[13px] text-muted-foreground">{t("board.emptyHint")}</p>
          </div>
        ) : null}

        {editing ? (
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
          {announcement}
        </p>
      </div>

      {drag ? <DragGhost drag={drag} widget={findWidget(layout, drag.widgetId)?.widget} name={nameOf(findWidget(layout, drag.widgetId)?.widget)} /> : null}

      {editing ? <EditBar editor={editor} widgets={total} onAdd={() => openGallery()} hint={wide ? t("edit.hint") : t("edit.hintMobile")} /> : null}

      <WidgetGallery
        open={gallery.open}
        onClose={() => setGallery({ open: false, target: null, width: null })}
        onPick={pick}
        counts={counts}
        categories={galleryCategories}
      />
      <WidgetSettingsDialog
        widget={settingsWidget}
        meta={settingsWidget ? widgetMeta(settingsWidget.type) : undefined}
        pageTicker={pageTicker}
        pageHasTicker={context.ticker != null}
        tickerOverrides={!!context.tickerOverrides}
        onSave={(patch) => settingsFor && commit(updateWidget(layout, settingsFor, patch))}
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

/** Follows the pointer during a drag: the widget's icon and name. */
function DragGhost({ drag, widget, name }: { drag: DragView; widget: WidgetInstance | undefined; name: string }) {
  const meta = widget ? widgetMeta(widget.type) : undefined;
  const Icon = meta?.icon;
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed left-0 top-0 z-[60] flex max-w-64 items-center gap-2 rounded-lg border border-border bg-popover px-3 py-2 text-[13px] font-medium text-popover-foreground shadow-[0_16px_40px_-12px_rgb(0_0_0/0.45)]"
      // Beside the pointer, flipped to its left near the right edge of the window.
      style={{ transform: `translate(${drag.x + 270 > window.innerWidth ? drag.x - 270 : drag.x + 14}px, ${drag.y + 14}px)` }}
    >
      {Icon ? <Icon className="size-4 shrink-0 text-muted-foreground" /> : null}
      <span className="truncate">{name}</span>
    </div>
  );
}
