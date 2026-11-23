/**
 * Tracks the mobile virtual keyboard (especially iOS Safari, where the layout viewport stays fixed
 * while `window.visualViewport` shrinks and shifts) so focused search/filter fields and primary
 * actions never disappear behind the keyboard.
 *
 * Adapted from Yemek Takibi's `softKeyboard.js`:
 * - Sets `html[data-soft-keyboard]` and `--visible-top`, `--visible-height`, `--keyboard-inset`
 *   while an on-screen keyboard is active.
 * - Scrolls the nearest scrollable ancestor(s) so the active field (and its label/group wrapper)
 *   stays between the visible top edge and the keyboard top edge.
 * - Once the keyboard fully dismisses, smoothly restores the pre-typing scroll position unless the
 *   user manually scrolled in the meantime.
 */

const NO_KEYBOARD_INPUT_TYPES = new Set([
  "button",
  "checkbox",
  "color",
  "file",
  "hidden",
  "image",
  "radio",
  "range",
  "reset",
  "submit",
]);

/** Taller than collapsing mobile browser chrome, shorter than any on-screen phone keyboard. */
export const KEYBOARD_MIN_HEIGHT = 120;
const DEFAULT_GAP = 12;
/** A tap may wobble a few pixels; deliberate vertical scrolling moves farther. */
const DRAG_MIN_PX = 10;
const RESTORE_TIMEOUT_MS = 700;
const REVEAL_SETTLE_MS = 80;

export interface RevealGeometry {
  targetTop: number;
  targetBottom: number;
  containerTop: number;
  containerBottom: number;
  viewportHeight: number;
  paddingTop: number;
  paddingBottom: number;
  gap?: number;
}

/**
 * Pure scroll delta calculation (positive scrolls down, negative scrolls up) to keep a focused
 * target box comfortably inside both its scroll container and the visible keyboard-free viewport.
 */
export function computeRevealDelta({
  targetTop,
  targetBottom,
  containerTop,
  containerBottom,
  viewportHeight,
  paddingTop,
  paddingBottom,
  gap = DEFAULT_GAP,
}: RevealGeometry): number {
  const low = Math.max(gap, containerTop + paddingTop);
  const high = Math.min(viewportHeight - gap, containerBottom - paddingBottom);
  const targetHeight = targetBottom - targetTop;
  const available = high - low;
  if (targetTop < low || targetHeight > available) return targetTop - low;
  if (targetBottom > high) return targetBottom - high;
  return 0;
}

/** True when focusing `el` is expected to summon an on-screen keyboard. */
export function isTextEntry(el: Element | null | undefined): el is HTMLElement {
  if (!el || !(el instanceof HTMLElement)) return false;
  if ("disabled" in el && (el as HTMLInputElement).disabled) return false;
  if ("readOnly" in el && (el as HTMLInputElement).readOnly) return false;
  if (el.inputMode === "none") return false;
  if (el instanceof HTMLTextAreaElement) return true;
  if (el instanceof HTMLInputElement) return !NO_KEYBOARD_INPUT_TYPES.has(el.type);
  return el.isContentEditable === true;
}

function scrollsY(node: Element): boolean {
  if (node.scrollHeight <= node.clientHeight + 1) return false;
  const { overflowY } = getComputedStyle(node);
  return overflowY === "auto" || overflowY === "scroll" || overflowY === "overlay";
}

/** Nearest scrollable ancestors first; document scrolling element last unless body is scroll-locked. */
function collectScrollers(el: Element): HTMLElement[] {
  const list: HTMLElement[] = [];
  for (
    let node = el.parentElement;
    node && node !== document.body && node !== document.documentElement;
    node = node.parentElement
  ) {
    if (scrollsY(node)) list.push(node);
  }
  if (
    getComputedStyle(document.body).position !== "fixed" &&
    document.scrollingElement instanceof HTMLElement
  ) {
    list.push(document.scrollingElement);
  }
  return list;
}

function readScrollPadding(node: Element, side: "Top" | "Bottom"): number {
  const style = getComputedStyle(node);
  const value = side === "Top" ? style.scrollPaddingTop : style.scrollPaddingBottom;
  return Number.parseFloat(value) || 0;
}

interface KeyboardSession {
  field: HTMLElement;
  top: number;
  positions: Map<HTMLElement, number>;
  dragged: boolean;
}

/**
 * Attaches global `visualViewport` + focus/touch listeners on `window`/`document`.
 * Returns a teardown callback safe to call from React's `useEffect` cleanup.
 */
export function trackSoftKeyboard(root: HTMLElement = document.documentElement): () => void {
  if (typeof window === "undefined" || typeof document === "undefined") return () => {};
  const view = window.visualViewport;
  if (!view || !document.body) return () => {};

  // Chrome reports getBoundingClientRect relative to the layout viewport; Safari WebKit reports
  // relative to the visual viewport. A fixed probe at top:0 lets us normalize coordinates in both.
  const probe = document.createElement("div");
  probe.setAttribute("aria-hidden", "true");
  probe.style.cssText =
    "position:fixed;top:0;left:0;width:0;height:0;visibility:hidden;pointer-events:none";
  document.body.append(probe);

  const layoutTop = (el: Element): number =>
    el.getBoundingClientRect().top - probe.getBoundingClientRect().top;

  const fullHeightByWidth = new Map<number, number>();
  let open = false;
  let session: KeyboardSession | null = null;
  let pending: KeyboardSession | null = null;
  let revealTimer: ReturnType<typeof setTimeout> | undefined;
  let focusOutTimer: ReturnType<typeof setTimeout> | undefined;
  let rafId = 0;
  let touchY: number | null = null;

  const begin = (field: HTMLElement) => {
    pending = null;
    session = {
      field,
      top: layoutTop(field),
      positions: new Map(collectScrollers(field).map((node) => [node, node.scrollTop])),
      dragged: false,
    };
  };

  const reveal = () => {
    const field = document.activeElement;
    if (!open || !isTextEntry(field)) return;
    const wrapper = field.closest<HTMLElement>("[data-keyboard-field], .field");
    const box = wrapper && wrapper.offsetHeight < view.height / 2 ? wrapper : field;

    const toVisible = (rect: DOMRect) => {
      const shift = probe.getBoundingClientRect().top + view.offsetTop;
      return { top: rect.top - shift, bottom: rect.bottom - shift };
    };

    for (const node of collectScrollers(field)) {
      const target = toVisible(box.getBoundingClientRect());
      const edges =
        node === document.scrollingElement
          ? { top: -Infinity, bottom: Infinity }
          : toVisible(node.getBoundingClientRect());
      const delta = computeRevealDelta({
        targetTop: target.top,
        targetBottom: target.bottom,
        containerTop: edges.top,
        containerBottom: edges.bottom,
        viewportHeight: view.height,
        paddingTop: readScrollPadding(node, "Top"),
        paddingBottom: readScrollPadding(node, "Bottom"),
      });
      if (Math.abs(delta) >= 1) node.scrollTop += delta;
    }
  };

  const restore = (done: KeyboardSession) => {
    if (pending !== done || done.dragged) return;
    pending = null;
    const behavior: ScrollBehavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches
      ? "instant"
      : "smooth";
    const move = (node: HTMLElement, target: number): number => {
      const before = node.scrollTop;
      const top = Math.max(0, Math.min(target, node.scrollHeight - node.clientHeight));
      if (Math.abs(top - before) >= 1) node.scrollTo({ top, behavior });
      return top - before;
    };

    if (!done.field.isConnected) {
      done.positions.forEach((top, node) => {
        if (node.isConnected) move(node, top);
      });
      return;
    }

    let shift = layoutTop(done.field) - done.top;
    for (const node of done.positions.keys()) {
      if (Math.abs(shift) < 1) break;
      if (node.isConnected) shift -= move(node, node.scrollTop + shift);
    }
  };

  const restoreWhenGone = (done: KeyboardSession, since = performance.now(), lastHeight = -1) => {
    if (pending !== done) return;
    const height = view.height * view.scale;
    const full = fullHeightByWidth.get(document.documentElement.clientWidth) ?? 0;
    const gone = view.offsetTop < 1 && height === lastHeight && full - height <= KEYBOARD_MIN_HEIGHT;
    if (gone || performance.now() - since > RESTORE_TIMEOUT_MS) {
      restore(done);
      return;
    }
    rafId = requestAnimationFrame(() => restoreWhenGone(done, since, height));
  };

  const update = () => {
    const widthKey = document.documentElement.clientWidth;
    const scaledHeight = view.height * view.scale;
    const typing = isTextEntry(document.activeElement);
    const knownFull = fullHeightByWidth.get(widthKey) ?? 0;

    if ((!typing && !open) || scaledHeight > knownFull) {
      fullHeightByWidth.set(widthKey, scaledHeight);
    }

    const fullHeight = fullHeightByWidth.get(widthKey) ?? scaledHeight;
    const nextOpen = typing && fullHeight - scaledHeight > KEYBOARD_MIN_HEIGHT;

    if (nextOpen) {
      const inset = Math.max(0, Math.round(window.innerHeight - view.offsetTop - view.height));
      root.style.setProperty("--visible-top", `${Math.round(view.offsetTop)}px`);
      root.style.setProperty("--visible-height", `${Math.round(view.height)}px`);
      root.style.setProperty("--keyboard-inset", `${inset}px`);
    }

    if (nextOpen === open) return;
    open = nextOpen;

    if (open) {
      if (!session && isTextEntry(document.activeElement)) begin(document.activeElement);
      root.setAttribute("data-soft-keyboard", "");
    } else {
      root.removeAttribute("data-soft-keyboard");
      root.style.removeProperty("--visible-top");
      root.style.removeProperty("--visible-height");
      root.style.removeProperty("--keyboard-inset");
      pending = session;
      session = null;
      if (pending) restoreWhenGone(pending);
    }
  };

  const settle = () => {
    update();
    clearTimeout(revealTimer);
    if (open) revealTimer = setTimeout(reveal, REVEAL_SETTLE_MS);
  };

  const onFocusIn = (event: FocusEvent) => {
    if (!open && event.target instanceof Element && isTextEntry(event.target)) {
      begin(event.target);
    }
    settle();
  };

  const onFocusOut = () => {
    clearTimeout(focusOutTimer);
    focusOutTimer = setTimeout(() => {
      settle();
      if (!open && !isTextEntry(document.activeElement)) session = null;
    });
  };

  const onPointerDown = (event: PointerEvent) => {
    if (
      !open &&
      event.target === document.activeElement &&
      event.target instanceof Element &&
      isTextEntry(event.target)
    ) {
      begin(event.target);
    }
  };

  const onTouchStart = (event: TouchEvent) => {
    touchY = event.touches[0]?.clientY ?? null;
  };

  const onTouchMove = (event: TouchEvent) => {
    const y = event.touches[0]?.clientY;
    const active = open ? session : pending;
    if (active && touchY !== null && y !== undefined && Math.abs(y - touchY) > DRAG_MIN_PX) {
      active.dragged = true;
    }
  };

  update();
  view.addEventListener("resize", settle);
  view.addEventListener("scroll", update);
  document.addEventListener("focusin", onFocusIn);
  document.addEventListener("focusout", onFocusOut);
  document.addEventListener("pointerdown", onPointerDown, true);
  document.addEventListener("touchstart", onTouchStart, { passive: true });
  document.addEventListener("touchmove", onTouchMove, { passive: true });

  return () => {
    clearTimeout(revealTimer);
    clearTimeout(focusOutTimer);
    cancelAnimationFrame(rafId);
    pending = null;
    session = null;
    probe.remove();
    root.removeAttribute("data-soft-keyboard");
    root.style.removeProperty("--visible-top");
    root.style.removeProperty("--visible-height");
    root.style.removeProperty("--keyboard-inset");
    view.removeEventListener("resize", settle);
    view.removeEventListener("scroll", update);
    document.removeEventListener("focusin", onFocusIn);
    document.removeEventListener("focusout", onFocusOut);
    document.removeEventListener("pointerdown", onPointerDown, true);
    document.removeEventListener("touchstart", onTouchStart);
    document.removeEventListener("touchmove", onTouchMove);
  };
}
