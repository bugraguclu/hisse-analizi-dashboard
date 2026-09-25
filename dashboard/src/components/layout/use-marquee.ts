"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type RefObject } from "react";

/** Auto-scroll speed, CSS px per second. */
const SPEED = 32;
/** Seconds the auto-scroll takes to ease back in after a pause (hover, focus, drag, button). */
const RESUME_S = 0.4;
/** Seconds it takes to ease out when a pause starts — short, so a hovered link stops under the cursor. */
const STOP_S = 0.15;
/** Pointer travel (px) before a press becomes a drag; below it a click on a link still navigates. */
const DRAG_THRESHOLD = 5;
/** Release velocity is measured over the pointer samples of this window (ms). */
const VELOCITY_WINDOW_MS = 100;
/** Inertia decay time constant (s): a fling of v px/s glides v × TAU px. */
const INERTIA_TAU = 0.325;
const MAX_FLING = 4000;
/** Flings slower than this (px/s) don't glide; inertia stops once it decays below MIN_INERTIA. */
const MIN_FLING = 30;
const MIN_INERTIA = 4;
/** Longest frame step (s), so a tab coming back from the background doesn't jump. */
const MAX_FRAME_S = 0.05;
/** A pause this long (ms) between wheel events starts a new gesture (its axis is decided again). */
const WHEEL_GESTURE_GAP_MS = 200;
/** Auto-scroll stays off this long (ms) after the last horizontal wheel event. */
const WHEEL_HOLD_MS = 700;
/** Distance (px) kept between a keyboard-focused item and the faded edges. */
const FOCUS_EDGE = 40;
const MAX_COPIES = 24;
/** A click this soon (ms) after a drag's release is the drag's own click and is swallowed. */
const CLICK_SWALLOW_MS = 300;

export interface Marquee {
  /** Clipping element: receives the pointer, wheel and focus handling. */
  viewportRef: RefObject<HTMLDivElement | null>;
  /** Moving strip holding the copies; its transform is written directly, never by React. */
  trackRef: RefObject<HTMLDivElement | null>;
  /** The real (accessible) copy, rendered right after one leading clone. */
  copyRef: RefObject<HTMLDivElement | null>;
  /** Copies to render from the real one on (itself included), enough to cover the viewport twice. */
  copies: number;
}

/**
 * Endless ticker tape. Layout contract: the track holds one leading clone, the
 * real copy (`copyRef`) and `copies - 1` trailing clones, all identical and with
 * no gap between them (each copy carries its own trailing spacing). The track sits
 * at translateX(-(copyWidth + offset)); offset wraps modulo one copy, which is
 * invisible because every copy looks the same.
 *
 * Auto-scrolls leftwards unless `paused`, eases out while hovered / pressed /
 * keyboard-focused, and can be dragged (mouse, pen, touch — with inertia),
 * scrolled with horizontal wheel / Shift+wheel, and tabbed through.
 */
export function useMarquee(paused: boolean): Marquee {
  const viewportRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const copyRef = useRef<HTMLDivElement>(null);
  const [copies, setCopies] = useState(2);
  const pausedRef = useRef(paused);
  const wakeRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    pausedRef.current = paused;
    wakeRef.current?.();
  }, [paused]);

  useEffect(() => {
    const viewport = viewportRef.current;
    const track = trackRef.current;
    const copy = copyRef.current;
    if (!viewport || !track || !copy) return;

    let width = 0; // one copy, px
    let offset = 0; // px scrolled into the real copy
    let mix = 0; // auto-scroll throttle 0…1 (eased)
    let inertia = 0; // px/s added after a fling (positive = leftwards, like the auto-scroll)
    let hover = false;
    let keyboardFocus = false;
    let visible = true;
    let frame = 0;
    let lastFrame: number | null = null;
    let wheelHoldUntil = 0;
    let wheelAxis: "x" | "y" | null = null;
    let wheelAt = -Infinity;
    let pointerId: number | null = null;
    let dragging = false;
    let startX = 0;
    let lastX = 0;
    let samples: Array<{ t: number; x: number }> = [];
    let swallowClickUntil = 0;

    const render = () => {
      if (width <= 0) return;
      // Wrap into one copy. While a keyboard user is inside, keep the representation in which
      // the real (focusable) copy is on screen — the leading clone covers offsets down to -width.
      if (!keyboardFocus || offset < -width || offset >= width) offset -= Math.floor(offset / width) * width;
      track.style.transform = `translate3d(${-(width + offset)}px, 0, 0)`;
    };

    /** At rest, land on the device-pixel grid so the text rasterizes crisp. */
    const settle = () => {
      if (width <= 0) return;
      const dpr = window.devicePixelRatio || 1;
      const x = viewport.getBoundingClientRect().left - (width + offset);
      offset += x - Math.round(x * dpr) / dpr;
    };

    const tick = (now: number) => {
      frame = 0;
      const dt = lastFrame === null ? 0 : Math.min(MAX_FRAME_S, Math.max(0, (now - lastFrame) / 1000));
      lastFrame = now;
      const held = pointerId !== null;
      const wheeling = now < wheelHoldUntil;
      const run = !pausedRef.current && !hover && !keyboardFocus && !held && !wheeling;
      mix = run ? Math.min(1, mix + dt / RESUME_S) : Math.max(0, mix - dt / STOP_S);
      let step = SPEED * mix * mix * (3 - 2 * mix) * dt;
      if (inertia !== 0 && !held) {
        // Exact integral of an exponentially decaying velocity over this frame.
        const decay = Math.exp(-dt / INERTIA_TAU);
        step += inertia * INERTIA_TAU * (1 - decay);
        inertia *= decay;
        if (Math.abs(inertia) < MIN_INERTIA) inertia = 0;
      }
      offset += step;
      const moving = width > 0 && (run || mix > 0 || inertia !== 0 || wheeling);
      if (!moving && !dragging) settle();
      render();
      if (moving && visible) frame = requestAnimationFrame(tick);
      else lastFrame = null;
    };

    const wake = () => {
      if (frame || !visible || width <= 0) return;
      lastFrame = null;
      frame = requestAnimationFrame(tick);
    };
    wakeRef.current = wake;

    // --- Size: one copy's width and how many copies cover the viewport ---------------------
    const measure = () => {
      const copyWidth = copy.getBoundingClientRect().width;
      if (copyWidth > 0) {
        width = copyWidth;
        const needed = Math.ceil((2 * viewport.clientWidth) / copyWidth) + 1;
        setCopies(Math.min(MAX_COPIES, Math.max(2, needed)));
      } else {
        width = 0;
      }
      render();
      wake();
    };
    const resizeObserver = new ResizeObserver(measure);
    resizeObserver.observe(copy);
    resizeObserver.observe(viewport);

    const intersectionObserver = new IntersectionObserver((entries) => {
      visible = entries[entries.length - 1]?.isIntersecting ?? true;
      if (visible) wake();
    });
    intersectionObserver.observe(viewport);

    // --- Drag (mouse / pen / touch) ------------------------------------------------------------
    const onPointerDown = (event: PointerEvent) => {
      // One pointer at a time: a second finger while dragging is ignored.
      if (dragging && pointerId !== event.pointerId) return;
      if (event.pointerType === "mouse" && event.button !== 0) return;
      pointerId = event.pointerId;
      dragging = false;
      startX = event.clientX;
      lastX = event.clientX;
      samples = [{ t: performance.now(), x: event.clientX }];
      swallowClickUntil = 0;
      inertia = 0; // a press catches a gliding tape
      wake();
    };

    const onPointerMove = (event: PointerEvent) => {
      if (event.pointerId !== pointerId) return;
      if (!dragging) {
        if (Math.abs(event.clientX - startX) <= DRAG_THRESHOLD) return;
        // Only now capture, so a plain click on a link keeps its normal target.
        dragging = true;
        try {
          viewport.setPointerCapture(event.pointerId);
        } catch {
          // Pointer already gone — the drag still follows this element's events.
        }
        viewport.dataset.dragging = "";
      }
      const now = performance.now();
      offset -= event.clientX - lastX;
      lastX = event.clientX;
      samples.push({ t: now, x: event.clientX });
      while (samples.length > 2 && now - samples[0].t > VELOCITY_WINDOW_MS * 2) samples.shift();
      render();
    };

    const endPress = (event: PointerEvent) => {
      if (event.pointerId !== pointerId) return;
      pointerId = null;
      if (dragging) {
        dragging = false;
        delete viewport.dataset.dragging;
        const now = performance.now();
        // A drag ends in a click on whatever is under the pointer (same task, right after the
        // pointerup) — swallow it. Time-boxed so a later keyboard / assistive click is never eaten.
        swallowClickUntil = now + CLICK_SWALLOW_MS;
        const recent = samples.filter((sample) => now - sample.t <= VELOCITY_WINDOW_MS);
        let velocity = 0; // pointer px/s, positive = rightwards
        if (recent.length >= 2) {
          // Elapsed time runs to the release, so a finger that rested before lifting barely glides.
          const elapsed = now - recent[0].t;
          if (elapsed > 0) velocity = ((recent[recent.length - 1].x - recent[0].x) / elapsed) * 1000;
        }
        const fling = Math.max(-MAX_FLING, Math.min(MAX_FLING, -velocity));
        inertia = Math.abs(fling) < MIN_FLING ? 0 : fling;
        try {
          if (viewport.hasPointerCapture(event.pointerId)) viewport.releasePointerCapture(event.pointerId);
        } catch {
          // Already released.
        }
      }
      samples = [];
      wake();
    };

    // Only the tape's own capture ending counts: taking over a touch's implicit capture from the
    // link under the finger fires lostpointercapture on that link, which bubbles up here.
    const onLostCapture = (event: PointerEvent) => {
      if (event.target === viewport) endPress(event);
    };

    const onPointerEnter = (event: PointerEvent) => {
      if (event.pointerType === "touch") return;
      hover = true;
      wake();
    };

    const onPointerLeave = (event: PointerEvent) => {
      if (event.pointerType === "touch") return;
      hover = false;
      wake();
    };

    const onClickCapture = (event: MouseEvent) => {
      if (performance.now() > swallowClickUntil) return;
      swallowClickUntil = 0;
      event.preventDefault();
      event.stopPropagation();
    };

    // Enter on a focused link right after a drag must still navigate.
    const onKeyDown = () => {
      swallowClickUntil = 0;
    };

    // --- Wheel: trackpad horizontal scroll and Shift+wheel -------------------------------------
    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey) return; // pinch-zoom
      const now = performance.now();
      if (now - wheelAt > WHEEL_GESTURE_GAP_MS) wheelAxis = null;
      wheelAt = now;
      const { deltaX, deltaY } = event;
      if (wheelAxis === null) {
        if (Math.abs(deltaX) > Math.abs(deltaY) || (event.shiftKey && deltaY !== 0)) wheelAxis = "x";
        else if (deltaY !== 0) wheelAxis = "y";
        else return;
      }
      // Vertical intent (latched for the whole gesture) keeps scrolling the page.
      if (wheelAxis === "y" || !event.cancelable) return;
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewport.clientWidth : 1;
      const delta = (deltaX !== 0 ? deltaX : event.shiftKey ? deltaY : 0) * unit;
      // Horizontal intent: ours — also stops the macOS back/forward swipe.
      event.preventDefault();
      if (delta === 0) return;
      offset += delta;
      inertia = 0;
      wheelHoldUntil = now + WHEEL_HOLD_MS;
      render();
      wake();
    };

    // --- Keyboard focus and browser-initiated scrolling ----------------------------------------
    /** Browsers scroll overflow-hidden boxes (focus, find-in-page): fold that into the offset. */
    const foldScroll = () => {
      const scrolled = viewport.scrollLeft;
      if (scrolled === 0) return;
      viewport.scrollLeft = 0;
      offset += scrolled;
      render();
    };

    const onFocusIn = (event: FocusEvent) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      let keyboard = true;
      try {
        keyboard = target.matches(":focus-visible");
      } catch {
        // No :focus-visible support — treat every focus as keyboard focus.
      }
      keyboardFocus = keyboard;
      foldScroll();
      if (keyboard && copy.contains(target) && width > 0) {
        const bounds = viewport.getBoundingClientRect();
        const rect = target.getBoundingClientRect();
        const left = bounds.left + FOCUS_EDGE;
        const right = bounds.right - FOCUS_EDGE;
        let shift = 0;
        if (rect.left < left || rect.width > right - left) shift = rect.left - left;
        else if (rect.right > right) shift = rect.right - right;
        if (shift !== 0) {
          offset += shift;
          inertia = 0;
          render();
        }
      }
      wake();
    };

    const onFocusOut = (event: FocusEvent) => {
      const next = event.relatedTarget;
      if (next instanceof Node && viewport.contains(next)) return; // focusin on it follows
      keyboardFocus = false;
      render();
      wake();
    };

    viewport.addEventListener("pointerdown", onPointerDown);
    viewport.addEventListener("pointermove", onPointerMove);
    // On window: a mouse press that wanders off before becoming a drag (not captured yet)
    // is released outside the tape, and must not leave it "held" forever.
    window.addEventListener("pointerup", endPress, true);
    window.addEventListener("pointercancel", endPress, true);
    viewport.addEventListener("lostpointercapture", onLostCapture);
    viewport.addEventListener("pointerenter", onPointerEnter);
    viewport.addEventListener("pointerleave", onPointerLeave);
    viewport.addEventListener("click", onClickCapture, true);
    viewport.addEventListener("keydown", onKeyDown, true);
    viewport.addEventListener("wheel", onWheel, { passive: false });
    viewport.addEventListener("scroll", foldScroll);
    viewport.addEventListener("focusin", onFocusIn);
    viewport.addEventListener("focusout", onFocusOut);

    return () => {
      wakeRef.current = null;
      if (frame) cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      intersectionObserver.disconnect();
      viewport.removeEventListener("pointerdown", onPointerDown);
      viewport.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", endPress, true);
      window.removeEventListener("pointercancel", endPress, true);
      viewport.removeEventListener("lostpointercapture", onLostCapture);
      viewport.removeEventListener("pointerenter", onPointerEnter);
      viewport.removeEventListener("pointerleave", onPointerLeave);
      viewport.removeEventListener("click", onClickCapture, true);
      viewport.removeEventListener("keydown", onKeyDown, true);
      viewport.removeEventListener("wheel", onWheel);
      viewport.removeEventListener("scroll", foldScroll);
      viewport.removeEventListener("focusin", onFocusIn);
      viewport.removeEventListener("focusout", onFocusOut);
      delete viewport.dataset.dragging;
    };
  }, []);

  return { viewportRef, trackRef, copyRef, copies };
}

// ---------------------------------------------------------------------------
// Pause preference: explicit choice (localStorage) > prefers-reduced-motion
// ---------------------------------------------------------------------------

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";
const pauseListeners = new Set<() => void>();
/** Fallback when storage is blocked (private mode): the choice lasts for this page view. */
const pauseMemory = new Map<string, boolean>();

function readPause(key: string): boolean | null {
  try {
    const stored = window.localStorage.getItem(key);
    if (stored === "1") return true;
    if (stored === "0") return false;
  } catch {
    // Storage unavailable — fall through to the in-memory copy.
  }
  return pauseMemory.get(key) ?? null;
}

function subscribePause(onChange: () => void): () => void {
  pauseListeners.add(onChange);
  window.addEventListener("storage", onChange);
  return () => {
    pauseListeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

function subscribeReducedMotion(onChange: () => void): () => void {
  const query = window.matchMedia(REDUCED_MOTION_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

function prefersReducedMotion(): boolean {
  return window.matchMedia(REDUCED_MOTION_QUERY).matches;
}

/**
 * Whether the tape is paused, and a toggle that remembers the choice per viewer.
 * With no stored choice it follows prefers-reduced-motion (reduce → paused); an
 * explicit press of play is a deliberate opt-in and wins. Server render and
 * hydration assume "playing".
 */
export function useMarqueePause(storageKey: string): [paused: boolean, toggle: () => void] {
  const stored = useSyncExternalStore(subscribePause, () => readPause(storageKey), () => null);
  const reducedMotion = useSyncExternalStore(subscribeReducedMotion, prefersReducedMotion, () => false);
  const paused = stored ?? reducedMotion;
  const toggle = useCallback(() => {
    const next = !paused;
    pauseMemory.set(storageKey, next);
    try {
      window.localStorage.setItem(storageKey, next ? "1" : "0");
    } catch {
      // Private mode / blocked storage: the in-memory copy is used instead.
    }
    pauseListeners.forEach((listener) => listener());
  }, [paused, storageKey]);
  return [paused, toggle];
}
