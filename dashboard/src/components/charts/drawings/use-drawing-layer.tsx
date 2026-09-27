"use client";

import {
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { useCoarsePointer } from "../use-coarse-pointer";
import { DrawingOverlay, OVERLAY_SELECTOR } from "./DrawingOverlay";
import { useDrawingI18n } from "./i18n";
import { DEFAULT_COLOR, drawingsEqual, isPlacementTool, MAX_DRAWINGS, moveHandle, pointCount } from "./model";
import { DrawingPrimitive, HIT_RADIUS, type DrawingAnchor, type DrawingInteraction, type ProjectedPoint } from "./primitive";
import { newDrawingId } from "./store";
import type { Drawing, DrawingKind, DrawingLayer, DrawingLayerOptions, DrawingPoint } from "./types";

/** Controls beyond the `DrawingLayer` contract, for a drawing toolbar next to the chart. */
export interface DrawingLayerControls extends DrawingLayer {
  /** Undo the last drawing change of this session (same as ⌘/Ctrl+Z on the plot). */
  undo: () => void;
  canUndo: boolean;
  /** Remove every drawing of the chart; undoable, unlike clearing the store directly. */
  clearAll: () => void;
}

/** A two-point tool waiting for its second point (click, move, click). */
interface Pending {
  kind: DrawingKind;
  start: DrawingPoint;
}

interface PressGesture {
  type: "press";
  pointerId: number;
  kind: DrawingKind;
  start: DrawingPoint;
  downX: number;
  downY: number;
  touch: boolean;
}

interface EditGesture {
  type: "edit";
  pointerId: number;
  /** The drawing when the gesture started (new drawings: their first shape). */
  base: Drawing;
  /** Latest shape, rendered by the primitive and committed on release. */
  current: Drawing;
  /** Handle being dragged, or null to move the whole drawing. */
  handle: number | null;
  isNew: boolean;
  moved: boolean;
  downX: number;
  downY: number;
  /** Whole bar under the pointer at the start: body drags move by whole bars. */
  downIndex: number | null;
  /** Where each point of `base` was drawn at the start. */
  origin: readonly (ProjectedPoint | null)[];
  touch: boolean;
}

type Gesture = PressGesture | EditGesture;

interface History {
  past: readonly (readonly Drawing[])[];
  /** The drawings this history leads to; any other list (symbol switch, other tab) invalidates it. */
  expected: readonly Drawing[] | null;
}

const EMPTY_HISTORY: History = { past: [], expected: null };
const MAX_UNDO = 50;
/** Movement (px) before a press becomes a drag. */
const DRAG_THRESHOLD = { mouse: 3, touch: 6 } as const;
const PREVIEW_ID = "drawing-preview";

/** Colour the viewer last chose per tool, for the next drawing of that tool (this page view). */
const lastColor = new Map<DrawingKind, number>();

function colorFor(kind: DrawingKind): number {
  return lastColor.get(kind) ?? DEFAULT_COLOR[kind];
}

function sameAnchor(a: DrawingAnchor | null, b: DrawingAnchor | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    Math.abs(a.x - b.x) < 0.5 &&
    Math.abs(a.top - b.top) < 0.5 &&
    Math.abs(a.bottom - b.bottom) < 0.5 &&
    a.paneWidth === b.paneWidth &&
    a.paneHeight === b.paneHeight
  );
}

/** Magnet on, unless Ctrl/⌘ flips it for this gesture (and the other way round). */
function snapWanted(magnet: boolean, event: { ctrlKey: boolean; metaKey: boolean }): boolean {
  return magnet !== (event.ctrlKey || event.metaKey);
}

/**
 * TradingView-style drawing tools on a FinancialChart: renders the drawings
 * through one series primitive, places new ones with the active tool, selects,
 * drags and edits them with the cursor, and handles Delete / Escape / ⌘Z.
 *
 * Pointer events are taken on the plot element in the capture phase, after
 * FinancialChart's measure handler (which marks its events `defaultPrevented`);
 * the library's own mouse/touch events are swallowed only while a gesture of
 * this layer is in progress, so panning and the crosshair work as before.
 * Changes are committed through `onDrawingsChange` once per gesture.
 */
export function useDrawingLayer(options: DrawingLayerOptions): DrawingLayerControls {
  const {
    mainSeries,
    plotRef,
    bars,
    times,
    interval,
    intervalMinutes,
    palette,
    locale,
    drawings,
    onDrawingsChange,
    tool,
    onToolChange,
    visible,
    magnet,
    format,
    onHoverIndex,
  } = options;
  const { t } = useDrawingI18n();
  const coarse = useCoarsePointer();
  const [primitive] = useState(() => new DrawingPrimitive());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [dragging, setDragging] = useState(false);
  const [anchor, setAnchor] = useState<DrawingAnchor | null>(null);
  const [history, setHistory] = useState<History>(EMPTY_HISTORY);
  const [seen, setSeen] = useState({ tool, visible });

  // Handlers read the latest interaction state from refs (pointer events outrun renders).
  const gestureRef = useRef<Gesture | null>(null);
  const pendingRef = useRef<Pending | null>(null);
  const selectedRef = useRef<string | null>(null);
  /** Drawings as last committed here or received from the store, whichever is newer. */
  const workingRef = useRef<readonly Drawing[]>(drawings);
  const lastGestureEndRef = useRef(Number.NEGATIVE_INFINITY);

  // A new tool or hiding the drawings ends a pending placement; a drawing tool also drops the selection.
  if (seen.tool !== tool || seen.visible !== visible) {
    setSeen({ tool, visible });
    setPending(null);
    if (isPlacementTool(tool) || !visible) setSelectedId(null);
  }

  const placing = isPlacementTool(tool) ? tool : null;
  const interaction: DrawingInteraction = !visible || tool === "measure" ? "none" : placing ? "place" : "select";
  const activePending = pending && visible && pending.kind === placing ? pending : null;
  const selectedDrawing =
    visible && tool === "cursor" && selectedId !== null ? (drawings.find((drawing) => drawing.id === selectedId) ?? null) : null;
  const effectiveSelectedId = selectedDrawing?.id ?? null;
  const busy = dragging || activePending !== null;
  const canUndo = useMemo(
    () => history.past.length > 0 && drawingsEqual(history.expected, drawings),
    [history, drawings],
  );

  // ---------------------------------------------------------------------------
  // Primitive: attach to the current main series, feed it state
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (!mainSeries) return;
    mainSeries.attachPrimitive(primitive);
    return () => {
      try {
        mainSeries.detachPrimitive(primitive);
      } catch {
        // The chart was disposed with the series.
      }
    };
  }, [mainSeries, primitive]);

  useEffect(() => {
    workingRef.current = drawings;
    primitive.setDrawings(drawings);
  }, [primitive, drawings]);

  useEffect(() => {
    selectedRef.current = effectiveSelectedId;
    pendingRef.current = activePending;
    primitive.setScene({
      bars,
      times,
      interval,
      intervalMinutes,
      palette,
      visible,
      format,
      locale,
      selectedId: effectiveSelectedId,
      interaction,
      coarse,
    });
    // A placement preview without a placement (tool switched away) goes too.
    if (!gestureRef.current && !activePending) primitive.setTransient(null);
  }, [primitive, bars, times, interval, intervalMinutes, palette, visible, format, locale, effectiveSelectedId, interaction, coarse, activePending]);

  // The edit bar follows the selected drawing through pans, zooms and resizes (every layout pass).
  useEffect(() => {
    let frame = 0;
    primitive.setLayoutListener(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        // Hidden while dragging; the release commits and lays out again.
        if (gestureRef.current) return;
        const next = primitive.anchorOf(selectedRef.current);
        setAnchor((previous) => (sameAnchor(previous, next) ? previous : next));
      });
    });
    return () => {
      cancelAnimationFrame(frame);
      primitive.setLayoutListener(null);
    };
  }, [primitive]);

  // ---------------------------------------------------------------------------
  // Commands
  // ---------------------------------------------------------------------------

  function apply(next: Drawing[]) {
    workingRef.current = next;
    primitive.setDrawings(next);
    onDrawingsChange(next);
  }

  /** Store a change and remember the previous list for undo. */
  function commit(next: Drawing[]) {
    const current = workingRef.current;
    if (drawingsEqual(current, next)) return;
    setHistory((previous) => ({
      past: [...(drawingsEqual(previous.expected, current) ? previous.past : []), current].slice(-MAX_UNDO),
      expected: next,
    }));
    apply(next);
  }

  function select(id: string | null) {
    selectedRef.current = id;
    setSelectedId(id);
  }

  function setPendingPlacement(next: Pending | null) {
    pendingRef.current = next;
    setPending(next);
  }

  /** `timeStamp`: of the ending event, for the double-tap guard. */
  function endGesture(timeStamp: number) {
    gestureRef.current = null;
    lastGestureEndRef.current = timeStamp;
    setDragging(false);
  }

  /** Abort a drag (the drawing snaps back) or a placement; false when nothing was in progress. */
  function cancelInteraction(timeStamp = Number.NEGATIVE_INFINITY): boolean {
    const hadGesture = gestureRef.current !== null;
    if (!hadGesture && !pendingRef.current) return false;
    if (hadGesture) {
      endGesture(timeStamp);
      primitive.clearCrosshair();
      onHoverIndex?.(null);
    }
    setPendingPlacement(null);
    primitive.setTransient(null);
    return true;
  }

  function undo(): boolean {
    if (gestureRef.current || history.past.length === 0 || !drawingsEqual(history.expected, workingRef.current)) return false;
    const previous = history.past[history.past.length - 1];
    setHistory({ past: history.past.slice(0, -1), expected: previous });
    apply([...previous]);
    return true;
  }

  function removeSelected(): boolean {
    const id = selectedRef.current;
    if (!id || gestureRef.current) return false;
    const next = workingRef.current.filter((drawing) => drawing.id !== id);
    if (next.length === workingRef.current.length) return false;
    commit(next);
    select(null);
    return true;
  }

  function updateSelected(update: (drawing: Drawing) => Drawing) {
    const id = selectedRef.current;
    if (!id) return;
    commit(workingRef.current.map((drawing) => (drawing.id === id ? update(drawing) : drawing)));
  }

  function clearAll() {
    cancelInteraction();
    if (workingRef.current.length === 0) return;
    commit([]);
    select(null);
  }

  function onKeyDown(event: ReactKeyboardEvent<HTMLElement>): boolean {
    const modifier = event.metaKey || event.ctrlKey;
    let handled = false;
    if (modifier && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "z") {
      handled = undo();
    } else if (!modifier && !event.altKey) {
      if (event.key === "Escape") {
        if (cancelInteraction(event.timeStamp)) handled = true;
        else if (placing) {
          onToolChange("cursor");
          handled = true;
        } else if (selectedRef.current) {
          select(null);
          handled = true;
        }
      } else if (event.key === "Delete" || event.key === "Backspace") {
        handled = removeSelected();
      }
    }
    // Handled keys stop here (an Escape must not also close the full-screen dialog).
    if (handled) event.preventDefault();
    return handled;
  }

  // ---------------------------------------------------------------------------
  // Pointer gestures
  // ---------------------------------------------------------------------------

  function startEdit(pointerId: number, drawing: Drawing, handle: number | null, isNew: boolean, x: number, y: number, touch: boolean) {
    gestureRef.current = {
      type: "edit",
      pointerId,
      base: drawing,
      current: drawing,
      handle,
      isNew,
      // A new drawing is committed even without movement; a click on an existing one only selects it.
      moved: isNew,
      downX: x,
      downY: y,
      downIndex: primitive.indexAt(x),
      origin: drawing.points.map((point) => primitive.project(point)),
      touch,
    };
    primitive.setHover(null);
    primitive.setTransient(drawing);
    setDragging(true);
  }

  /** Crosshair + legend follow the edited point while the chart does not see the pointer. */
  function followCrosshair(price: number, index: number | null) {
    const bar = index === null ? null : primitive.showCrosshair(price, index);
    if (bar !== null) onHoverIndex?.(bar);
  }

  const onPlotPointerDown = useEffectEvent((event: PointerEvent) => {
    if (event.defaultPrevented || gestureRef.current || interaction === "none") return;
    if (!event.isPrimary || event.button !== 0) return;
    if (event.target instanceof Element && event.target.closest(OVERLAY_SELECTOR)) return;
    // Shift + drag is the chart's measure gesture.
    if (interaction === "select" && event.shiftKey) return;
    const local = primitive.clientToPane(event.clientX, event.clientY);
    if (!local?.inside) return;
    const touch = event.pointerType !== "mouse";

    if (placing) {
      const at = primitive.pointAt(local.x, local.y, snapWanted(magnet, event));
      if (!at) return;
      // Ours: no compatibility mouse events, so the chart neither pans nor sees a click.
      event.preventDefault();
      plotRef.current?.focus({ preventScroll: true });
      const waiting = pendingRef.current;
      if (pointCount(placing) === 1) {
        startEdit(event.pointerId, { id: newDrawingId(), kind: placing, points: [at.point], color: colorFor(placing) }, 0, true, local.x, local.y, touch);
      } else if (waiting && waiting.kind === placing) {
        const drawing: Drawing = { id: newDrawingId(), kind: placing, points: [waiting.start, at.point], color: colorFor(placing) };
        startEdit(event.pointerId, drawing, 1, true, local.x, local.y, touch);
      } else {
        gestureRef.current = { type: "press", pointerId: event.pointerId, kind: placing, start: at.point, downX: local.x, downY: local.y, touch };
        primitive.setTransient({ id: PREVIEW_ID, kind: placing, points: [at.point, at.point], color: colorFor(placing) });
        setDragging(true);
      }
      followCrosshair(at.point.price, at.index);
      return;
    }

    const hit = primitive.hit(local.x, local.y, touch ? HIT_RADIUS.touch : HIT_RADIUS.mouse);
    const drawing = hit ? workingRef.current.find((candidate) => candidate.id === hit.id) : undefined;
    if (!hit || !drawing) {
      // Empty space: drop the selection and let the chart pan as usual.
      if (selectedRef.current) select(null);
      return;
    }
    event.preventDefault();
    plotRef.current?.focus({ preventScroll: true });
    select(drawing.id);
    startEdit(event.pointerId, drawing, hit.handle, false, local.x, local.y, touch);
  });

  const onPlotPointerMove = useEffectEvent((event: PointerEvent) => {
    if (gestureRef.current) return;
    const overOverlay = event.target instanceof Element && event.target.closest(OVERLAY_SELECTOR) !== null;
    const local = overOverlay ? null : primitive.clientToPane(event.clientX, event.clientY);
    const waiting = pendingRef.current;
    if (waiting && waiting.kind === placing) {
      // Click-move-click placement: the second point follows the pointer.
      const at = local?.inside ? primitive.pointAt(local.x, local.y, snapWanted(magnet, event)) : null;
      if (at) primitive.setTransient({ id: PREVIEW_ID, kind: waiting.kind, points: [waiting.start, at.point], color: colorFor(waiting.kind) });
      return;
    }
    // No hover while a button is down (the chart pans, or Shift + drag measures).
    if (interaction !== "select" || event.pointerType !== "mouse" || event.buttons !== 0) return;
    const hit = local?.inside ? primitive.hit(local.x, local.y, HIT_RADIUS.mouse) : null;
    primitive.setHover(hit ? { id: hit.id, handle: hit.handle } : null);
  });

  const onPlotPointerLeave = useEffectEvent(() => primitive.setHover(null));

  const onWindowPointerMove = useEffectEvent((event: PointerEvent) => {
    let gesture = gestureRef.current;
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    const local = primitive.clientToPane(event.clientX, event.clientY);
    if (!local) return;
    const threshold = gesture.touch ? DRAG_THRESHOLD.touch : DRAG_THRESHOLD.mouse;
    const travelled = Math.hypot(local.x - gesture.downX, local.y - gesture.downY);
    const snap = snapWanted(magnet, event);

    if (gesture.type === "press") {
      if (travelled < threshold) return;
      // Press-and-drag placement: the second point follows until release.
      const drawing: Drawing = { id: newDrawingId(), kind: gesture.kind, points: [gesture.start, gesture.start], color: colorFor(gesture.kind) };
      startEdit(gesture.pointerId, drawing, 1, true, gesture.downX, gesture.downY, gesture.touch);
      gesture = gestureRef.current;
      if (!gesture || gesture.type !== "edit") return;
    }
    if (!gesture.moved && travelled < threshold) return;

    let next: Drawing = gesture.current;
    if (gesture.handle !== null) {
      const at = primitive.pointAt(local.x, local.y, snap);
      if (!at) return;
      next = moveHandle(gesture.base, gesture.handle, at.point);
      followCrosshair(at.point.price, at.index);
    } else {
      // Whole drawing: whole bars horizontally, pixels vertically (log / % scales keep the shape).
      const index = primitive.indexAt(local.x);
      const shift = index !== null && gesture.downIndex !== null ? index - gesture.downIndex : 0;
      const dy = local.y - gesture.downY;
      const origin = gesture.origin;
      const points = gesture.base.points.map((point, i) => {
        const from = origin[i];
        if (!from) return point;
        const time = primitive.timeAt(from.index + shift);
        const price = primitive.priceAt(from.y + dy);
        return time === null || price === null ? point : { time, price };
      });
      next = { ...gesture.base, points };
      const price = primitive.priceAt(local.y);
      if (price !== null) followCrosshair(price, index);
    }
    gestureRef.current = { ...gesture, moved: true, current: next };
    primitive.setTransient(next);
  });

  const onWindowPointerEnd = useEffectEvent((event: PointerEvent, cancelled: boolean) => {
    const gesture = gestureRef.current;
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    endGesture(event.timeStamp);
    const local = primitive.clientToPane(event.clientX, event.clientY);
    // Touch has no hover to hand the crosshair back to; a release outside the pane leaves nothing to track.
    if (gesture.touch || !local?.inside) {
      primitive.clearCrosshair();
      onHoverIndex?.(null);
    }
    if (cancelled) {
      setPendingPlacement(null);
      primitive.setTransient(null);
      return;
    }
    if (gesture.type === "press") {
      // A click: wait for the second point.
      setPendingPlacement({ kind: gesture.kind, start: gesture.start });
      return;
    }
    const drawing = gesture.current;
    if (gesture.isNew) {
      const [a, b] = drawing.points.map((point) => primitive.project(point));
      const degenerate = drawing.points.length === 2 && a && b && Math.abs(a.x - b.x) < 2 && Math.abs(a.y - b.y) < 2;
      if (degenerate) {
        // Second click on the first point: keep waiting for a real second point.
        setPendingPlacement({ kind: drawing.kind, start: drawing.points[0] });
        primitive.setTransient({ ...drawing, id: PREVIEW_ID });
        return;
      }
      commit([...workingRef.current, drawing].slice(-MAX_DRAWINGS));
      primitive.setTransient(null);
      setPendingPlacement(null);
      select(drawing.id);
      onToolChange("cursor");
      return;
    }
    if (gesture.moved) commit(workingRef.current.map((candidate) => (candidate.id === drawing.id ? drawing : candidate)));
    primitive.setTransient(null);
  });

  const onTeardown = useEffectEvent(() => {
    cancelInteraction();
  });

  // Keyed on having a chart at all, not on the series object: FinancialChart replaces the main series on
  // every refetch (live 1D data), which must not cancel a drag or a pending placement.
  const attached = mainSeries !== null;
  useEffect(() => {
    const plot = plotRef.current;
    if (!plot || !attached) return;
    const owns = () => gestureRef.current !== null;
    // The library listens on its canvases below the plot: stopping the capture phase here hides the gesture from it.
    const swallow = (event: Event) => {
      if (owns()) event.stopPropagation();
    };
    const swallowTouchMove = (event: TouchEvent) => {
      if (!owns()) return;
      event.stopPropagation();
      // The plot is touch-action: pan-y; a drawing drag must not scroll the page.
      if (event.cancelable) event.preventDefault();
    };
    // iOS reports double taps as dblclick, which the chart turns into a view reset.
    const swallowDoubleClick = (event: MouseEvent) => {
      if (owns() || event.timeStamp - lastGestureEndRef.current < 500) event.stopPropagation();
    };
    const down = (event: PointerEvent) => onPlotPointerDown(event);
    const hover = (event: PointerEvent) => onPlotPointerMove(event);
    const leave = () => onPlotPointerLeave();
    const move = (event: PointerEvent) => onWindowPointerMove(event);
    const up = (event: PointerEvent) => onWindowPointerEnd(event, false);
    const cancel = (event: PointerEvent) => onWindowPointerEnd(event, true);
    const swallowed = ["mousedown", "mousemove", "touchstart"] as const;

    plot.addEventListener("pointerdown", down, { capture: true });
    plot.addEventListener("pointermove", hover, { capture: true, passive: true });
    plot.addEventListener("pointerleave", leave);
    for (const name of swallowed) plot.addEventListener(name, swallow, { capture: true, passive: true });
    plot.addEventListener("touchmove", swallowTouchMove, { capture: true, passive: false });
    plot.addEventListener("dblclick", swallowDoubleClick, { capture: true });
    window.addEventListener("pointermove", move, { capture: true, passive: true });
    window.addEventListener("pointerup", up, { capture: true });
    window.addEventListener("pointercancel", cancel, { capture: true });
    return () => {
      plot.removeEventListener("pointerdown", down, { capture: true });
      plot.removeEventListener("pointermove", hover, { capture: true });
      plot.removeEventListener("pointerleave", leave);
      for (const name of swallowed) plot.removeEventListener(name, swallow, { capture: true });
      plot.removeEventListener("touchmove", swallowTouchMove, { capture: true });
      plot.removeEventListener("dblclick", swallowDoubleClick, { capture: true });
      window.removeEventListener("pointermove", move, { capture: true });
      window.removeEventListener("pointerup", up, { capture: true });
      window.removeEventListener("pointercancel", cancel, { capture: true });
      // Unmount in the middle of a drag: drop it rather than commit half a gesture.
      onTeardown();
    };
  }, [plotRef, attached]);

  // ---------------------------------------------------------------------------
  // Overlay (edit bar, placement hint)
  // ---------------------------------------------------------------------------

  const overlay = (
    <DrawingOverlay
      edit={selectedDrawing && anchor && !busy && interaction === "select" ? { drawing: selectedDrawing, anchor } : null}
      hint={activePending ? t(coarse ? "hint.secondTouch" : "hint.second") : null}
      coarse={coarse}
      onColor={(color: number) => {
        if (!selectedDrawing) return;
        lastColor.set(selectedDrawing.kind, color);
        updateSelected((drawing) => ({ ...drawing, color }));
      }}
      onDashedToggle={() =>
        updateSelected((drawing) => {
          const { dashed, ...rest } = drawing;
          return dashed ? rest : { ...rest, dashed: true };
        })
      }
      onDelete={() => {
        removeSelected();
        // The edit bar goes away with the drawing: keep keyboard focus on the chart.
        plotRef.current?.focus({ preventScroll: true });
      }}
    />
  );

  return {
    selectedId: effectiveSelectedId,
    overlay,
    onKeyDown,
    busy,
    undo: () => {
      undo();
    },
    canUndo,
    clearAll,
  };
}
