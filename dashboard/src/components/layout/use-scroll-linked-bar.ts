"use client";

import { useEffect, useRef, type RefObject } from "react";
import { usePathname } from "next/navigation";

/**
 * Scroll-linked top bar, ported from the belif site's header (which copies apple.com's
 * global nav): scrolling down, the bar leaves with the page; scrolling up, it comes back
 * at the same speed and stays once it is fully in. Both directions follow the finger 1:1
 * because the browser's own scrolling does the moving — no threshold, duration or curve.
 *
 * HOW: the bar is `position: sticky` inside a track (absolute, at the top of a slot that
 * keeps the bar's place in the page). A sticky box cannot leave its container, so the
 * track's height B decides where the bar sits:
 *   bar top = max(-y, min(0, B - H - y))      y: scroll offset, H: bar height
 * B is written only when the scroll direction flips; every frame in between is the
 * browser's scrolling. Writing a transform per frame would trail the page by a frame.
 * The -y bound ties the bar to the page at the very top, so it scrolls away with the
 * content there and no gap opens above it.
 *
 * SETTLES ON RELEASE: a scroll that stops with the bar half out completes it towards the
 * last direction (320 ms, apple.com's menu curve — the transition is on the bar's class).
 * A quarter of the bar is the threshold; less counts as jitter and the bar goes back.
 * Scrolling again mid-slide takes the bar over from where it is drawn.
 *
 * PINNED (`position: fixed`, set in the bar's classes) — the bar is out at the top of the
 * screen and stays out afterwards; this hook only re-anchors it to wherever it is:
 * - `data-pin`: on page entry (first load, client navigation, bfcache) until the first
 *   wheel, touch, key or pointer press. Browser-driven scrolls — scroll restoration on
 *   back/forward, a hash jump — would otherwise take the bar away in the first frame.
 * - A descendant has keyboard focus: `:focus-visible` while the last input was a key
 *   (`data-kbd`, kept here), or a text field (the search) has focus at all. Not plain
 *   `:focus-visible`: when the search sheet closes, focus goes back to the magnifier by
 *   script, and after a field it matches `:focus-visible` even on a touch screen (iOS,
 *   where a tapped ✕ never takes focus) — the bar would then stay until the next tap on
 *   something focusable. Not `:focus-within` either: Chrome focuses a tapped ☰. Focus
 *   snaps the bar in rather than sliding it: while sliding, the browser still sees the
 *   focused control off screen and scrolls the page to it.
 * - `data-search`: the small-screen search sheet is open. It hangs from the bar's bottom
 *   and is `position: fixed` inside it, so the bar never carries a transform then.
 */
export function useScrollLinkedBar(barRef: RefObject<HTMLElement | null>) {
  const pathname = usePathname();
  const reenterRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    const bar = barRef.current;
    const track = bar?.parentElement;
    if (!bar || !track) return;
    const controller = attach(bar, track);
    reenterRef.current = controller.reenter;
    return () => {
      reenterRef.current = null;
      controller.dispose();
    };
  }, [barRef]);

  // A client-side navigation is a page entry too.
  useEffect(() => {
    reenterRef.current?.();
  }, [pathname]);
}

function attach(bar: HTMLElement, track: HTMLElement) {
  let H = bar.offsetHeight;
  let B = H;
  let lastY = 0;
  let dir = 0; // last movement: 1 down, -1 up
  let armed = false;
  let sliding = false;
  let touching = false;
  let queued = false;
  let frame = 0;
  let idle = 0;

  // iOS rubber-bands past both ends of the page. Clamped to the real bounds, the bounce
  // back does not count as a direction change and does not bring the bar back at the end.
  const readY = () =>
    Math.min(Math.max(window.scrollY, 0), Math.max(document.documentElement.scrollHeight - window.innerHeight, 0));
  const pinned = () => getComputedStyle(bar).position === "fixed";
  // Where sticky places the bar at y — the formula above.
  const at = (y: number) => Math.max(-y, Math.min(0, B - H - y));
  // Make the bar's top sit at p while the page is at y. p is taken as at most one bar
  // height above the screen, so a bar far out of view starts coming in on the first
  // upward pixel.
  const anchor = (p: number, y: number) => {
    B = y + Math.min(0, Math.max(-H, p)) + H;
    track.style.height = `${B}px`;
  };
  // Draw the bar `from` px away, then let the transition bring it to where sticky puts it.
  const slide = (from: number) => {
    bar.style.transition = "none";
    bar.style.transform = `translateY(${from}px)`;
    bar.getBoundingClientRect();
    bar.style.transition = "";
    bar.style.transform = "";
    sliding = from !== 0;
  };
  // Cut a running slide. The read in between matters: without it the browser animates the
  // transform's removal again with the restored transition.
  const stop = () => {
    bar.style.transition = "none";
    bar.style.transform = "";
    bar.getBoundingClientRect();
    bar.style.transition = "";
    sliding = false;
  };
  const onTransitionEnd = (event: TransitionEvent) => {
    if (event.target === bar && event.propertyName === "transform") sliding = false;
  };
  // A scroll during a slide takes the bar over from where it is drawn.
  const takeOver = (y: number) => {
    const p = bar.getBoundingClientRect().top;
    stop();
    anchor(p, y);
  };

  const onScroll = () => {
    queued = false;
    const y = readY();
    if (!armed || pinned()) {
      if (armed && B !== y + H) anchor(0, y);
      lastY = y;
      dir = 0;
      return;
    }
    const d = y - lastY;
    if (!d) return;
    const next = d > 0 ? 1 : -1;
    // On a flip the bar is anchored at the TURNING POINT (the previous frame), not this
    // one: the page has already moved a step the new way. Measured on belif (iOS Safari):
    // anchoring at the current frame lost the first ~10 px of every reversal.
    if (sliding) takeOver(y);
    else if (next !== dir) anchor(at(lastY), lastY);
    dir = next;
    lastY = y;
  };

  // Complete a half-out bar once scrolling stops. Last direction decides, with a quarter-bar
  // margin: down and a quarter gone → it leaves; up and a quarter in → it comes in.
  const settle = () => {
    if (!armed || touching || sliding || pinned()) return;
    const y = readY();
    const p = bar.getBoundingClientRect().top;
    const floor = -Math.min(H, y); // at the top of the page the bar is tied to it
    if (p > -1 || p < floor + 1) return;
    const cut = dir > 0 ? H / 4 : dir < 0 ? (H * 3) / 4 : H / 2;
    const to = -p >= cut ? floor : 0;
    anchor(to, y);
    slide(p - to);
  };
  // Not while a finger is down: a slow drag that pauses must not have the bar snatched
  // away. Browsers with `scrollend` settle at once, others 150 ms after the last scroll.
  const later = () => {
    clearTimeout(idle);
    idle = window.setTimeout(settle, 150);
  };
  const handleScroll = () => {
    if (!queued) {
      queued = true;
      frame = requestAnimationFrame(onScroll);
    }
    later();
  };
  const handleScrollEnd = () => {
    clearTimeout(idle);
    requestAnimationFrame(settle);
  };
  const handleTouch = (event: TouchEvent) => {
    touching = event.touches.length > 0;
    if (!touching) later();
  };

  // The bar is anchored at the last position BEFORE the input: listeners are passive and
  // the wheel or finger starts scrolling without waiting for this.
  const inputs = ["wheel", "touchstart", "keydown", "pointerdown"] as const;
  const arm = () => {
    armed = true;
    inputs.forEach((type) => window.removeEventListener(type, arm, true));
    dir = 0;
    anchor(0, lastY);
    bar.removeAttribute("data-pin");
  };
  const disarm = () => {
    armed = false;
    lastY = readY();
    dir = 0;
    bar.setAttribute("data-pin", "");
    inputs.forEach((type) => window.addEventListener(type, arm, { capture: true, passive: true }));
  };

  // Pinned by focus or the search sheet: bind the bar where it now shows, so it stays
  // there when the pin ends.
  const onPin = () => {
    if (!armed || !pinned()) return;
    if (sliding) stop();
    anchor(0, readY());
  };
  const watch = new MutationObserver(onPin);
  watch.observe(bar, { attributes: true, attributeFilter: ["data-search", "data-kbd"] });
  const onKey = () => {
    if (!bar.hasAttribute("data-kbd")) bar.setAttribute("data-kbd", "");
  };
  const onPointer = () => {
    if (bar.hasAttribute("data-kbd")) bar.removeAttribute("data-kbd");
  };

  const resize = new ResizeObserver(() => {
    const h = bar.offsetHeight;
    if (!h || h === H) return;
    const p = bar.getBoundingClientRect().top;
    H = h;
    if (armed) anchor(pinned() ? 0 : p, readY());
  });
  resize.observe(bar);

  const reenter = () => {
    clearTimeout(idle);
    stop();
    touching = false;
    disarm();
  };
  // Back/forward can restore the page from memory (bfcache) — also an entry.
  const handlePageShow = (event: PageTransitionEvent) => {
    if (event.persisted) reenter();
  };

  bar.addEventListener("transitionend", onTransitionEnd);
  bar.addEventListener("focusin", onPin);
  window.addEventListener("keydown", onKey, true);
  window.addEventListener("pointerdown", onPointer, true);
  window.addEventListener("scroll", handleScroll, { passive: true });
  window.addEventListener("scrollend", handleScrollEnd);
  for (const type of ["touchstart", "touchend", "touchcancel"] as const) {
    window.addEventListener(type, handleTouch, { capture: true, passive: true });
  }
  window.addEventListener("pageshow", handlePageShow);
  disarm();

  const dispose = () => {
    clearTimeout(idle);
    cancelAnimationFrame(frame);
    watch.disconnect();
    resize.disconnect();
    bar.removeEventListener("transitionend", onTransitionEnd);
    bar.removeEventListener("focusin", onPin);
    window.removeEventListener("keydown", onKey, true);
    window.removeEventListener("pointerdown", onPointer, true);
    window.removeEventListener("scroll", handleScroll);
    window.removeEventListener("scrollend", handleScrollEnd);
    for (const type of ["touchstart", "touchend", "touchcancel"] as const) {
      window.removeEventListener(type, handleTouch, true);
    }
    inputs.forEach((type) => window.removeEventListener(type, arm, true));
    window.removeEventListener("pageshow", handlePageShow);
    stop();
    track.style.height = "";
  };

  return { reenter, dispose };
}
