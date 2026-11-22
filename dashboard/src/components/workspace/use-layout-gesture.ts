"use client";

import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import { beginPointerGesture, gestureResistance } from "./pointer-gesture";
import {
  WORKSPACE_COLUMNS,
  WORKSPACE_DESKTOP_QUERY,
  WORKSPACE_GAP,
  WORKSPACE_ROW_STEP,
  layoutRows,
  moveCard,
  resizeCard,
  sameLayout,
  type LayoutChange,
  type LayoutItem,
  type Limits,
  type WorkspaceLayout,
} from "./layout-model";

/** The layout the cards would take if the pointer let go now. */
export type GesturePreview = { kind: LayoutChange; id: string; layout: WorkspaceLayout };

/** Where the card floated when the gesture ended, so it can glide into its slot. */
export type GestureRelease = {
  kind: LayoutChange;
  id: string;
  /** Unchanged from the starting layout when the gesture was cancelled or did not cross a cell. */
  layout: WorkspaceLayout;
  changed: boolean;
  dx: number;
  dy: number;
  width: number;
  height: number;
};

type Gesture = {
  kind: LayoutChange;
  item: LayoutItem;
  base: WorkspaceLayout;
  tile: HTMLElement;
  startX: number;
  startY: number;
  clientX: number;
  clientY: number;
  dx: number;
  dy: number;
  /** Whether the card can still travel up or down; the page stops scrolling once it cannot. */
  room: { up: boolean; down: boolean };
  layout: WorkspaceLayout;
};

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

/**
 * A single pointer owns the gesture. The card stays in its starting slot and
 * follows the pointer through CSS variables written once per frame, so React
 * renders only when the previewed layout changes. That layout is always
 * recalculated from the starting positions.
 *
 * A handle only starts the gesture. From then on the pointer is followed on
 * the window, so the gesture ends even when the handle stops hearing about it
 * (capture lost, the release swallowed by a menu or another window).
 */
export function useLayoutGesture(
  grid: RefObject<HTMLDivElement | null>,
  enabled: boolean,
  limits: Limits,
  onRelease: (release: GestureRelease) => void,
) {
  const [preview, setPreview] = useState<GesturePreview | null>(null);
  const gesture = useRef<Gesture | null>(null);
  const floated = useRef<HTMLElement | null>(null);
  const cleanup = useRef<(() => void) | null>(null);

  function follow(current: Gesture) {
    const bounds = grid.current?.getBoundingClientRect();
    if (!bounds || bounds.width === 0) return;

    const { item, kind, base, tile } = current;
    const columnStep = (bounds.width + WORKSPACE_GAP) / WORKSPACE_COLUMNS;
    const rawX = current.clientX - bounds.left - current.startX;
    const rawY = current.clientY - bounds.top - current.startY;
    let minX: number, maxX: number, minY: number, maxY: number;
    if (kind === "move") {
      minX = -item.x * columnStep;
      maxX = (WORKSPACE_COLUMNS - item.x - item.w) * columnStep;
      minY = -item.y * WORKSPACE_ROW_STEP;
      maxY = Math.max(0, layoutRows(base) - item.y - item.h) * WORKSPACE_ROW_STEP;
    } else {
      const { minW, minH, maxH, hug } = limits(item.id);
      minX = (Math.min(minW, item.w) - item.w) * columnStep;
      maxX = (WORKSPACE_COLUMNS - item.x - item.w) * columnStep;
      // A card that hugs its content has no height of its own to drag.
      minY = hug ? 0 : (Math.min(minH, item.h) - item.h) * WORKSPACE_ROW_STEP;
      maxY = hug ? 0 : (Math.max(maxH, item.h) - item.h) * WORKSPACE_ROW_STEP;
    }

    const columns = Math.round(clamp(rawX, minX, maxX) / columnStep);
    const rows = Math.round(clamp(rawY, minY, maxY) / WORKSPACE_ROW_STEP);
    current.dx = gestureResistance(rawX, minX, maxX);
    current.dy = gestureResistance(rawY, minY, maxY);
    current.room = { up: rawY > minY, down: rawY < maxY };
    const layout = kind === "move"
      ? moveCard(base, item.id, item.x + columns, item.y + rows)
      : resizeCard(base, item.id, item.w + columns, item.h + rows, limits);
    // Keep the previous array while the cards stay put, so an unchanged preview is not rendered again.
    if (!sameLayout(layout, current.layout)) current.layout = layout;
    tile.style.setProperty("--offset-x", `${current.dx}px`);
    tile.style.setProperty("--offset-y", `${current.dy}px`);
  }

  function show(current: Gesture) {
    follow(current);
    setPreview((shown) =>
      shown?.id === current.item.id && shown.kind === current.kind && shown.layout === current.layout
        ? shown
        : { kind: current.kind, id: current.item.id, layout: current.layout });
  }

  function start(event: ReactPointerEvent<HTMLButtonElement>, item: LayoutItem, kind: LayoutChange, base: WorkspaceLayout) {
    if (!enabled || !event.isPrimary || event.button !== 0) return;
    cleanup.current?.();
    const bounds = grid.current?.getBoundingClientRect();
    const handle = event.currentTarget;
    const tile = handle.closest<HTMLElement>("[data-tile]");
    if (!bounds || !tile) return;
    handle.focus({ preventScroll: true });
    const current: Gesture = {
      kind, item, base, tile,
      startX: event.clientX - bounds.left, startY: event.clientY - bounds.top,
      clientX: event.clientX, clientY: event.clientY,
      dx: 0, dy: 0, room: { up: true, down: true }, layout: base,
    };
    gesture.current = current;
    cleanup.current = beginPointerGesture(event, {
      mediaQuery: WORKSPACE_DESKTOP_QUERY,
      cursor: kind === "move" ? "grabbing" : "nwse-resize",
      scrollRoom: () => current.room,
      onStart: () => { floated.current = tile; },
      onFrame: ({ clientX, clientY }) => {
        current.clientX = clientX;
        current.clientY = clientY;
        show(current);
      },
      onFinish: (apply, started) => {
        cleanup.current = null;
        if (gesture.current !== current) return;
        gesture.current = null;
        if (!started) return;
        const layout = apply ? current.layout : current.base;
        const { offsetWidth: width, offsetHeight: height } = tile;
        setPreview(null);
        onRelease({ kind, id: item.id, layout, changed: layout !== base, dx: current.dx, dy: current.dy, width, height });
      },
    });
  }

  // The offsets outlive the gesture until React has stopped floating the card.
  useLayoutEffect(() => {
    if (preview || !floated.current) return;
    floated.current.style.removeProperty("--offset-x");
    floated.current.style.removeProperty("--offset-y");
    floated.current = null;
  }, [preview]);

  useEffect(() => {
    if (!enabled) cleanup.current?.();
  }, [enabled]);

  useEffect(() => () => {
    gesture.current = null;
    cleanup.current?.();
    floated.current?.style.removeProperty("--offset-x");
    floated.current?.style.removeProperty("--offset-y");
  }, []);

  return { preview: enabled ? preview : null, start, cancel: () => cleanup.current?.() };
}
