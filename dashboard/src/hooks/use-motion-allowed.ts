"use client";

import { useSyncExternalStore } from "react";

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

function subscribe(onChange: () => void): () => void {
  const query = window.matchMedia(REDUCED_MOTION);
  query.addEventListener("change", onChange);
  document.addEventListener("visibilitychange", onChange);
  return () => {
    query.removeEventListener("change", onChange);
    document.removeEventListener("visibilitychange", onChange);
  };
}

function getSnapshot(): boolean {
  return !window.matchMedia(REDUCED_MOTION).matches && document.visibilityState === "visible";
}

function getServerSnapshot(): boolean {
  return false;
}

/**
 * Whether JS-driven motion (number tweens, chart entry animations) should run:
 * false for "reduce motion" users and while the tab is hidden (requestAnimationFrame
 * is paused there, so a tween would freeze on its first frame). Always false during
 * SSR/hydration, so server and client markup match.
 */
export function useMotionAllowed(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
