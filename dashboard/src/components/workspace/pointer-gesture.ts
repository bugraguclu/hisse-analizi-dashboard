import { rubberBand } from "../../lib/motion.ts";

/** Shared input loop for all dashboard and widget drag/resize controls. */
export type GesturePoint = Readonly<{
  clientX: number;
  clientY: number;
  startX: number;
  startY: number;
  /** Document-space travel, including page scrolling during the gesture. */
  deltaX: number;
  deltaY: number;
}>;

type GesturePress = Pick<PointerEvent, "button" | "isPrimary" | "pointerId" | "clientX" | "clientY"> & {
  currentTarget: EventTarget | null;
};

type GestureOptions = {
  mediaQuery: string;
  cursor: string;
  activationDistance?: number;
  autoScroll?: boolean;
  /** Prevent scrolling past the moving card's available range. */
  scrollRoom?: () => { up: boolean; down: boolean };
  onStart?: (point: GesturePoint) => void;
  onFrame: (point: GesturePoint) => void;
  onFinish: (apply: boolean, started: boolean) => void;
};

const EDGE = 64;
const MAX_SCROLL = 22;

/** Shared edge resistance for a card dragged beyond its grid. */
export function gestureResistance(value: number, min: number, max: number): number {
  if (value < min) return min + rubberBand(value - min, 56);
  if (value > max) return max + rubberBand(value - max, 56);
  return value;
}

/** Starting near an edge does not scroll until the pointer travels toward it. */
export function gestureScrollSpeed(y: number, startY: number, height: number, activationDistance = 4): number {
  if (y < EDGE && y < startY - activationDistance) return -Math.min(MAX_SCROLL, (EDGE - y) / 4);
  if (y > height - EDGE && y > startY + activationDistance) return Math.min(MAX_SCROLL, (y - height + EDGE) / 4);
  return 0;
}

/**
 * One captured pointer, one update per animation frame, and one final update
 * at release. The returned cancel function also removes every listener and
 * restores the cursor. Layout calculations stay with each editor.
 */
export function beginPointerGesture(event: GesturePress, options: GestureOptions): () => void {
  if (!event.isPrimary || event.button !== 0) return () => {};
  const handle = event.currentTarget as HTMLElement;
  const pointer = event.pointerId;
  const startX = event.clientX;
  const startY = event.clientY;
  const scrollX = window.scrollX;
  const scrollY = window.scrollY;
  const distance = options.activationDistance ?? 4;
  const breakpoint = window.matchMedia(options.mediaQuery);
  let clientX = startX;
  let clientY = startY;
  let started = false;
  let finished = false;
  let frame = 0;
  let unlock: (() => void) | null = null;

  const point = (): GesturePoint => ({
    clientX, clientY, startX, startY,
    deltaX: clientX - startX + window.scrollX - scrollX,
    deltaY: clientY - startY + window.scrollY - scrollY,
  });

  function schedule() {
    if (finished || !started || frame) return;
    frame = window.requestAnimationFrame(() => {
      frame = 0;
      if (finished) return;
      const before = window.scrollY;
      const speed = options.autoScroll === false ? 0 : gestureScrollSpeed(clientY, startY, window.innerHeight, distance);
      const room = options.scrollRoom?.() ?? { up: true, down: true };
      if ((speed < 0 && room.up) || (speed > 0 && room.down)) window.scrollBy({ top: speed, behavior: "instant" });
      options.onFrame(point());
      // No permanent animation loop while the pointer and page are still.
      if (window.scrollY !== before) schedule();
    });
  }

  function move(move: PointerEvent) {
    if (move.pointerId !== pointer || finished) return;
    clientX = move.clientX;
    clientY = move.clientY;
    if (move.buttons === 0) {
      finish(true);
      return;
    }
    if (!started) {
      if (Math.hypot(clientX - startX, clientY - startY) < distance) return;
      started = true;
      window.getSelection()?.removeAllRanges();
      const style = document.body.style;
      const previous = { cursor: style.cursor, userSelect: style.userSelect };
      style.cursor = options.cursor;
      style.userSelect = "none";
      unlock = () => { style.cursor = previous.cursor; style.userSelect = previous.userSelect; };
      options.onStart?.(point());
    }
    move.preventDefault();
    schedule();
  }

  function finish(apply: boolean) {
    if (finished) return;
    finished = true;
    window.cancelAnimationFrame(frame);
    frame = 0;
    window.removeEventListener("pointermove", move, true);
    window.removeEventListener("pointerup", end, true);
    window.removeEventListener("pointercancel", cancelPointer, true);
    window.removeEventListener("keydown", key, true);
    window.removeEventListener("blur", cancel);
    window.removeEventListener("contextmenu", cancel, true);
    window.removeEventListener("scroll", schedule, true);
    window.removeEventListener("resize", schedule);
    document.removeEventListener("visibilitychange", visibility);
    breakpoint.removeEventListener("change", cancel);
    // Flush the release position even when it arrived before the scheduled frame.
    if (apply && started) options.onFrame(point());
    unlock?.();
    try {
      if (handle.hasPointerCapture(pointer)) handle.releasePointerCapture(pointer);
    } catch {
      // A moving widget may have replaced its former handle.
    }
    options.onFinish(apply, started);
  }

  function end(up: PointerEvent) {
    if (up.pointerId !== pointer) return;
    clientX = up.clientX;
    clientY = up.clientY;
    finish(true);
  }
  function cancel() { finish(false); }
  function cancelPointer(cancelled: PointerEvent) {
    if (cancelled.pointerId === pointer) cancel();
  }
  function key(key: KeyboardEvent) {
    if (key.key !== "Escape") return;
    key.preventDefault();
    key.stopPropagation();
    cancel();
  }
  function visibility() {
    if (document.visibilityState === "hidden") cancel();
  }

  try {
    handle.setPointerCapture(pointer);
  } catch {
    // Window listeners also cover browsers that cannot capture this handle.
  }
  window.addEventListener("pointermove", move, { capture: true, passive: false });
  window.addEventListener("pointerup", end, true);
  window.addEventListener("pointercancel", cancelPointer, true);
  window.addEventListener("keydown", key, true);
  window.addEventListener("blur", cancel);
  window.addEventListener("contextmenu", cancel, true);
  window.addEventListener("scroll", schedule, { capture: true, passive: true });
  window.addEventListener("resize", schedule);
  document.addEventListener("visibilitychange", visibility);
  breakpoint.addEventListener("change", cancel);
  return cancel;
}
