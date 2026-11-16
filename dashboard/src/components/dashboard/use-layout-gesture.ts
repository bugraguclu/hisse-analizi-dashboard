"use client";

import { useEffect, useEffectEvent, useLayoutEffect, useRef, useState, type PointerEvent, type RefObject } from "react";
import { rubberBand } from "@/lib/motion";
import {
  CARD_LIMITS,
  DASHBOARD_COLUMNS,
  DASHBOARD_DESKTOP_QUERY,
  DASHBOARD_GAP,
  DASHBOARD_ROW_STEP,
  layoutRows,
  moveCard,
  resizeCard,
  sameLayout,
  type CardId,
  type DashboardLayout,
  type LayoutChange,
  type LayoutItem,
} from "./layout-model";

/** The layout the cards would take if the pointer let go now. */
export type GesturePreview = { kind: LayoutChange; id: CardId; layout: DashboardLayout };

/** Where the card floated when the gesture ended, so it can glide into its slot. */
export type GestureRelease = {
  kind: LayoutChange;
  id: CardId;
  /** Unchanged from the starting layout when the gesture was cancelled or did not cross a cell. */
  layout: DashboardLayout;
  changed: boolean;
  dx: number;
  dy: number;
  width: number;
  height: number;
};

type Gesture = {
  kind: LayoutChange;
  item: LayoutItem;
  base: DashboardLayout;
  handle: HTMLButtonElement;
  tile: HTMLElement;
  pointer: number;
  startX: number;
  startY: number;
  originY: number;
  clientX: number;
  clientY: number;
  started: boolean;
  dx: number;
  dy: number;
  /** Whether the card can still travel up or down; the page stops scrolling once it cannot. */
  room: { up: boolean; down: boolean };
  layout: DashboardLayout;
};

const EDGE = 64;
const ACTIVATION_DISTANCE = 4;
/** How far a card can be pulled past the grid or its size limits before it stops. */
const OVERSHOOT = 56;

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

/** Follow the pointer inside the range and resist it outside. */
function resist(value: number, min: number, max: number) {
  if (value < min) return min + rubberBand(value - min, OVERSHOOT);
  if (value > max) return max + rubberBand(value - max, OVERSHOOT);
  return value;
}

/**
 * Scroll while the pointer is held near the top or bottom of the window.
 * A handle that was picked up inside that band scrolls only once the pointer
 * has travelled toward the edge, so grabbing a low corner does not move the page.
 */
function scrollSpeed(y: number, originY: number) {
  const height = window.innerHeight;
  if (y < EDGE && y < originY - ACTIVATION_DISTANCE) return -clamp((EDGE - y) / 4, 0, 22);
  if (y > height - EDGE && y > originY + ACTIVATION_DISTANCE) return clamp((y - height + EDGE) / 4, 0, 22);
  return 0;
}

/**
 * A single pointer owns the gesture. The card stays in its starting slot and
 * follows the pointer through CSS variables written once per frame, so React
 * renders only when the previewed layout changes. That layout is always
 * recalculated from the starting positions.
 */
export function useLayoutGesture(
  grid: RefObject<HTMLDivElement | null>,
  enabled: boolean,
  onRelease: (release: GestureRelease) => void,
) {
  const [preview, setPreview] = useState<GesturePreview | null>(null);
  const gesture = useRef<Gesture | null>(null);
  const floated = useRef<HTMLElement | null>(null);
  const frame = useRef(0);

  function follow(current: Gesture) {
    const bounds = grid.current?.getBoundingClientRect();
    if (!bounds || bounds.width === 0) return;

    const { item, kind, base, tile } = current;
    const columnStep = (bounds.width + DASHBOARD_GAP) / DASHBOARD_COLUMNS;
    const rawX = current.clientX - bounds.left - current.startX;
    const rawY = current.clientY - bounds.top - current.startY;
    let minX: number, maxX: number, minY: number, maxY: number;
    if (kind === "move") {
      minX = -item.x * columnStep;
      maxX = (DASHBOARD_COLUMNS - item.x - item.w) * columnStep;
      minY = -item.y * DASHBOARD_ROW_STEP;
      maxY = Math.max(0, layoutRows(base) - item.y - item.h) * DASHBOARD_ROW_STEP;
    } else {
      const { minW, minH, maxH } = CARD_LIMITS[item.id];
      minX = (minW - item.w) * columnStep;
      maxX = (DASHBOARD_COLUMNS - item.x - item.w) * columnStep;
      minY = (minH - item.h) * DASHBOARD_ROW_STEP;
      maxY = (maxH - item.h) * DASHBOARD_ROW_STEP;
    }

    const columns = Math.round(clamp(rawX, minX, maxX) / columnStep);
    const rows = Math.round(clamp(rawY, minY, maxY) / DASHBOARD_ROW_STEP);
    current.dx = resist(rawX, minX, maxX);
    current.dy = resist(rawY, minY, maxY);
    current.room = { up: rawY > minY, down: rawY < maxY };
    const layout = kind === "move"
      ? moveCard(base, item.id, item.x + columns, item.y + rows)
      : resizeCard(base, item.id, item.w + columns, item.h + rows);
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

  function schedule() {
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      const current = gesture.current;
      if (!current?.started) return;
      const speed = scrollSpeed(current.clientY, current.originY);
      const before = window.scrollY;
      if (speed < 0 ? current.room.up : speed > 0 && current.room.down) window.scrollBy({ top: speed, behavior: "instant" });
      show(current);
      if (window.scrollY !== before) schedule();
    });
  }

  function start(event: PointerEvent<HTMLButtonElement>, item: LayoutItem, kind: LayoutChange, base: DashboardLayout) {
    if (!enabled || gesture.current || !event.isPrimary || event.button !== 0) return;
    const bounds = grid.current?.getBoundingClientRect();
    const tile = event.currentTarget.closest<HTMLElement>("[data-card]");
    if (!bounds || !tile) return;
    event.currentTarget.focus({ preventScroll: true });
    event.currentTarget.setPointerCapture(event.pointerId);
    gesture.current = {
      kind, item, base, tile, handle: event.currentTarget, pointer: event.pointerId,
      startX: event.clientX - bounds.left, startY: event.clientY - bounds.top,
      originY: event.clientY, clientX: event.clientX, clientY: event.clientY, started: false,
      dx: 0, dy: 0, room: { up: true, down: true }, layout: base,
    };
  }

  function move(event: PointerEvent<HTMLButtonElement>) {
    const current = gesture.current;
    if (!current || current.pointer !== event.pointerId) return;
    const starting = !current.started;
    if (starting && Math.hypot(event.clientX - current.clientX, event.clientY - current.clientY) < ACTIVATION_DISTANCE) return;
    current.started = true;
    current.clientX = event.clientX;
    current.clientY = event.clientY;
    if (!starting) {
      schedule();
      return;
    }
    // Position the card before React marks it as floating, so it never flashes at a stale offset.
    floated.current = current.tile;
    show(current);
  }

  function stop(commit: boolean) {
    const current = gesture.current;
    gesture.current = null;
    cancelAnimationFrame(frame.current);
    frame.current = 0;
    if (!current) return;
    if (current.handle.hasPointerCapture(current.pointer)) current.handle.releasePointerCapture(current.pointer);
    if (!current.started) return;
    if (commit) follow(current);
    const layout = commit ? current.layout : current.base;
    onRelease({
      kind: current.kind,
      id: current.item.id,
      layout,
      changed: layout !== current.base,
      dx: current.dx,
      dy: current.dy,
      width: current.tile.offsetWidth,
      height: current.tile.offsetHeight,
    });
    setPreview(null);
  }

  function end(event: PointerEvent<HTMLButtonElement>) {
    const current = gesture.current;
    if (!current || current.pointer !== event.pointerId) return;
    current.clientX = event.clientX;
    current.clientY = event.clientY;
    stop(true);
  }

  function cancelPointer(event: PointerEvent<HTMLButtonElement>) {
    if (gesture.current?.pointer === event.pointerId) stop(false);
  }

  const cancel = useEffectEvent(() => stop(false));
  const onScroll = useEffectEvent(schedule);

  // The offsets outlive the gesture until React has stopped floating the card.
  useLayoutEffect(() => {
    if (preview || !floated.current) return;
    floated.current.style.removeProperty("--offset-x");
    floated.current.style.removeProperty("--offset-y");
    floated.current = null;
  }, [preview]);

  useEffect(() => {
    const breakpoint = window.matchMedia(DASHBOARD_DESKTOP_QUERY);
    function onCancel() {
      if (gesture.current) cancel();
    }
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape" || !gesture.current) return;
      event.preventDefault();
      onCancel();
    }
    function handleScroll() {
      if (gesture.current?.started) onScroll();
    }
    breakpoint.addEventListener("change", onCancel);
    window.addEventListener("blur", onCancel);
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      const current = gesture.current;
      gesture.current = null;
      cancelAnimationFrame(frame.current);
      frame.current = 0;
      if (current?.handle.hasPointerCapture(current.pointer)) current.handle.releasePointerCapture(current.pointer);
      breakpoint.removeEventListener("change", onCancel);
      window.removeEventListener("blur", onCancel);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", handleScroll);
    };
  }, []);

  return { preview: enabled ? preview : null, start, move, end, cancelPointer, cancel: () => stop(false) };
}
